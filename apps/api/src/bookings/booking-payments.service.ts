import { Injectable } from '@nestjs/common';

import { add, equals, minOf, money, subtract, type Money, type RefundReason } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { HmacService } from '../crypto/hmac.service';
import { Prisma, type Booking, type BookingStatus, type Payment } from '../generated/prisma/client';
import type { AccountRef } from '../ledger/ledger-accounts';
import { LedgerService, transfer } from '../ledger/ledger.service';
import type { PaymentCard } from '../payments/payment-provider';

import { PAYABLE_STATUSES, BookingFundsService } from './booking-funds.service';
import { bookingPrice } from './booking-presenter';
import { BookingTransitions, type BookingActor } from './booking-transitions';
import { PaymentRiskService } from './payment-risk.service';
import { RefundsService } from './refunds.service';

type Tx = Prisma.TransactionClient;

export interface ReceivedMoney {
  amount: Money;
  providerTransactionId: string | null;
  method: string | null;
  occurredAt: Date;
  /** What the provider reported about the card (risk signals, ADR-040). */
  card?: PaymentCard | null;
}

export interface SettleResult {
  outcome:
    | 'paid'
    | 'partially_paid'
    | 'already_succeeded'
    | 'amount_mismatch'
    | 'requires_refund'
    | 'held_for_review';
  /** Fully paid: ticketing should start. */
  paidBookingId: string | null;
  /** Automatic refunds created for money the booking could not take. */
  refundIds: string[];
}

/** Already paid in full: another payment is a duplicate, not a late one. */
const PAID_STATUSES: readonly BookingStatus[] = ['PAID', 'TICKETING', 'CONFIRMED'];

const REFUND_REASON: Record<string, RefundReason> = {
  booking_not_payable: 'late_payment',
  already_paid: 'duplicate_payment',
  installment_paid: 'duplicate_payment',
  amount_differs: 'amount_mismatch',
  currency_differs: 'amount_mismatch',
};

/**
 * Applies money received for a booking (ADR-016, ADR-017, ADR-018). The caller holds the booking
 * row lock. Money is taken only when the booking can take exactly that amount now: a full
 * payment, the next installment or the remaining balance of a plan. Everything else is received
 * as unapplied money and refunded automatically (ADR-019), never silently kept.
 */
@Injectable()
export class BookingPaymentsService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly funds: BookingFundsService,
    private readonly refunds: RefundsService,
    private readonly transitions: BookingTransitions,
    private readonly audit: AuditService,
    private readonly hmac: HmacService,
    private readonly risk: PaymentRiskService,
  ) {}

  async applyReceived(
    tx: Tx,
    booking: Booking,
    payment: Payment,
    received: ReceivedMoney,
    from: AccountRef,
    actor: BookingActor,
  ): Promise<SettleResult> {
    if (payment.status === 'succeeded') {
      return { outcome: 'already_succeeded', paidBookingId: null, refundIds: [] };
    }
    const captured = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'succeeded',
        succeededAt: received.occurredAt,
        providerTransactionId: received.providerTransactionId ?? payment.providerTransactionId,
        method: received.method ?? payment.method,
        cardCountry: received.card?.country ?? null,
        cardFingerprintHash: received.card?.fingerprint
          ? this.hmac.digest('card-fingerprint', `${payment.provider}:${received.card.fingerprint}`)
          : null,
      },
    });

    // Not what we asked the provider to charge: record it and give it back.
    if (!equals(received.amount, money(payment.amountMinor, payment.currency))) {
      await this.receiveUnapplied(tx, payment, received.amount, from, 'amount_mismatch');
      await this.audit.record(
        {
          action: 'payment.amount_mismatch',
          actorType: 'system',
          targetType: 'payment',
          targetId: payment.id,
          metadata: {
            bookingId: booking.id,
            expectedMinor: payment.amountMinor.toString(),
            receivedMinor: received.amount.minor.toString(),
            expectedCurrency: payment.currency,
            receivedCurrency: received.amount.currency,
          },
        },
        tx,
      );
      const refundId = await this.refunds.createAutomatic(tx, {
        payment,
        amount: received.amount,
        reason: 'amount_mismatch',
        source: 'unapplied',
      });
      return { outcome: 'amount_mismatch', paidBookingId: null, refundIds: [refundId] };
    }

    const plan = await tx.paymentPlan.findUnique({
      where: { bookingId: booking.id },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    });
    const active = plan?.status === 'active' ? plan : null;
    const paidBefore = await this.funds.paid(tx, booking);
    const required = active
      ? money(active.totalMinor, active.currency)
      : money(booking.totalMinor, booking.currency);
    const remaining = subtract(required, paidBefore);

    let reason: string | null = null;
    let settles: string[] = [];
    if (PAID_STATUSES.includes(booking.status)) reason = 'already_paid';
    else if (!PAYABLE_STATUSES.includes(booking.status)) reason = 'booking_not_payable';
    else if (received.amount.currency !== booking.currency) reason = 'currency_differs';
    else if (active && payment.installmentId) {
      const installment = active.installments.find((item) => item.id === payment.installmentId);
      if (installment?.status !== 'pending') reason = 'installment_paid';
      else if (
        !equals(
          received.amount,
          minOf(money(installment.amountMinor, installment.currency), remaining),
        )
      ) {
        reason = 'amount_differs';
      } else settles = [installment.id];
    } else if (active) {
      if (!equals(received.amount, remaining)) reason = 'amount_differs';
      else
        settles = active.installments
          .filter((item) => item.status === 'pending')
          .map((item) => item.id);
    } else if (paidBefore.minor > 0n) reason = 'already_paid';
    else if (!equals(received.amount, required)) reason = 'amount_differs';

    if (reason) {
      await this.receiveUnapplied(tx, payment, received.amount, from, reason);
      await this.audit.record(
        {
          action: 'payment.requires_refund',
          actorType: 'system',
          targetType: 'payment',
          targetId: payment.id,
          metadata: { bookingId: booking.id, bookingStatus: booking.status, reason },
        },
        tx,
      );
      const refundId = await this.refunds.createAutomatic(tx, {
        payment,
        amount: received.amount,
        reason: REFUND_REASON[reason] ?? 'duplicate_payment',
        source: 'unapplied',
      });
      return { outcome: 'requires_refund', paidBookingId: null, refundIds: [refundId] };
    }

    await this.ledger.post(tx, {
      key: `payment:${payment.id}:captured`,
      kind: payment.kind === 'wallet' ? 'wallet_payment' : 'payment_captured',
      bookingId: booking.id,
      paymentId: payment.id,
      lines: transfer(
        from,
        { kind: 'booking', bookingId: booking.id, currency: booking.currency },
        received.amount,
      ),
    });
    if (settles.length > 0) {
      await tx.installment.updateMany({
        where: { id: { in: settles } },
        data: { status: 'paid', paidAt: received.occurredAt },
      });
    }
    await tx.payment.updateMany({
      where: { bookingId: booking.id, status: 'pending', id: { not: payment.id } },
      data: { status: 'cancelled' },
    });

    const paidAfter = add(paidBefore, received.amount);
    if (paidAfter.minor < required.minor) {
      await this.transitions.apply(tx, booking, 'partial_payment', actor, {
        data: { pendingPrice: Prisma.DbNull },
      });
      return { outcome: 'partially_paid', paidBookingId: null, refundIds: [] };
    }

    await this.transitions.apply(tx, booking, 'payment_succeeded', actor, {
      data: { pendingPrice: Prisma.DbNull, paymentDeadline: null },
    });
    if (active) {
      await tx.paymentPlan.update({
        where: { id: active.id },
        data: { status: 'completed', closedAt: new Date() },
      });
    }
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
    // A risky payment stays PAID with an open review: fulfilment waits for staff (ADR-040).
    if (await this.risk.holdIfRisky(tx, booking, captured, new Date())) {
      return { outcome: 'held_for_review', paidBookingId: null, refundIds: [] };
    }
    return { outcome: 'paid', paidBookingId: booking.id, refundIds: [] };
  }

  private async receiveUnapplied(
    tx: Tx,
    payment: Payment,
    amount: Money,
    from: AccountRef,
    reason: string,
  ): Promise<void> {
    await this.ledger.post(tx, {
      key: `payment:${payment.id}:captured`,
      kind: 'payment_unapplied',
      bookingId: payment.bookingId,
      paymentId: payment.id,
      lines: transfer(
        { ...from, currency: amount.currency },
        { kind: 'unapplied', currency: amount.currency },
        amount,
      ),
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { requiresRefund: true, failureReason: reason },
    });
  }
}
