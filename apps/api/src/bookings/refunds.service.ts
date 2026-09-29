import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { minOf, money, subtract, toWire, type Money, type RefundReason } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import type { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Payment, Prisma, Refund, RefundStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { AccountRef } from '../ledger/ledger-accounts';
import { InsufficientBalanceError, LedgerService, transfer } from '../ledger/ledger.service';
import {
  PaymentProviderRequestError,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentRef,
  type ProviderRefund,
} from '../payments/payment-provider';
import { PaymentProviders } from '../payments/payment-providers';
import { FxService } from '../pricing/fx.service';

import { BookingNotifications } from './booking-notifications';
import { BookingTransitions, SYSTEM_ACTOR } from './booking-transitions';
import { makerChecker, refundInvalid, refundState } from './booking.errors';
import type { AdminRefundDto, CreateRefundRequest } from './bookings.schemas';

type Tx = Prisma.TransactionClient;

export interface StaffActor {
  userId: string;
  context: RequestContext;
}

type RefundWithBooking = Refund & { booking: { reference: string } };

/** Refunds still able to move money (they count against what a payment can still return). */
const ACTIVE: readonly RefundStatus[] = [
  'pending_approval',
  'approved',
  'processing',
  'needs_review',
  'succeeded',
];
/** Refunds that keep a REFUND_PENDING booking open. */
const OPEN: readonly RefundStatus[] = [
  'pending_approval',
  'approved',
  'processing',
  'needs_review',
];
const POLL_AFTER_MS = 2 * 60_000;
const RECONCILE_AFTER_MS = 5 * 60_000;
const BATCH = 20;
/** A sweep starts no new provider call after this long (each call has its own timeout). */
const SWEEP_BUDGET_MS = 20_000;

export function toAdminRefund(refund: RefundWithBooking): AdminRefundDto {
  return {
    id: refund.id,
    bookingId: refund.bookingId,
    bookingReference: refund.booking.reference,
    paymentId: refund.paymentId,
    provider: refund.provider,
    amount: toWire(money(refund.amountMinor, refund.currency)),
    destination: refund.destination,
    reason: refund.reason,
    status: refund.status,
    automatic: refund.automatic,
    cancelsBooking: refund.cancelsBooking,
    note: refund.note,
    requestedByUserId: refund.requestedByUserId,
    approvedByUserId: refund.approvedByUserId,
    approvedAt: refund.approvedAt?.toISOString() ?? null,
    rejectionReason: refund.rejectionReason,
    providerRefundId: refund.providerRefundId,
    failureReason: refund.failureReason,
    attempts: refund.attempts,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
    settledAt: refund.settledAt?.toISOString() ?? null,
  };
}

const sourceAccount = (refund: Pick<Refund, 'source' | 'bookingId' | 'currency'>): AccountRef =>
  refund.source === 'unapplied'
    ? { kind: 'unapplied', currency: refund.currency }
    : { kind: 'booking', bookingId: refund.bookingId, currency: refund.currency };

const inFlight = (refund: Pick<Refund, 'provider' | 'currency'>): AccountRef => ({
  kind: 'refunds-in-flight',
  provider: refund.provider,
  currency: refund.currency,
});

const paymentRef = (payment: Payment): PaymentRef => ({
  providerReference: payment.providerReference,
  providerTransactionId: payment.providerTransactionId,
  amount: money(payment.amountMinor, payment.currency),
});

/**
 * Refunds (ADR-019): automatic ones for money Suskii cannot deliver on, staff ones behind
 * maker-checker approval, executed with the provider outside database transactions and settled
 * by webhook or polling. Every step moves money in the ledger under an idempotency key, and the
 * ledger's non-negative rule makes over-refunding impossible.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly providers: PaymentProviders,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly notifications: BookingNotifications,
    private readonly background: BackgroundTasks,
    private readonly fx: FxService,
  ) {}

  // -------------------------------------------------------------------------
  // Creating refunds
  // -------------------------------------------------------------------------

  /** A system refund of one payment, inside the caller's transaction. */
  async createAutomatic(
    tx: Tx,
    input: {
      payment: Payment;
      amount: Money;
      reason: RefundReason;
      source: 'booking' | 'unapplied';
      cancelsBooking?: boolean;
      needsApproval?: boolean;
    },
  ): Promise<string> {
    const refund = await tx.refund.create({
      data: {
        bookingId: input.payment.bookingId,
        paymentId: input.payment.id,
        provider: input.payment.provider,
        amountMinor: input.amount.minor,
        currency: input.amount.currency,
        destination: input.payment.kind === 'wallet' ? 'wallet' : 'original',
        reason: input.reason,
        status: input.needsApproval ? 'pending_approval' : 'approved',
        automatic: true,
        source: input.source,
        cancelsBooking: input.cancelsBooking ?? false,
        approvedAt: input.needsApproval ? null : new Date(),
      },
    });
    await this.audit.record(
      {
        action: 'refund.created',
        actorType: 'system',
        targetType: 'refund',
        targetId: refund.id,
        metadata: {
          bookingId: refund.bookingId,
          paymentId: refund.paymentId,
          amountMinor: refund.amountMinor.toString(),
          currency: refund.currency,
          reason: refund.reason,
          automatic: true,
          needsApproval: input.needsApproval ?? false,
        },
      },
      tx,
    );
    return refund.id;
  }

  /**
   * Refunds up to `amount` (default: the whole booking balance) across the booking's applied
   * payments, newest first, each capped by what that payment can still return.
   */
  async refundBookingBalance(
    tx: Tx,
    booking: { id: string; currency: string },
    reason: RefundReason,
    options: { amount?: Money; needsApproval?: boolean } = {},
  ): Promise<string[]> {
    const balance = await this.ledger.balance(tx, {
      kind: 'booking',
      bookingId: booking.id,
      currency: booking.currency,
    });
    let remaining = options.amount ? minOf(options.amount, balance) : balance;
    const payments = await tx.payment.findMany({
      where: {
        bookingId: booking.id,
        status: 'succeeded',
        requiresRefund: false,
        currency: booking.currency,
      },
      orderBy: { succeededAt: 'desc' },
    });
    const ids: string[] = [];
    for (const payment of payments) {
      if (remaining.minor <= 0n) break;
      const take = minOf(await this.refundable(tx, payment), remaining);
      if (take.minor <= 0n) continue;
      ids.push(
        await this.createAutomatic(tx, {
          payment,
          amount: take,
          reason,
          source: 'booking',
          cancelsBooking: true,
          ...(options.needsApproval ? { needsApproval: true } : {}),
        }),
      );
      remaining = subtract(remaining, take);
    }
    return ids;
  }

  /** What a payment can still return: its amount minus refunds that are not failed or rejected. */
  async refundable(db: Tx | PrismaService, payment: Payment): Promise<Money> {
    const refunded = await db.refund.aggregate({
      where: { paymentId: payment.id, status: { in: [...ACTIVE] } },
      _sum: { amountMinor: true },
    });
    return money(payment.amountMinor - (refunded._sum.amountMinor ?? 0n), payment.currency);
  }

  /** A staff refund (maker); needs a checker above the threshold (ADR-019). */
  async requestByStaff(
    bookingId: string,
    input: CreateRefundRequest,
    staff: StaffActor,
  ): Promise<AdminRefundDto> {
    const amount = money(BigInt(input.amount.amountMinor), input.amount.currency);
    if (amount.minor <= 0n) throw refundInvalid('The amount must be positive.');
    const converter = await this.fx.converter();
    const inNaira = converter.convert(amount, 'NGN');
    const needsApproval = inNaira.minor > BigInt(this.config.REFUND_APPROVAL_THRESHOLD_NGN);

    const refund = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
      const booking = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException();
      const payment = await tx.payment.findFirst({ where: { id: input.paymentId, bookingId } });
      if (payment?.status !== 'succeeded') throw refundInvalid('That payment was not received.');
      if (payment.currency !== amount.currency)
        throw refundInvalid('Refund in the currency of the payment.');
      const destination = payment.kind === 'wallet' ? 'wallet' : input.destination;
      if (destination === 'wallet' && !booking.userId) {
        throw refundInvalid('Guest bookings cannot be refunded to a wallet.');
      }
      const refundable = await this.refundable(tx, payment);
      if (amount.minor > refundable.minor) {
        throw refundInvalid(
          `At most ${refundable.minor.toString()} minor units can still be refunded for this payment.`,
        );
      }
      if (input.cancelBooking) {
        if (booking.status === 'CONFIRMED') {
          await this.transitions.apply(
            tx,
            booking,
            'request_refund',
            { type: 'staff', userId: staff.userId, context: staff.context },
            { reason: input.reason },
          );
        } else if (booking.status !== 'REFUND_PENDING') {
          throw refundInvalid(
            'Only confirmed bookings (or bookings waiting for a refund) can be cancelled with a refund.',
          );
        }
      }
      const created = await tx.refund.create({
        data: {
          bookingId,
          paymentId: payment.id,
          provider: payment.provider,
          amountMinor: amount.minor,
          currency: amount.currency,
          destination,
          reason: input.reason,
          status: needsApproval ? 'pending_approval' : 'approved',
          automatic: false,
          source: payment.requiresRefund ? 'unapplied' : 'booking',
          cancelsBooking: input.cancelBooking,
          note: input.note,
          requestedByUserId: staff.userId,
          approvedAt: needsApproval ? null : new Date(),
        },
        include: { booking: { select: { reference: true } } },
      });
      await this.audit.record(
        {
          action: 'refund.created',
          actorUserId: staff.userId,
          targetType: 'refund',
          targetId: created.id,
          context: staff.context,
          metadata: {
            bookingId,
            paymentId: payment.id,
            amountMinor: amount.minor.toString(),
            currency: amount.currency,
            reason: input.reason,
            destination,
            needsApproval,
          },
        },
        tx,
      );
      return created;
    });
    if (refund.status === 'approved') this.executeLater([refund.id]);
    return toAdminRefund(refund);
  }

  /** The checker: someone other than the requester approves (ADR-019). */
  async approve(refundId: string, staff: StaffActor): Promise<AdminRefundDto> {
    const refund = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, refundId);
      if (current.status !== 'pending_approval') throw refundState();
      if (current.requestedByUserId === staff.userId) throw makerChecker();
      const updated = await tx.refund.update({
        where: { id: refundId },
        data: { status: 'approved', approvedByUserId: staff.userId, approvedAt: new Date() },
        include: { booking: { select: { reference: true } } },
      });
      await this.audit.record(
        {
          action: 'refund.approved',
          actorUserId: staff.userId,
          targetType: 'refund',
          targetId: refundId,
          context: staff.context,
          metadata: { bookingId: updated.bookingId },
        },
        tx,
      );
      return updated;
    });
    this.executeLater([refund.id]);
    return toAdminRefund(refund);
  }

  async reject(refundId: string, staff: StaffActor, reason: string): Promise<AdminRefundDto> {
    const refund = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, refundId);
      if (current.status !== 'pending_approval') throw refundState();
      const updated = await tx.refund.update({
        where: { id: refundId },
        data: { status: 'rejected', rejectionReason: reason },
        include: { booking: { select: { reference: true } } },
      });
      await this.audit.record(
        {
          action: 'refund.rejected',
          actorUserId: staff.userId,
          targetType: 'refund',
          targetId: refundId,
          context: staff.context,
          metadata: { bookingId: updated.bookingId },
        },
        tx,
      );
      return updated;
    });
    return toAdminRefund(refund);
  }

  /** Operations settle a refund in review after checking the provider's dashboard. */
  async resolve(
    refundId: string,
    staff: StaffActor,
    outcome: 'succeeded' | 'failed',
    providerRefundId: string | null,
  ): Promise<AdminRefundDto> {
    const current = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!current) throw new NotFoundException();
    if (current.status !== 'needs_review' && current.status !== 'processing') throw refundState();
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, refundId);
      if (outcome === 'succeeded') await this.settleTx(tx, locked, providerRefundId);
      else await this.failTx(tx, locked, 'resolved_failed');
      await this.audit.record(
        {
          action: 'refund.resolved',
          actorUserId: staff.userId,
          targetType: 'refund',
          targetId: refundId,
          context: staff.context,
          metadata: { outcome },
        },
        tx,
      );
    });
    if (outcome === 'succeeded') await this.notifications.refundCompleted(refundId);
    return this.adminGet(refundId);
  }

  async adminGet(refundId: string): Promise<AdminRefundDto> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { booking: { select: { reference: true } } },
    });
    if (!refund) throw new NotFoundException();
    return toAdminRefund(refund);
  }

  async adminList(filter: {
    status?: RefundStatus;
    bookingId?: string;
    limit: number;
  }): Promise<AdminRefundDto[]> {
    const refunds = await this.prisma.refund.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.bookingId ? { bookingId: filter.bookingId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit,
      include: { booking: { select: { reference: true } } },
    });
    return refunds.map(toAdminRefund);
  }

  // -------------------------------------------------------------------------
  // Executing and settling
  // -------------------------------------------------------------------------

  /** Runs approved refunds off the request (API) or in the worker sweep. */
  executeLater(ids: readonly string[]): void {
    for (const id of ids) this.background.run('refund', () => this.execute(id));
  }

  /** Sends one approved refund; safe to call concurrently (the status claim decides). */
  async execute(
    refundId: string,
  ): Promise<'succeeded' | 'processing' | 'failed' | 'needs_review' | 'skipped'> {
    const { count } = await this.prisma.refund.updateMany({
      where: { id: refundId, status: 'approved' },
      data: { status: 'processing', attempts: { increment: 1 }, processedAt: new Date() },
    });
    if (count === 0) return 'skipped';
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: true },
    });

    if (refund.destination === 'wallet') {
      const booking = await this.prisma.booking.findUniqueOrThrow({
        where: { id: refund.bookingId },
        select: { userId: true },
      });
      if (!booking.userId) return this.failNow(refund, 'no_wallet');
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.ledger.post(tx, {
            key: `refund:${refund.id}:to-wallet`,
            kind: 'refund_to_wallet',
            bookingId: refund.bookingId,
            paymentId: refund.paymentId,
            refundId: refund.id,
            lines: transfer(
              sourceAccount(refund),
              { kind: 'wallet', userId: booking.userId ?? '', currency: refund.currency },
              money(refund.amountMinor, refund.currency),
            ),
          });
          await tx.refund.update({
            where: { id: refund.id },
            data: { status: 'succeeded', settledAt: new Date() },
          });
          await this.auditOutcome(tx, refund, 'refund.succeeded');
          await this.finalizeBooking(tx, refund.bookingId);
        });
      } catch (error) {
        if (error instanceof InsufficientBalanceError)
          return this.failNow(refund, 'insufficient_balance');
        throw error;
      }
      await this.notifications.refundCompleted(refund.id);
      return 'succeeded';
    }

    const provider = this.providers.find(refund.provider);
    if (!provider) return this.review(refund, 'provider_disabled');
    try {
      await this.prisma.$transaction((tx) =>
        this.ledger.post(tx, {
          key: `refund:${refund.id}:initiated`,
          kind: 'refund_initiated',
          bookingId: refund.bookingId,
          paymentId: refund.paymentId,
          refundId: refund.id,
          lines: transfer(
            sourceAccount(refund),
            inFlight(refund),
            money(refund.amountMinor, refund.currency),
          ),
        }),
      );
    } catch (error) {
      if (error instanceof InsufficientBalanceError)
        return this.failNow(refund, 'insufficient_balance');
      throw error;
    }
    if (refund.attempts <= 1) await this.notifications.refundStarted(refund.id);
    return this.callProvider(refund, provider);
  }

  private async callProvider(
    refund: Refund & { payment: Payment },
    provider: PaymentProvider,
  ): Promise<'succeeded' | 'processing' | 'failed' | 'needs_review'> {
    let result: ProviderRefund;
    try {
      result = await provider.refund({
        refundId: refund.id,
        payment: paymentRef(refund.payment),
        amount: money(refund.amountMinor, refund.currency),
      });
    } catch (error) {
      if (error instanceof PaymentProviderRequestError) {
        await this.fail(refund.id, 'provider_rejected');
        return 'failed';
      }
      // The call may have reached the provider: retry only where that cannot refund twice.
      this.logger.warn(
        { refundId: refund.id, provider: provider.name, reason: (error as Error).name },
        'refund call failed',
      );
      if (provider.idempotentRefunds) return 'processing';
      return this.review(refund, 'ambiguous_provider_response');
    }
    return this.applyProviderResult(refund.id, result);
  }

  private async applyProviderResult(
    refundId: string,
    result: ProviderRefund,
  ): Promise<'succeeded' | 'processing' | 'failed'> {
    if (result.status === 'succeeded') {
      await this.settle(refundId, result.providerRefundId);
      return 'succeeded';
    }
    if (result.status === 'failed') {
      await this.fail(refundId, result.failureReason ?? 'provider_failed', result.providerRefundId);
      return 'failed';
    }
    await this.prisma.refund.update({
      where: { id: refundId },
      data: { status: 'processing', providerRefundId: result.providerRefundId },
    });
    return 'processing';
  }

  async settle(refundId: string, providerRefundId: string | null): Promise<void> {
    const changed = await this.prisma.$transaction(async (tx) =>
      this.settleTx(tx, await this.lock(tx, refundId), providerRefundId),
    );
    if (changed) await this.notifications.refundCompleted(refundId);
  }

  async fail(
    refundId: string,
    reason: string,
    providerRefundId: string | null = null,
  ): Promise<void> {
    const changed = await this.prisma.$transaction(async (tx) => {
      const refund = await this.lock(tx, refundId);
      if (providerRefundId && !refund.providerRefundId) {
        await tx.refund.update({ where: { id: refundId }, data: { providerRefundId } });
      }
      return this.failTx(tx, refund, reason);
    });
    if (changed) await this.alertFailed(refundId, reason);
  }

  /** Money reached the customer: in-flight becomes paid out, and the booking may close. */
  private async settleTx(
    tx: Tx,
    refund: Refund,
    providerRefundId: string | null,
  ): Promise<boolean> {
    if (refund.status === 'succeeded') return false;
    await this.ledger.post(tx, {
      key: `refund:${refund.id}:settled`,
      kind: 'refund_settled',
      bookingId: refund.bookingId,
      paymentId: refund.paymentId,
      refundId: refund.id,
      lines: transfer(
        inFlight(refund),
        { kind: 'psp', provider: refund.provider, currency: refund.currency },
        money(refund.amountMinor, refund.currency),
      ),
    });
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: 'succeeded',
        settledAt: new Date(),
        ...(providerRefundId ? { providerRefundId } : {}),
      },
    });
    await this.auditOutcome(tx, refund, 'refund.succeeded');
    await this.finalizeBooking(tx, refund.bookingId);
    return true;
  }

  /** The refund did not happen: the money goes back to where it came from in the ledger. */
  private async failTx(tx: Tx, refund: Refund, reason: string): Promise<boolean> {
    if (refund.status === 'failed' || refund.status === 'succeeded') return false;
    if (await this.ledger.posted(tx, `refund:${refund.id}:initiated`)) {
      await this.ledger.post(tx, {
        key: `refund:${refund.id}:failed`,
        kind: 'refund_failed',
        bookingId: refund.bookingId,
        paymentId: refund.paymentId,
        refundId: refund.id,
        lines: transfer(
          inFlight(refund),
          sourceAccount(refund),
          money(refund.amountMinor, refund.currency),
        ),
      });
    }
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: 'failed', failureReason: reason },
    });
    await this.auditOutcome(tx, refund, 'refund.failed', reason);
    return true;
  }

  private async failNow(refund: Refund, reason: string): Promise<'failed'> {
    await this.fail(refund.id, reason);
    return 'failed';
  }

  private async review(refund: Refund, reason: string): Promise<'needs_review'> {
    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: 'needs_review', failureReason: reason },
      });
      await this.auditOutcome(tx, refund, 'refund.needs_review', reason);
    });
    await this.alert('refund.needs_review', refund.id, reason);
    return 'needs_review';
  }

  /** A REFUND_PENDING booking whose money has all gone back becomes REFUNDED. */
  async finalizeBooking(tx: Tx, bookingId: string): Promise<void> {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true, currency: true },
    });
    if (booking?.status !== 'REFUND_PENDING') return;
    const [balance, open] = await Promise.all([
      this.ledger.balance(tx, { kind: 'booking', bookingId, currency: booking.currency }),
      tx.refund.count({ where: { bookingId, status: { in: [...OPEN] } } }),
    ]);
    if (balance.minor === 0n && open === 0) {
      await this.transitions.apply(tx, booking, 'refunded', SYSTEM_ACTOR);
    }
  }

  // -------------------------------------------------------------------------
  // Provider refund events (webhooks)
  // -------------------------------------------------------------------------

  /** Applies a verified refund webhook inside the webhook transaction; returns the refund id. */
  async applyProviderEvent(
    tx: Tx,
    provider: string,
    event: PaymentEvent,
  ): Promise<{ refundId: string | null; outcome: string }> {
    const refund = await this.findForEvent(tx, provider, event);
    if (!refund) return { refundId: null, outcome: 'unknown_refund' };
    const locked = await this.lock(tx, refund.id);
    const changed =
      event.type === 'refund.succeeded'
        ? await this.settleTx(tx, locked, event.providerRefundId)
        : await this.failTx(tx, locked, event.failureReason ?? 'provider_failed');
    return { refundId: refund.id, outcome: changed ? event.type : 'ignored' };
  }

  private async findForEvent(
    tx: Tx,
    provider: string,
    event: PaymentEvent,
  ): Promise<Refund | null> {
    if (event.refundId) {
      const byOurs = await tx.refund
        .findUnique({ where: { id: event.refundId } })
        .catch(() => null);
      if (byOurs?.provider === provider) return byOurs;
    }
    if (event.providerRefundId) {
      const byTheirs = await tx.refund.findUnique({
        where: {
          provider_providerRefundId: { provider, providerRefundId: event.providerRefundId },
        },
      });
      if (byTheirs) return byTheirs;
    }
    if (!event.providerReference || !event.amount) return null;
    // The webhook can beat our own record of the provider's refund id: match the one candidate.
    const candidates = await tx.refund.findMany({
      where: {
        provider,
        providerRefundId: null,
        status: { in: ['processing', 'needs_review'] },
        amountMinor: event.amount.minor,
        currency: event.amount.currency,
        payment: { providerReference: event.providerReference },
      },
    });
    return candidates.length === 1 ? (candidates[0] ?? null) : null;
  }

  // -------------------------------------------------------------------------
  // Worker sweep
  // -------------------------------------------------------------------------

  async processDue(
    now = new Date(),
  ): Promise<{ executed: number; settled: number; review: number }> {
    const counts = { executed: 0, settled: 0, review: 0 };
    const stopStartingAt = Date.now() + SWEEP_BUDGET_MS;
    const approved = await this.prisma.refund.findMany({
      where: { status: 'approved' },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    for (const { id } of approved) {
      if (Date.now() > stopStartingAt) return counts;
      const outcome = await this.execute(id);
      if (outcome !== 'skipped') counts.executed += 1;
      if (outcome === 'needs_review') counts.review += 1;
    }

    const processing = await this.prisma.refund.findMany({
      where: { status: 'processing', updatedAt: { lt: new Date(now.getTime() - POLL_AFTER_MS) } },
      include: { payment: true },
      orderBy: { updatedAt: 'asc' },
      take: BATCH,
    });
    for (const refund of processing) {
      if (Date.now() > stopStartingAt) return counts;
      const provider = this.providers.find(refund.provider);
      if (!provider) continue;
      try {
        if (!refund.providerRefundId) {
          // Interrupted or ambiguous: repeating the call is only safe with an idempotency key.
          if (!provider.idempotentRefunds) {
            await this.review(refund, 'interrupted');
            counts.review += 1;
          } else if ((await this.callProvider(refund, provider)) === 'succeeded') {
            counts.settled += 1;
          }
          continue;
        }
        const state = await provider.getRefund(refund.providerRefundId, paymentRef(refund.payment));
        if (state && state.status !== 'pending') {
          if ((await this.applyProviderResult(refund.id, state)) === 'succeeded')
            counts.settled += 1;
        } else if (
          !state &&
          refund.processedAt &&
          now.getTime() - refund.processedAt.getTime() >
            this.config.REFUND_REVIEW_AFTER_HOURS * 3_600_000
        ) {
          await this.review(refund, 'provider_pending_too_long');
          counts.review += 1;
        } else {
          await this.prisma.refund.update({ where: { id: refund.id }, data: { updatedAt: now } });
        }
      } catch (error) {
        this.logger.warn(
          { refundId: refund.id, reason: (error as Error).name },
          'refund poll failed',
        );
      }
    }

    const reviews = await this.prisma.refund.findMany({
      where: {
        status: 'needs_review',
        updatedAt: { lt: new Date(now.getTime() - RECONCILE_AFTER_MS) },
      },
      include: { payment: true },
      orderBy: { updatedAt: 'asc' },
      take: BATCH,
    });
    for (const refund of reviews) {
      if (Date.now() > stopStartingAt) return counts;
      const provider = this.providers.find(refund.provider);
      if (!provider) continue;
      try {
        const listed = await provider.listRefunds(paymentRef(refund.payment));
        if (!listed) continue;
        const match =
          listed.find((item) => item.refundId === refund.id) ??
          (() => {
            const sameAmount = listed.filter(
              (item) => item.amount?.minor === refund.amountMinor && item.refundId === null,
            );
            return sameAmount.length === 1 ? sameAmount[0] : undefined;
          })();
        if (!match) {
          await this.prisma.refund.update({ where: { id: refund.id }, data: { updatedAt: now } });
          continue;
        }
        if ((await this.applyProviderResult(refund.id, match)) === 'succeeded') counts.settled += 1;
      } catch (error) {
        this.logger.warn(
          { refundId: refund.id, reason: (error as Error).name },
          'refund reconciliation failed',
        );
      }
    }
    return counts;
  }

  // -------------------------------------------------------------------------

  private async lock(tx: Tx, refundId: string): Promise<Refund> {
    await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    const refund = await tx.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw new NotFoundException();
    return refund;
  }

  private async auditOutcome(
    tx: Tx,
    refund: Refund,
    action: 'refund.succeeded' | 'refund.failed' | 'refund.needs_review',
    reason?: string,
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        actorType: 'system',
        targetType: 'refund',
        targetId: refund.id,
        metadata: { bookingId: refund.bookingId, ...(reason ? { reason } : {}) },
      },
      tx,
    );
  }

  private async alertFailed(refundId: string, reason: string): Promise<void> {
    await this.alert('refund.failed', refundId, reason);
  }

  private async alert(kind: string, refundId: string, reason: string): Promise<void> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { booking: { select: { reference: true } } },
    });
    await this.notifications.ops(kind, refund?.booking.reference ?? null, {
      refundId,
      reason,
      ...(refund
        ? {
            amountMinor: refund.amountMinor.toString(),
            currency: refund.currency,
            provider: refund.provider,
          }
        : {}),
    });
  }
}
