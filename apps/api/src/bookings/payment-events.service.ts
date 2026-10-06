import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { money, toWire } from '@suskii/shared';

import { BackgroundTasks } from '../common/background-tasks';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma } from '../generated/prisma/client';
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
import { paymentReturnUrl } from './booking-urls';
import { RefundsService } from './refunds.service';
import { TicketingService } from './ticketing.service';

type Tx = Prisma.TransactionClient;

interface Processed {
  outcome: string;
  paidBookingId: string | null;
  refundIds: string[];
  settledRefundId: string | null;
}

const NOTHING = { paidBookingId: null, refundIds: [], settledRefundId: null };

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
      throw invalidWebhook();
    }
    if (!event) return 'ignored';
    try {
      event = await provider.confirm(event);
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        this.logger.warn(
          { provider: providerName, type: event.type },
          'webhook not confirmed by provider',
        );
        throw invalidWebhook();
      }
      if (error instanceof PaymentProviderUnavailableError) throw paymentProviderDown();
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
        return 'duplicate';
      }
      throw error;
    }
    this.logger.log(
      { provider, type: event.type, outcome: processed.outcome },
      'payment event processed',
    );
    const paid = processed.paidBookingId;
    if (paid) this.background.run('ticketing', () => this.ticketing.process(paid));
    if (processed.outcome === 'held_for_review' && event.providerReference) {
      const reference = event.providerReference;
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
    if (found?.provider !== provider) return { ...NOTHING, outcome: 'unknown_payment' };
    // One payment event at a time per booking.
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${found.bookingId}::uuid FOR UPDATE`;
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: found.bookingId } });
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });

    if (event.type === 'payment.failed' || event.type === 'checkout.expired') {
      if (payment.status !== 'pending') return { ...NOTHING, outcome: 'ignored' };
      const failed = event.type === 'payment.failed';
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: failed ? 'failed' : 'expired',
          failureReason: event.failureReason ?? (failed ? 'failed' : 'expired'),
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
      return { ...NOTHING, outcome: failed ? 'failed' : 'expired' };
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
    return { ...NOTHING, ...result };
  }

  // -------------------------------------------------------------------------
  // Mock hosted checkout (PAYMENT_PROVIDERS includes mock)
  // -------------------------------------------------------------------------

  async mockPayment(reference: string): Promise<z.infer<typeof mockPaymentSchema>> {
    const payment = await this.mockPaymentRow(reference);
    return {
      reference: payment.providerReference,
      bookingReference: payment.booking.reference,
      amount: toWire(money(payment.amountMinor, payment.currency)),
      status: payment.status,
      expiresAt: payment.expiresAt.toISOString(),
      returnUrl: paymentReturnUrl(this.config, payment.bookingId, payment.booking.channel),
    };
  }

  /** The mock page's buttons: builds the provider's signed webhook and sends it through `receive`. */
  async completeMock(
    reference: string,
    outcome: 'succeeded' | 'failed',
    card: PaymentCard | null = null,
  ): Promise<z.infer<typeof mockPaymentResultSchema>> {
    const payment = await this.mockPaymentRow(reference);
    if (payment.status !== 'pending' || payment.expiresAt <= new Date()) throw paymentClosed();
    const amount = money(payment.amountMinor, payment.currency);
    this.mock.recordOutcome(reference, outcome, amount);
    if (this.mock.dropNextWebhooks > 0) {
      // Test hook: the provider took the money but its webhook never arrives (reconciliation).
      this.mock.dropNextWebhooks -= 1;
    } else {
      const { rawBody, headers } = this.mock.signedEvent(reference, outcome, amount, card);
      await this.receive(this.mock.name, rawBody, headers);
    }
    const after = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return {
      status: after.status,
      returnUrl: paymentReturnUrl(this.config, payment.bookingId, payment.booking.channel),
    };
  }

  private async mockPaymentRow(reference: string) {
    if (!this.providers.find(this.mock.name)) throw new NotFoundException();
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      include: { booking: { select: { reference: true, channel: true } } },
    });
    if (payment?.provider !== this.mock.name) throw new NotFoundException();
    return payment;
  }
}
