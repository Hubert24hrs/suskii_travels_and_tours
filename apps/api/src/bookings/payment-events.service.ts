import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { money, toWire } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma, type BookingStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { MockPaymentProvider } from '../payments/mock-payment-provider';
import {
  PaymentProvider,
  type PaymentEvent,
  type WebhookHeaders,
} from '../payments/payment-provider';

import { bookingPrice } from './booking-presenter';
import { BookingTransitions, WEBHOOK_ACTOR } from './booking-transitions';
import { invalidWebhook, paymentClosed } from './booking.errors';
import type { mockPaymentResultSchema, mockPaymentSchema } from './bookings.schemas';
import { bookingUrl } from './checkout.service';
import { TicketingService } from './ticketing.service';

type Tx = Prisma.TransactionClient;

/** Statuses a successful payment can still apply to (see the state machine). */
const PAYABLE: readonly BookingStatus[] = ['PRICED', 'HELD', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'];

interface Processed {
  outcome: string;
  paidBookingId: string | null;
}

/**
 * Payment webhooks, the source of truth for payment status (ADR-014). Events are verified over
 * the raw body, stored once per provider event id and applied under a row lock on the booking. A
 * success is applied only when its amount equals the payment's; money that the booking cannot
 * take (a second payment, a stale amount, a closed booking) is flagged for refund.
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly mock: MockPaymentProvider,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly ticketing: TicketingService,
    private readonly background: BackgroundTasks,
  ) {}

  async receive(
    providerName: string,
    rawBody: Buffer | undefined,
    headers: WebhookHeaders,
  ): Promise<string> {
    if (providerName !== this.provider.name) throw new NotFoundException();
    if (!rawBody) throw invalidWebhook();
    let event: PaymentEvent;
    try {
      event = this.provider.parseWebhook(rawBody, headers);
    } catch (error) {
      this.logger.warn(
        { provider: providerName, reason: (error as Error).name },
        'webhook rejected',
      );
      throw invalidWebhook();
    }
    return this.apply(providerName, event);
  }

  private async apply(provider: string, event: PaymentEvent): Promise<string> {
    let processed: Processed;
    try {
      processed = await this.prisma.$transaction(async (tx) => {
        const stored = await tx.webhookEvent.create({
          data: {
            provider,
            eventId: event.eventId,
            type: event.type,
            providerReference: event.providerReference,
            // Normalised fields only; providers never send card data to hosted-checkout webhooks.
            payload: {
              amount: { ...toWire(event.amount) },
              occurredAt: event.occurredAt,
              failureReason: event.failureReason,
            },
          },
        });
        const result = await this.process(tx, provider, event);
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
      'webhook processed',
    );
    const paid = processed.paidBookingId;
    if (paid) this.background.run('ticketing', () => this.ticketing.process(paid));
    return processed.outcome;
  }

  private async process(tx: Tx, provider: string, event: PaymentEvent): Promise<Processed> {
    const found = await tx.payment.findUnique({
      where: { providerReference: event.providerReference },
    });
    if (found?.provider !== provider) return { outcome: 'unknown_payment', paidBookingId: null };
    // One payment event at a time per booking.
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${found.bookingId}::uuid FOR UPDATE`;
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: found.bookingId } });
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });

    if (event.type === 'payment.failed') {
      if (payment.status !== 'pending') return { outcome: 'ignored', paidBookingId: null };
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: event.failureReason ?? 'failed' },
      });
      const latest = await tx.payment.findFirst({
        where: { bookingId: booking.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (booking.status === 'AWAITING_PAYMENT' && latest?.id === payment.id) {
        await this.transitions.apply(tx, booking, 'payment_abandoned', WEBHOOK_ACTOR, {
          reason: 'payment_failed',
        });
      }
      return { outcome: 'failed', paidBookingId: null };
    }

    if (payment.status === 'succeeded')
      return { outcome: 'already_succeeded', paidBookingId: null };
    if (event.amount.minor !== payment.amountMinor || event.amount.currency !== payment.currency) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { failureReason: 'amount_mismatch', requiresRefund: true },
      });
      await this.audit.record(
        {
          action: 'payment.amount_mismatch',
          actorType: 'system',
          targetType: 'payment',
          targetId: payment.id,
          metadata: {
            bookingId: booking.id,
            expectedMinor: payment.amountMinor.toString(),
            receivedMinor: event.amount.minor.toString(),
            expectedCurrency: payment.currency,
            receivedCurrency: event.amount.currency,
          },
        },
        tx,
      );
      return { outcome: 'amount_mismatch', paidBookingId: null };
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'succeeded', succeededAt: new Date(event.occurredAt) },
    });
    const payable = PAYABLE.includes(booking.status);
    const matchesTotal =
      payment.amountMinor === booking.totalMinor && payment.currency === booking.currency;
    if (!payable || !matchesTotal) {
      await tx.payment.update({ where: { id: payment.id }, data: { requiresRefund: true } });
      await this.audit.record(
        {
          action: 'payment.requires_refund',
          actorType: 'system',
          targetType: 'payment',
          targetId: payment.id,
          metadata: {
            bookingId: booking.id,
            bookingStatus: booking.status,
            reason: payable ? 'amount_differs_from_booking' : 'booking_not_payable',
          },
        },
        tx,
      );
      return { outcome: 'requires_refund', paidBookingId: null };
    }

    await tx.payment.updateMany({
      where: { bookingId: booking.id, status: 'pending', id: { not: payment.id } },
      data: { status: 'cancelled' },
    });
    await this.transitions.apply(tx, booking, 'payment_succeeded', WEBHOOK_ACTOR, {
      data: { pendingPrice: Prisma.DbNull, paymentDeadline: null },
    });
    const discount = bookingPrice(booking).discount;
    if (booking.promoCodeId && discount) {
      await tx.promoRedemption.create({
        data: {
          promoCodeId: booking.promoCodeId,
          userId: booking.userId,
          bookingId: booking.id,
          amountMinor: BigInt(discount.amount.amountMinor),
          currency: discount.amount.currency,
        },
      });
    }
    return { outcome: 'paid', paidBookingId: booking.id };
  }

  // -------------------------------------------------------------------------
  // Mock hosted checkout (PAYMENT_PROVIDER=mock only)
  // -------------------------------------------------------------------------

  async mockPayment(reference: string): Promise<z.infer<typeof mockPaymentSchema>> {
    const payment = await this.mockPaymentRow(reference);
    return {
      reference: payment.providerReference,
      bookingReference: payment.booking.reference,
      amount: toWire(money(payment.amountMinor, payment.currency)),
      status: payment.status,
      expiresAt: payment.expiresAt.toISOString(),
      returnUrl: bookingUrl(this.config, payment.bookingId),
    };
  }

  /** The mock page's buttons: builds the provider's signed webhook and sends it through `receive`. */
  async completeMock(
    reference: string,
    outcome: 'succeeded' | 'failed',
  ): Promise<z.infer<typeof mockPaymentResultSchema>> {
    const payment = await this.mockPaymentRow(reference);
    if (payment.status !== 'pending' || payment.expiresAt <= new Date()) throw paymentClosed();
    const { rawBody, headers } = this.mock.signedEvent(
      reference,
      outcome,
      money(payment.amountMinor, payment.currency),
    );
    await this.receive(this.mock.name, rawBody, headers);
    const after = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { status: after.status, returnUrl: bookingUrl(this.config, payment.bookingId) };
  }

  private async mockPaymentRow(reference: string) {
    if (this.provider.name !== this.mock.name) throw new NotFoundException();
    const payment = await this.prisma.payment.findUnique({
      where: { providerReference: reference },
      include: { booking: { select: { reference: true } } },
    });
    if (payment?.provider !== this.mock.name) throw new NotFoundException();
    return payment;
  }
}
