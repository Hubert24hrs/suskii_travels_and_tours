import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  addDays,
  compare,
  money,
  parseReferralCode,
  REFERRAL_CODE_LENGTH,
  toWire,
  VOUCHER_ALPHABET,
  type Money,
  type ReferralStatus,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { itemPayload } from '../bookings/booking-presenter';
import { tripFacts } from '../bookings/trip-facts';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { randomCode } from '../crypto/random';
import { Prisma, type Referral } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { transfer } from '../ledger/ledger.service';
import { LedgerService } from '../ledger/ledger.service';
import { referralRewardMessage } from '../messaging/messages';
import { NotificationService } from '../messaging/notification.service';
import { FxService } from '../pricing/fx.service';

import { isDisposableEmail } from './disposable-domains';

const DAY_MS = 86_400_000;
const NETWORK_WINDOW_DAYS = 30;
const CODE_ATTEMPTS = 5;

/** Fraud flags (ADR-031): any of them sends a referral to staff review, never to a payout. */
export const REFERRAL_FLAGS = [
  'email_alias',
  'same_ip',
  'shared_network',
  'device_reused',
  'disposable_email',
  'monthly_cap',
] as const;
export type ReferralFlag = (typeof REFERRAL_FLAGS)[number];

export interface ReferralSignals {
  email: string | null;
  phone: string | null;
  network: string | null;
  device: string | null;
}

/** The mailbox behind an address: Gmail ignores dots and anything after a plus. */
export function emailKey(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  const base = local.split('+')[0] ?? '';
  const gmail = domain === 'gmail.com' || domain === 'googlemail.com';
  return `${gmail ? base.replace(/\./g, '') : base}@${gmail ? 'gmail.com' : domain}`;
}

/** The /24 (IPv4) or /48 (IPv6) an address belongs to. */
export function networkPrefix(ip: string): string | null {
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  if (!ip.includes(':')) return null;
  const groups = ip.toLowerCase().split('::')[0]?.split(':') ?? [];
  return groups.length >= 3 ? groups.slice(0, 3).join(':') : null;
}

const asSignals = (value: unknown): ReferralSignals => {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const text = (key: string): string | null =>
    typeof record[key] === 'string' ? record[key] : null;
  return {
    email: text('email'),
    phone: text('phone'),
    network: text('network'),
    device: text('device'),
  };
};

const referralNotFound = (): NotFoundException => new NotFoundException();

/**
 * Referrals (ADR-031): every account has a code; a sign-up with a code links referee to
 * referrer with hashed signals; a sweep qualifies a referral on the referee's first completed
 * trip and pays the configured rewards to both wallets through the ledger, once. Anything
 * suspicious waits for staff review.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hmac: HmacService,
    private readonly ledger: LedgerService,
    private readonly fx: FxService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  private reward(kind: 'referrer' | 'referee'): Money | null {
    const minor =
      kind === 'referrer'
        ? this.config.REFERRAL_REWARD_REFERRER_MINOR
        : this.config.REFERRAL_REWARD_REFEREE_MINOR;
    return minor > 0 ? money(minor, this.config.REFERRAL_REWARD_CURRENCY) : null;
  }

  /** The account's code, created on first use. */
  async codeFor(userId: string): Promise<{ code: string; active: boolean }> {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return existing;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.referralCode.create({
          data: { userId, code: randomCode(VOUCHER_ALPHABET, REFERRAL_CODE_LENGTH) },
        });
      } catch (error) {
        const conflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!conflict || attempt >= CODE_ATTEMPTS) throw error;
        // Two first requests at once: the other one created this user's code.
        const raced = await this.prisma.referralCode.findUnique({ where: { userId } });
        if (raced) return raced;
      }
    }
  }

  async summary(userId: string) {
    const [code, made, referredBy] = await Promise.all([
      this.codeFor(userId),
      this.prisma.referral.groupBy({
        by: ['status'],
        where: { referrerId: userId },
        _count: { _all: true },
      }),
      this.prisma.referral.findUnique({
        where: { refereeId: userId },
        select: { status: true, createdAt: true },
      }),
    ]);
    const counts = Object.fromEntries(
      (['pending', 'qualified', 'rewarded', 'review', 'rejected'] as const).map((status) => [
        status,
        made.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    ) as Record<ReferralStatus, number>;
    const referrer = this.reward('referrer');
    const referee = this.reward('referee');
    return {
      code: code.code,
      active: code.active,
      shareUrl: `${this.config.WEB_APP_URL}/register?ref=${code.code}`,
      counts,
      rewards: {
        referrer: referrer ? toWire(referrer) : null,
        referee: referee ? toWire(referee) : null,
        minSpend:
          this.config.REFERRAL_MIN_SPEND_MINOR > 0
            ? toWire(
                money(this.config.REFERRAL_MIN_SPEND_MINOR, this.config.REFERRAL_REWARD_CURRENCY),
              )
            : null,
      },
      referredBy: referredBy
        ? { status: referredBy.status, createdAt: referredBy.createdAt.toISOString() }
        : null,
    };
  }

  /**
   * Links a new account to the code it signed up with. Never throws: a bad, unknown, inactive or
   * own code simply does not count, so registration answers the same either way.
   */
  async attribute(
    refereeId: string,
    rawCode: string | undefined,
    context: RequestContext,
  ): Promise<void> {
    if (!rawCode) return;
    try {
      const code = parseReferralCode(rawCode);
      if (!code) return;
      const owner = await this.prisma.referralCode.findUnique({
        where: { code },
        include: { user: { select: { id: true, email: true, phone: true, status: true } } },
      });
      if (!owner?.active || owner.userId === refereeId || owner.user.status !== 'active') return;
      const referee = await this.prisma.user.findUniqueOrThrow({
        where: { id: refereeId },
        select: { email: true, phone: true },
      });
      const signals: ReferralSignals = {
        email: referee.email ? this.signal(`email:${emailKey(referee.email)}`) : null,
        phone: referee.phone ? this.signal(`phone:${referee.phone}`) : null,
        network: ((prefix) => (prefix ? this.signal(`net:${prefix}`) : null))(
          networkPrefix(context.ip),
        ),
        device: context.device ? this.signal(`device:${context.device}`) : null,
      };
      const flags = await this.attributionFlags(owner.user, referee, signals, context);
      const referral = await this.prisma.referral.create({
        data: {
          referrerId: owner.userId,
          refereeId,
          code,
          status: flags.length > 0 ? 'review' : 'pending',
          flags,
          signals: { ...signals },
        },
      });
      await this.audit.record({
        action: 'referral.attributed',
        actorUserId: refereeId,
        targetType: 'referral',
        targetId: referral.id,
        context,
        metadata: { flags },
      });
    } catch (error) {
      // An account can be referred once: a second attribution is a unique violation, ignored.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        this.logger.warn({ reason: (error as Error).name }, 'referral attribution failed');
      }
    }
  }

  private signal(value: string): string {
    return this.hmac.digest('referral-signal', value);
  }

  private async attributionFlags(
    referrer: { id: string; email: string | null; phone: string | null },
    referee: { email: string | null; phone: string | null },
    signals: ReferralSignals,
    context: RequestContext,
  ): Promise<ReferralFlag[]> {
    const flags = new Set<ReferralFlag>();
    if (referee.email && referrer.email && emailKey(referee.email) === emailKey(referrer.email)) {
      flags.add('email_alias');
    }
    if (referee.email && isDisposableEmail(referee.email)) flags.add('disposable_email');
    const since = new Date(Date.now() - NETWORK_WINDOW_DAYS * DAY_MS);
    const sameIp = await this.prisma.session.count({
      where: {
        userId: referrer.id,
        ipHash: this.hmac.digest('ip', context.ip),
        lastSeenAt: { gt: since },
      },
    });
    if (sameIp > 0) flags.add('same_ip');
    const siblings = await this.prisma.referral.findMany({
      where: { referrerId: referrer.id, createdAt: { gt: since } },
      select: { signals: true },
    });
    for (const sibling of siblings.map((row) => asSignals(row.signals))) {
      if (signals.network && sibling.network === signals.network) flags.add('shared_network');
      if (signals.device && sibling.device === signals.device) flags.add('device_reused');
    }
    return [...flags];
  }

  // --- Qualification and rewards ---------------------------------------------------------

  /** Qualifies pending referrals on a completed first trip and pays qualified ones. */
  async sweep(now = new Date()): Promise<{ qualified: number; review: number; rewarded: number }> {
    let qualified = 0;
    let review = 0;
    let rewarded = 0;
    const pending = await this.prisma.referral.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    for (const referral of pending) {
      const booking = await this.qualifyingBooking(referral.refereeId, now);
      if (!booking) continue;
      const flags = await this.qualificationFlags(referral, now);
      const status = flags.length > 0 ? 'review' : 'qualified';
      await this.prisma.$transaction(async (tx) => {
        await tx.referral.update({
          where: { id: referral.id },
          data: {
            status,
            flags: [...new Set([...referral.flags, ...flags])],
            qualifyingBookingId: booking.id,
            ...(status === 'qualified' ? { qualifiedAt: now } : {}),
          },
        });
        await this.audit.record(
          {
            action: 'referral.qualified',
            actorType: 'system',
            targetType: 'referral',
            targetId: referral.id,
            metadata: { bookingId: booking.id, status, flags },
          },
          tx,
        );
      });
      if (status === 'qualified') qualified += 1;
      else review += 1;
    }
    const due = await this.prisma.referral.findMany({
      where: { status: 'qualified' },
      orderBy: { qualifiedAt: 'asc' },
      take: 200,
    });
    for (const referral of due) {
      if (await this.pay(referral)) rewarded += 1;
    }
    return { qualified, review, rewarded };
  }

  /**
   * The referee's first confirmed trip that is over and meets the minimum spend; Prime purchases
   * are not trips. Returns null while there is none yet.
   */
  private async qualifyingBooking(refereeId: string, now: Date): Promise<{ id: string } | null> {
    const bookings = await this.prisma.booking.findMany({
      where: { userId: refereeId, status: 'CONFIRMED', vertical: { not: 'prime' } },
      orderBy: { confirmedAt: 'asc' },
      select: {
        id: true,
        totalMinor: true,
        currency: true,
        items: { select: { payload: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    const today = now.toISOString().slice(0, 10);
    const minimum = money(
      this.config.REFERRAL_MIN_SPEND_MINOR,
      this.config.REFERRAL_REWARD_CURRENCY,
    );
    const fx = minimum.minor > 0n ? await this.fx.converter() : null;
    for (const booking of bookings) {
      const item = booking.items[0];
      const facts = item ? tripFacts(itemPayload(item)) : null;
      // Completed: the day after the trip ends, whatever the destination's time zone.
      if (!facts || addDays(facts.endDate, 1) > today) continue;
      const spent = money(booking.totalMinor, booking.currency);
      if (fx && compare(fx.convert(spent, minimum.currency, 'floor'), minimum) < 0) continue;
      return { id: booking.id };
    }
    return null;
  }

  private async qualificationFlags(referral: Referral, now: Date): Promise<ReferralFlag[]> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thisMonth = await this.prisma.referral.count({
      where: {
        referrerId: referral.referrerId,
        qualifiedAt: { gte: monthStart },
        status: { in: ['qualified', 'rewarded'] },
      },
    });
    return thisMonth >= this.config.REFERRAL_MONTHLY_CAP ? ['monthly_cap'] : [];
  }

  /** Pays both rewards in one ledger transaction; idempotent on `referral:{id}:reward`. */
  private async pay(referral: Referral): Promise<boolean> {
    const referrerReward = this.reward('referrer');
    const refereeReward = this.reward('referee');
    if (!referrerReward && !refereeReward) return false;
    const users = await this.prisma.user.findMany({
      where: { id: { in: [referral.referrerId, referral.refereeId] }, status: 'active' },
      select: { id: true },
    });
    if (users.length < 2) return false;
    const currency = this.config.REFERRAL_REWARD_CURRENCY;
    const promotions = { kind: 'promotions', currency } as const;
    const paid = await this.prisma.$transaction(async (tx) => {
      // Claim the referral first: of two sweeps, only one pays.
      const claimed = await tx.referral.updateMany({
        where: { id: referral.id, status: 'qualified' },
        data: { status: 'rewarded', rewardedAt: new Date() },
      });
      if (claimed.count !== 1) return false;
      await this.ledger.post(tx, {
        key: `referral:${referral.id}:reward`,
        kind: 'referral_reward',
        lines: [
          ...(referrerReward
            ? transfer(
                promotions,
                { kind: 'wallet', userId: referral.referrerId, currency },
                referrerReward,
              )
            : []),
          ...(refereeReward
            ? transfer(
                promotions,
                { kind: 'wallet', userId: referral.refereeId, currency },
                refereeReward,
              )
            : []),
        ],
      });
      await this.audit.record(
        {
          action: 'referral.rewarded',
          actorType: 'system',
          targetType: 'referral',
          targetId: referral.id,
          metadata: {
            referrerMinor: String(referrerReward?.minor ?? 0n),
            refereeMinor: String(refereeReward?.minor ?? 0n),
            currency,
          },
        },
        tx,
      );
      return true;
    });
    if (!paid) return false;
    const walletUrl = `${this.config.WEB_APP_URL}/account/wallet`;
    if (referrerReward) {
      await this.notifications.notify(
        referral.referrerId,
        referralRewardMessage({ amount: referrerReward, walletUrl, role: 'referrer' }),
      );
    }
    if (refereeReward) {
      await this.notifications.notify(
        referral.refereeId,
        referralRewardMessage({ amount: refereeReward, walletUrl, role: 'referee' }),
      );
    }
    return true;
  }

  // --- Staff review ----------------------------------------------------------------------

  async listForReview(status: ReferralStatus) {
    const rows = await this.prisma.referral.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      referrerId: row.referrerId,
      refereeId: row.refereeId,
      code: row.code,
      status: row.status,
      flags: row.flags,
      qualifyingBookingId: row.qualifyingBookingId,
      createdAt: row.createdAt.toISOString(),
      qualifiedAt: row.qualifiedAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Staff decide a referral in review: approve (it qualifies, or keeps waiting for its trip) or
   * reject. The reviewer cannot be either party.
   */
  async review(
    referralId: string,
    decision: 'approve' | 'reject',
    staff: { userId: string; context: RequestContext },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const referral = await tx.referral.findUnique({ where: { id: referralId } });
      if (!referral) throw referralNotFound();
      if (referral.status !== 'review') {
        throw new ProblemDetailsException(
          HttpStatus.CONFLICT,
          'referral-not-in-review',
          'This referral is not waiting for review',
        );
      }
      if (staff.userId === referral.referrerId || staff.userId === referral.refereeId) {
        throw new ProblemDetailsException(
          HttpStatus.FORBIDDEN,
          'review-own-referral',
          'You cannot review a referral you are part of',
        );
      }
      const now = new Date();
      const status: ReferralStatus =
        decision === 'reject' ? 'rejected' : referral.qualifyingBookingId ? 'qualified' : 'pending';
      await tx.referral.update({
        where: { id: referralId },
        data: {
          status,
          reviewedById: staff.userId,
          reviewedAt: now,
          ...(status === 'qualified' ? { qualifiedAt: now } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'referral.reviewed',
          actorUserId: staff.userId,
          targetType: 'referral',
          targetId: referralId,
          context: staff.context,
          metadata: { decision, status },
        },
        tx,
      );
    });
  }
}
