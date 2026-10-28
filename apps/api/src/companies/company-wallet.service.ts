import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  canTopUpCompanyWallet,
  money,
  seesCompanyWallet,
  toWire,
  type Money,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { bookingReference } from '../bookings/booking-codes';
import {
  paymentMethodUnavailable,
  paymentProviderDown,
  providerUnavailable,
} from '../bookings/booking.errors';
import { companyTopUpReturnUrl } from '../bookings/booking-urls';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import type { CompanyWalletTopUp } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { companyWalletPrefix, type LEDGER_KINDS } from '../ledger/ledger-accounts';
import { PaymentProviderUnavailableError, type PaymentMethod } from '../payments/payment-provider';
import { PaymentProviders } from '../payments/payment-providers';

import type { companyTopUpSchema, companyWalletSchema } from './companies.schemas';
import { CompaniesService, notCompanyAdmin, type Membership } from './companies.service';
import { companySuspended } from './company-policy';

type WalletView = z.infer<typeof companyWalletSchema>;
type TopUpView = z.infer<typeof companyTopUpSchema>;

const DAY_MS = 86_400_000;
const MOVEMENTS = 50;
const TOP_UPS = 20;

export const walletNotVisible = () =>
  new ProblemDetailsException(
    HttpStatus.FORBIDDEN,
    'company-approver-required',
    'Only an approver or admin can see the company wallet',
  );
export const topUpCurrencyUnavailable = () =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'company-top-up-currency',
    'Funds cannot be added in this currency',
    'Choose one of the currencies offered for top-ups.',
  );
export const topUpAmountOutOfRange = () =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'company-top-up-amount',
    'This amount is outside the top-up limits',
    'Choose an amount between the smallest and largest top-up shown.',
  );
export const topUpDailyLimit = () =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'company-top-up-limit',
    'Too many top-ups today',
    'Your company has started the most top-ups allowed in a day. Try again tomorrow.',
  );

export interface StartTopUp {
  amount: Money;
  provider: string | null;
  method: PaymentMethod | null;
}

/** A top-up as the company sees it; the payment page only for the admin who started it. */
export function presentTopUp(row: CompanyWalletTopUp, viewerId: string | null): TopUpView {
  const received =
    row.receivedMinor !== null && row.receivedCurrency
      ? toWire(money(row.receivedMinor, row.receivedCurrency))
      : null;
  const open = row.status === 'pending' && row.expiresAt.getTime() > Date.now();
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    amount: toWire(money(row.amountMinor, row.currency)),
    received,
    checkoutUrl:
      open && viewerId !== null && row.requestedById === viewerId ? row.checkoutUrl : null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    succeededAt: row.succeededAt?.toISOString() ?? null,
  };
}

/**
 * The company wallet as the company sees it (ADR-090): balances, movements and top-ups for
 * admins and approvers, and top-ups started by admins through hosted checkout. The money side of
 * a top-up (webhooks, reconciliation, the ledger) is `CompanyTopUps`.
 */
@Injectable()
export class CompanyWalletService {
  private readonly logger = new Logger(CompanyWalletService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly providers: PaymentProviders,
    private readonly hmac: HmacService,
    private readonly audit: AuditService,
  ) {}

  async view(userId: string): Promise<WalletView> {
    const membership = await this.companies.requireMembership(userId);
    if (!seesCompanyWallet(membership.member.role)) throw walletNotVisible();
    const companyId = membership.company.id;
    const [accounts, topUps] = await Promise.all([
      this.accounts(companyId),
      this.prisma.companyWalletTopUp.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: TOP_UPS,
      }),
    ]);
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { accountId: { in: accounts.map((account) => account.id) } },
      orderBy: { createdAt: 'desc' },
      take: MOVEMENTS,
      include: { transaction: { select: { kind: true, bookingId: true } } },
    });
    const bookingIds = [...new Set(entries.flatMap((entry) => entry.transaction.bookingId ?? []))];
    // Only the company's own trips can draw from or refund to its wallet; the filter is a guard.
    const bookings = await this.prisma.booking.findMany({
      where: { id: { in: bookingIds }, companyId },
      select: { id: true, reference: true },
    });
    const references = new Map(bookings.map((booking) => [booking.id, booking.reference]));
    return {
      balances: accounts.map((account) => toWire(money(account.balanceMinor, account.currency))),
      canTopUp: this.canTopUp(membership),
      topUpOptions: this.topUpOptions(),
      topUpsPerDay: this.config.COMPANY_WALLET_TOPUPS_PER_DAY,
      movements: entries.map((entry) => {
        const bookingId = entry.transaction.bookingId;
        const reference = bookingId ? (references.get(bookingId) ?? null) : null;
        return {
          id: entry.id,
          kind: entry.transaction.kind as (typeof LEDGER_KINDS)[number],
          // The wallet is a liability: a credit is money in for the company.
          amount: toWire(
            money(
              entry.direction === 'credit' ? entry.amountMinor : -entry.amountMinor,
              entry.currency,
            ),
          ),
          bookingId: reference ? bookingId : null,
          bookingReference: reference,
          occurredAt: entry.createdAt.toISOString(),
        };
      }),
      topUps: topUps.map((row) => presentTopUp(row, userId)),
    };
  }

  async topUp(userId: string, topUpId: string): Promise<TopUpView> {
    const membership = await this.companies.requireMembership(userId);
    if (!seesCompanyWallet(membership.member.role)) throw walletNotVisible();
    const row = await this.prisma.companyWalletTopUp.findFirst({
      where: { id: topUpId, companyId: membership.company.id },
    });
    if (!row) throw new NotFoundException();
    return presentTopUp(row, userId);
  }

  /**
   * Starts a top-up: admins of an active company, within the currency's limits and the daily
   * count, through a provider that takes the currency. The wallet is credited only by the
   * provider's verified event (or reconciliation), never here.
   */
  async startTopUp(userId: string, input: StartTopUp, context: RequestContext): Promise<TopUpView> {
    const membership = await this.companies.requireMembership(userId);
    if (!canTopUpCompanyWallet(membership.member.role)) throw notCompanyAdmin();
    if (membership.company.status !== 'active') throw companySuspended();
    const companyId = membership.company.id;
    const { amount } = input;
    const limits = this.config.COMPANY_WALLET_TOPUP_LIMITS[amount.currency];
    if (!limits || this.providers.options(amount.currency).providers.length === 0) {
      throw topUpCurrencyUnavailable();
    }
    if (amount.minor < BigInt(limits.minMinor) || amount.minor > BigInt(limits.maxMinor)) {
      throw topUpAmountOutOfRange();
    }
    const today = await this.prisma.companyWalletTopUp.count({
      where: { companyId, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
    });
    if (today >= this.config.COMPANY_WALLET_TOPUPS_PER_DAY) throw topUpDailyLimit();

    const provider = this.providers.choose(amount.currency, input.provider, input.method);
    if (!provider) throw input.method ? paymentMethodUnavailable() : providerUnavailable();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const id = uuidv7();
    const reference = `W-${bookingReference()}`;
    const expiresAt = new Date(Date.now() + this.config.PAYMENT_SESSION_TTL_MINUTES * 60_000);
    let session: { providerReference: string; checkoutUrl: string };
    try {
      session = await provider.createCheckout({
        paymentId: id,
        reference,
        amount,
        // The provider's receipt goes to the admin paying, else to the company's billing address.
        customerEmail: user.email ?? membership.company.billingEmail,
        returnUrl: companyTopUpReturnUrl(this.config, id),
        expiresAt,
        method: input.method,
        purpose: 'company_top_up',
      });
    } catch (error) {
      this.logger.warn(
        { companyId, provider: provider.name, reason: (error as Error).name },
        'top-up checkout creation failed',
      );
      if (error instanceof PaymentProviderUnavailableError) throw paymentProviderDown();
      throw error;
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.companyWalletTopUp.create({
        data: {
          id,
          companyId,
          reference,
          requestedById: userId,
          provider: provider.name,
          providerReference: session.providerReference,
          amountMinor: amount.minor,
          currency: amount.currency,
          checkoutUrl: session.checkoutUrl,
          expiresAt,
          ipHash: this.hmac.digest('ip', context.ip),
          ipCountry: context.country ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'company_wallet.topup_started',
          actorUserId: userId,
          targetType: 'company',
          targetId: companyId,
          context,
          metadata: {
            topUpId: id,
            provider: provider.name,
            amountMinor: amount.minor.toString(),
            currency: amount.currency,
            ...(input.method ? { method: input.method } : {}),
          },
        },
        tx,
      );
      return created;
    });
    return presentTopUp(row, userId);
  }

  /** Balances and recent top-ups for the console's company detail. */
  async forConsole(companyId: string): Promise<{
    walletBalances: WalletView['balances'];
    recentTopUps: Omit<TopUpView, 'checkoutUrl'>[];
  }> {
    const [accounts, topUps] = await Promise.all([
      this.accounts(companyId),
      this.prisma.companyWalletTopUp.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      walletBalances: accounts.map((account) =>
        toWire(money(account.balanceMinor, account.currency)),
      ),
      recentTopUps: topUps.map((row) => {
        const { checkoutUrl: _hidden, ...rest } = presentTopUp(row, null);
        return rest;
      }),
    };
  }

  private accounts(companyId: string) {
    return this.prisma.ledgerAccount.findMany({
      where: { code: { startsWith: companyWalletPrefix(companyId) } },
      orderBy: { currency: 'asc' },
    });
  }

  private canTopUp({ member, company }: Membership): boolean {
    return canTopUpCompanyWallet(member.role) && company.status === 'active';
  }

  private topUpOptions(): WalletView['topUpOptions'] {
    return Object.entries(this.config.COMPANY_WALLET_TOPUP_LIMITS)
      .filter(([currency]) => this.providers.options(currency).providers.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, limits]) => ({
        currency,
        min: toWire(money(BigInt(limits.minMinor), currency)),
        max: toWire(money(BigInt(limits.maxMinor), currency)),
      }));
  }
}
