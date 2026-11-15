import {
  add,
  money,
  subtract,
  TRIP_COMPONENTS,
  zero,
  type Money,
  type TripComponent,
} from '@suskii/shared';

import { documentTaxes } from '../bookings/booking-documents.service';
import type { DocumentTax } from '../documents/booking-pdf';

import type { TripDto } from './trips.schemas';
import type { TripReceiptPayment } from './trips.service';

/** One payment for the trip that went through, as its receipt shows it (ADR-120). */
export interface TripReceiptPaymentLine {
  paidAt: Date;
  /** Suskii's own reference for the payment, as the provider shows it to the traveller. */
  reference: string;
  /** The channel the provider reported (card, bank_transfer, ussd), never card details. */
  method: string | null;
  amount: Money;
  /** What the payment took that no part could keep, refunded automatically (ADR-099). */
  refunded: Money | null;
}

/** A part a payment paid: the share it kept, with the service taxes inside it (ADR-072). */
export interface TripReceiptPartLine {
  component: TripComponent | null;
  bookingId: string;
  bookingReference: string;
  /** The part as the trip answer shows it; null for a booking the trip no longer lists. */
  part: TripDto['parts'][number] | null;
  amount: Money;
  taxes: DocumentTax[];
}

export interface TripReceipt {
  payments: TripReceiptPaymentLine[];
  /** In the order of `TRIP_COMPONENTS`, whichever payment paid them. */
  parts: TripReceiptPartLine[];
  /** What the parts kept: the total paid. */
  total: Money;
}

/**
 * What a paid trip's receipt says (ADR-120), from the payments `TripsService.receipt()` read:
 * the one rule behind the PDF and behind the receipt the app shows. A share flagged for refund
 * is money its booking could not keep: it is no part of the receipt, and its payment shows it
 * as refunded.
 */
export function tripReceipt(trip: TripDto, payments: readonly TripReceiptPayment[]): TripReceipt {
  // A booking with no part of its own comes first, as the receipt has always listed it.
  const order = (component: TripComponent | null): number =>
    component ? TRIP_COMPONENTS.indexOf(component) : -1;
  const parts: TripReceiptPartLine[] = [];
  let total: Money = zero(trip.currency);
  const lines = payments.map((payment): TripReceiptPaymentLine => {
    const amount = money(payment.amountMinor, payment.currency);
    let kept: Money = zero(payment.currency);
    for (const share of payment.shares) {
      if (share.requiresRefund) continue;
      const taken = money(share.amountMinor, share.currency);
      kept = add(kept, taken);
      const part = trip.parts.find((entry) => entry.booking.id === share.bookingId) ?? null;
      const component =
        TRIP_COMPONENTS.find((item) => item === (part?.component ?? share.booking.tripComponent)) ??
        null;
      parts.push({
        component,
        bookingId: share.bookingId,
        bookingReference: part?.booking.reference ?? share.booking.reference,
        part,
        amount: taken,
        taxes: documentTaxes(share.booking),
      });
    }
    total = add(total, kept);
    const refunded = subtract(amount, kept);
    return {
      paidAt: payment.succeededAt ?? payment.updatedAt,
      reference: payment.providerReference,
      method: payment.method,
      amount,
      refunded: refunded.minor > 0n ? refunded : null,
    };
  });
  // Array sort is stable: parts of one kind keep the order they were paid in.
  parts.sort((a, b) => order(a.component) - order(b.component));
  return { payments: lines, parts, total };
}
