import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { allocate, equals, money, toWire, type Money } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import { CompanyTopUps } from '../companies/company-top-ups';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma, type Booking, type Payment } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { MockPaymentProvider } from '../payments/mock-payment-provider';
import {
  PaymentProviderUnavailableError,
  WebhookVerificationError,
  type PaymentCard,
  type PaymentEvent,
  type WebhookHeaders,
} from '../payments/payment-provider';
import { PaymentProviders } from '../payments/payment-providers';

import { BookingNotifications } from './booking-notifications';
import { BookingPaymentsService } from './booking-payments.service';
import { BookingTransitions, WEBHOOK_ACTOR } from './booking-transitions';
import { invalidWebhook, paymentClosed, paymentProviderDown } from './booking.errors';
import type { mockPaymentResultSchema, mockPaymentSchema } from './bookings.schemas';
import { companyTopUpReturnUrl, paymentReturnUrl, tripPaymentReturnUrl } from './booking-urls';
import { RefundsService } from './refunds.service';
import { TicketingService } from './ticketing.service';
import { paymentWebhooks, payments } from '../telemetry/metrics';

type Tx = Prisma.TransactionClient;

interface Processed {
  outcome: string;
  /** Bookings paid in full by this event: ticketing starts for each. */
  paidBookingIds: string[];
  refundIds: string[];
  settledRefundId: string | null;
  /** Payments held for a risk review (ADR-040), by their own reference: operations hear of each. */
  heldReferences: string[];
}

const NOTHING = { paidBookingIds: [], refundIds: [], settledRefundId: null, heldReferences: [] };

/**
 * Payment and refund webhooks, the source of truth for money (ADR-014, ADR-016). Events are
 * verified over the raw body, confirmed with the provider where its signature proves little,
 * stored once per provider event id and applied under a row lock on the booking. Reconciliation
 * feeds provider lookups through the same pipeline, so every outcome is applied exactly once.
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly mock: MockPaymentProvider,
    private readonly payments: BookingPaymentsService,
    private readonly refunds: RefundsService,
    private readonly transitions: BookingTransitions,
    private readonly ticketing: TicketingService,
    private readonly background: BackgroundTasks,
    private readonly notifications: BookingNotifications,
    private readonly topUps: CompanyTopUps,
    private readonly audit: AuditService,
  ) {}

  async receive(
    providerName: string,
    rawBody: Buffer | undefined,
    headers: WebhookHeaders,
  ): Promise<string> {
    const provider = this.providers.find(providerName);
    if (!provider) throw new NotFoundException();
    if (!rawBody) throw invalidWebhook();
    let event: PaymentEvent | null;
    try {
      event = provider.parseWebhook(rawBody, headers);
    } catch (error) {
      this.logger.warn(
        { provider: providerName, reason: (error as Error).name },
        'webhook rejected',
      );
      paymentWebhooks.add(1, { provider: providerName, result: 'rejected' });
      throw invalidWebhook();
    }
    if (!event) {
      paymentWebhooks.add(1, { provider: providerName, result: 'ignored' });
      return 'ignored';
    }
    try {
      event = await provider.confirm(event);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        this.logger.warn(
          { provider: providerName, type: event.type },
          'webhook not confirmed by provider',
        );
        paymentWebhooks.add(1, { provider: providerName, result: 'unconfirmed' });
        throw invalidWebhook();
      }
      if (error instanceof PaymentProviderUnavailableError) {
        paymentWebhooks.add(1, { provider: providerName, result: 'provider_unavailable' });
        throw paymentProviderDown();
      }
      paymentWebhooks.add(1, { provider: providerName, result: 'failed' });
      throw error;
    }
    return this.apply(providerName, event);
  }

  /** Stores and applies a verified event once per provider event id. */
  async apply(provider: string, event: PaymentEvent): Promise<string> {
    let processed: Processed;
    try {
      processed = await this.prisma.$transaction(async (tx) => {
        const stored = await tx.webhookEvent.create({
          data: {
            provider,
            eventId: event.eventId,
            type: event.type,
            providerReference: event.providerReference ?? event.providerRefundId,
            // Normalised fields only; hosted-checkout providers never send card data.
            payload: {
              amount: event.amount ? { ...toWire(event.amount) } : null,
              occurredAt: event.occurredAt,
              failureReason: event.failureReason,
              method: event.method,
            },
          },
        });
        const result = event.type.startsWith('refund.')
          ? await this.processRefund(tx, provider, event)
          : await this.processPayment(tx, provider, event);
        await tx.webhookEvent.update({
          where: { id: stored.id },
          data: { outcome: result.outcome, processedAt: new Date() },
        });
        return result;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        paymentWebhooks.add(1, { provider, result: 'duplicate' });
        return 'duplicate';
      }
      paymentWebhooks.add(1, { provider, result: 'failed' });
      throw error;
    }
    paymentWebhooks.add(1, { provider, result: 'processed' });
    if (!event.type.startsWith('refund.'))
      payments.add(1, { provider, outcome: processed.outcome });
    this.logger.log(
      { provider, type: event.type, outcome: processed.outcome },
      'payment event processed',
    );
    for (const paid of processed.paidBookingIds) {
      this.background.run('ticketing', () => this.ticketing.process(paid));
    }
    for (const reference of processed.heldReferences) {
      this.background.run('risk-review-alert', () => this.alertReview(reference));
    }
    if (processed.refundIds.length > 0) this.refunds.executeLater(processed.refundIds);
    return processed.outcome;
  }

  /** Operations hear about a held payment at once: a held fare can lapse (ADR-040). */
  private async alertReview(providerReference: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference },
      select: { bookingId: true, booking: { select: { reference: true } } },
    });
    if (!payment) return;
    await this.notifications.ops('payment.risk_review', payment.booking.reference, {
      bookingId: payment.bookingId,
    });
  }

  private async processRefund(tx: Tx, provider: string, event: PaymentEvent): Promise<Processed> {
    const { refundId, outcome } = await this.refunds.applyProviderEvent(tx, provider, event);
    return { ...NOTHING, outcome, settledRefundId: refundId };
  }

  private async processPayment(tx: Tx, provider: string, event: PaymentEvent): Promise<Processed> {
    const found = event.providerReference
      ? await tx.payment.findUnique({ where: { providerReference: event.providerReference } })
      : null;
    if (!found) {
      // Not a booking payment: one checkout for a whole trip (ADR-099), a company wallet top-up
      // (ADR-090), or nothing we know.
      const trip = await this.processTripPayment(tx, provider, event);
      if (trip) return trip;
      const topUp = await this.topUps.applyProviderEvent(tx, provider, event);
      return { ...NOTHING, outcome: topUp ?? 'unknown_payment' };
    }
    // A share of a trip checkout has no events of its own: the provider knows only the trip's.
    if (found.provider !== provider || found.tripPaymentId) {
      return { ...NOTHING, outcome: 'unknown_payment' };
    }
    const { booking, payment } = await this.lockForPayment(tx, found);

    if (event.type === 'payment.failed' || event.type === 'checkout.expired') {
      const failed = event.type === 'payment.failed';
      const closed = await this.closeUnpaid(tx, booking, payment, failed, event.failureReason);
      return { ...NOTHING, outcome: closed ? (failed ? 'failed' : 'expired') : 'ignored' };
    }

    const amount = event.amount ?? money(payment.amountMinor, payment.currency);
    const result = await this.payments.applyReceived(
      tx,
      booking,
      payment,
      {
        amount,
        providerTransactionId: event.providerTransactionId,
        method: event.method,
        occurredAt: new Date(event.occurredAt),
        card: event.card ?? null,
      },
      { kind: 'psp', provider, currency: amount.currency },
      WEBHOOK_ACTOR,
    );
    return {
      ...NOTHING,
      outcome: result.outcome,
      paidBookingIds: result.paidBookingId ? [result.paidBookingId] : [],
      refundIds: result.refundIds,
      heldReferences: result.outcome === 'held_for_review' ? [payment.providerReference] : [],
    };
  }

  /** One payment event at a time per booking: the booking's row lock, then both rows fresh. */
  private async lockForPayment(
    tx: Tx,
    found: { id: string; bookingId: string },
  ): Promise<{ booking: Booking; payment: Payment }> {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${found.bookingId}::uuid FOR UPDATE`;
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: found.bookingId } });
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
    return { booking, payment };
  }

  /**
   * A checkout that failed or ran out: the pending payment closes, and a booking waiting on it
   * (and on no newer one) goes back to PRICED. False when the payment was no longer pending.
   */
  private async closeUnpaid(
    tx: Tx,
    booking: Booking,
    payment: Payment,
    failed: boolean,
    failureReason: string | null,
  ): Promise<boolean> {
    if (payment.status !== 'pending') return false;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: failed ? 'failed' : 'expired',
        failureReason: failureReason ?? (failed ? 'failed' : 'expired'),
      },
    });
    const latest = await tx.payment.findFirst({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (booking.status === 'AWAITING_PAYMENT' && latest?.id === payment.id) {
      await this.transitions.apply(tx, booking, 'payment_abandoned', WEBHOOK_ACTOR, {
        reason: failed ? 'payment_failed' : 'checkout_expired',
      });
    }
    return true;
  }

  /**
   * An event for the one checkout of a trip (ADR-099), or null when the reference is not a trip
   * payment of this provider. The provider charged once; here every booking in the checkout
   * gets its share, each under its own row lock and through the same `applyReceived` a single
   * payment takes, so the ledger, the risk review, ticketing and refunds stay per booking.
   *
   * When the provider charged something else than the trip's total, no share is applied: the
   * money is split across the bookings in proportion and every part is refunded, as a single
   * payment of the wrong amount is.
   */
  private async processTripPayment(
    tx: Tx,
    provider: string,
    event: PaymentEvent,
  ): Promise<Processed | null> {
    if (!event.providerReference) return null;
    const found = await tx.tripPayment.findUnique({
      where: { providerReference: event.providerReference },
      select: { id: true, provider: true },
    });
    if (found?.provider !== provider) return null;
    // One event at a time per trip payment.
    await tx.$queryRaw`SELECT id FROM trip_payments WHERE id = ${found.id}::uuid FOR UPDATE`;
    const tripPayment = await tx.tripPayment.findUniqueOrThrow({ where: { id: found.id } });
    // Bookings are locked in one order everywhere, so two trip events never deadlock.
    const shares = await tx.payment.findMany({
      where: { tripPaymentId: tripPayment.id },
      orderBy: { bookingId: 'asc' },
      select: { id: true, bookingId: true },
    });

    if (event.type === 'payment.failed' || event.type === 'checkout.expired') {
      if (tripPayment.status !== 'pending') return { ...NOTHING, outcome: 'ignored' };
      const failed = event.type === 'payment.failed';
      await tx.tripPayment.update({
        where: { id: tripPayment.id },
        data: {
          status: failed ? 'failed' : 'expired',
          failureReason: event.failureReason ?? (failed ? 'failed' : 'expired'),
        },
      });
      for (const share of shares) {
        const { booking, payment } = await this.lockForPayment(tx, share);
        await this.closeUnpaid(tx, booking, payment, failed, event.failureReason);
      }
      return { ...NOTHING, outcome: failed ? 'trip_failed' : 'trip_expired' };
    }
    if (event.type !== 'payment.succeeded') return { ...NOTHING, outcome: 'ignored' };
    if (tripPayment.status === 'succeeded') return { ...NOTHING, outcome: 'already_succeeded' };

    const requested = money(tripPayment.amountMinor, tripPayment.currency);
    const received = event.amount ?? requested;
    const exact = equals(received, requested);
    await tx.tripPayment.update({
      where: { id: tripPayment.id },
      data: {
        status: 'succeeded',
        succeededAt: new Date(event.occurredAt),
        providerTransactionId: event.providerTransactionId ?? tripPayment.providerTransactionId,
        method: event.method ?? tripPayment.method,
        failureReason: null,
        ...(exact ? {} : { receivedMinor: received.minor, receivedCurrency: received.currency }),
      },
    });

    const processed: Processed = { ...NOTHING, outcome: 'trip_paid' };
    const paid: string[] = [];
    const refunds: string[] = [];
    const held: string[] = [];
    const locked = [];
    for (const share of shares) locked.push(await this.lockForPayment(tx, share));
    // What each booking receives: its own share, or its proportion of a wrong total.
    const amounts = exact
      ? locked.map(({ payment }) => money(payment.amountMinor, payment.currency))
      : locked.length > 0
        ? allocate(
            received,
            locked.map(({ payment }) => payment.amountMinor),
          )
        : [];
    let settled = 0;
    for (const [index, { booking, payment }] of locked.entries()) {
      const amount = amounts[index] ?? money(payment.amountMinor, payment.currency);
      const result = await this.payments.applyReceived(
        tx,
        booking,
        payment,
        {
          amount,
          providerTransactionId: event.providerTransactionId,
          method: event.method,
          occurredAt: new Date(event.occurredAt),
          card: event.card ?? null,
          unexpected: !exact,
        },
        { kind: 'psp', provider, currency: amount.currency },
        WEBHOOK_ACTOR,
      );
      if (result.paidBookingId) paid.push(result.paidBookingId);
      refunds.push(...result.refundIds);
      if (result.outcome === 'held_for_review') held.push(payment.providerReference);
      if (result.outcome === 'paid' || result.outcome === 'held_for_review') settled += 1;
    }
    if (!exact) {
      await this.audit.record(
        {
          action: 'trip.payment_amount_mismatch',
          actorType: 'system',
          targetType: 'trip',
          targetId: tripPayment.tripId,
          metadata: {
            tripPaymentId: tripPayment.id,
            expectedMinor: requested.minor.toString(),
            expectedCurrency: requested.currency,
            receivedMinor: received.minor.toString(),
            receivedCurrency: received.currency,
          },
        },
        tx,
      );
    }
    return {
      ...processed,
      outcome: !exact
        ? 'trip_amount_mismatch'
        : settled === locked.length
          ? 'trip_paid'
          : 'trip_partly_applied',
      paidBookingIds: paid,
      refundIds: refunds,
      heldReferences: held,
    };
  }

  // -------------------------------------------------------------------------
  // Mock hosted checkout (PAYMENT_PROVIDERS includes mock)
  // -------------------------------------------------------------------------

  async mockPayment(reference: string): Promise<z.infer<typeof mockPaymentSchema>> {
    const target = await this.mockTarget(reference);
    return {
      reference,
      bookingReference: target.label,
      amount: toWire(target.amount),
      status: target.status,
      expiresAt: target.expiresAt.toISOString(),
      returnUrl: target.returnUrl,
    };
  }

  /** The mock page's buttons: builds the provider's signed webhook and sends it through `receive`. */
  async completeMock(
    reference: string,
    outcome: 'succeeded' | 'failed',
    card: PaymentCard | null = null,
  ): Promise<z.infer<typeof mockPaymentResultSchema>> {
    const target = await this.mockTarget(reference);
    if (target.status !== 'pending' || target.expiresAt <= new Date()) throw paymentClosed();
    const amount = target.amount;
    this.mock.recordOutcome(reference, outcome, amount);
    if (this.mock.dropNextWebhooks > 0) {
      // Test hook: the provider took the money but its webhook never arrives (reconciliation).
      this.mock.dropNextWebhooks -= 1;
    } else {
      const { rawBody, headers } = this.mock.signedEvent(reference, outcome, amount, card);
      await this.receive(this.mock.name, rawBody, headers);
    }
    const after = await this.mockTarget(reference);
    return { status: after.status, returnUrl: after.returnUrl };
  }

  /**
   * What the mock page charges for: a booking payment, the one checkout of a trip (ADR-099) or
   * a company wallet top-up (ADR-090).
   */
  private async mockTarget(reference: string): Promise<{
    label: string;
    amount: Money;
    status: 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
    expiresAt: Date;
    returnUrl: string;
  }> {
    if (!this.providers.find(this.mock.name)) throw new NotFoundException();
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      include: { booking: { select: { reference: true, channel: true } } },
    });
    if (payment) {
      if (payment.provider !== this.mock.name) throw new NotFoundException();
      return {
        label: payment.booking.reference,
        amount: money(payment.amountMinor, payment.currency),
        status: payment.status,
        expiresAt: payment.expiresAt,
        returnUrl: paymentReturnUrl(this.config, payment.bookingId, payment.booking.channel),
      };
    }
    const tripPayment = await this.prisma.tripPayment.findUnique({
      where: { providerReference: reference },
      include: { trip: { select: { reference: true } } },
    });
    if (tripPayment) {
      if (tripPayment.provider !== this.mock.name) throw new NotFoundException();
      return {
        label: tripPayment.trip.reference,
        amount: money(tripPayment.amountMinor, tripPayment.currency),
        status: tripPayment.status,
        expiresAt: tripPayment.expiresAt,
        returnUrl: tripPaymentReturnUrl(this.config, tripPayment.tripId, tripPayment.channel),
      };
    }
    const topUp = await this.prisma.companyWalletTopUp.findUnique({
      where: { providerReference: reference },
    });
    if (topUp?.provider !== this.mock.name) throw new NotFoundException();
    return {
      label: topUp.reference,
      amount: money(topUp.amountMinor, topUp.currency),
      status: topUp.status,
      expiresAt: topUp.expiresAt,
      returnUrl: companyTopUpReturnUrl(this.config, topUp.id),
    };
  }
}
