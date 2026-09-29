import type { BookingStatus } from '@suskii/shared';

/** Everything that can happen to a booking (ADR-014). */
export const BOOKING_EVENTS = [
  'price',
  'hold',
  'request_payment',
  'payment_abandoned',
  'partial_payment',
  'payment_succeeded',
  'start_ticketing',
  'ticketed',
  'ticketing_exhausted',
  'fail',
  'cancel',
  'expire',
  'request_refund',
  'refunded',
] as const;
export type BookingEvent = (typeof BOOKING_EVENTS)[number];

const UNPAID: readonly BookingStatus[] = ['DRAFT', 'PRICED', 'HELD', 'AWAITING_PAYMENT'];

/**
 * The only allowed moves. `payment_succeeded` also applies to PRICED and HELD: a late webhook for
 * an abandoned checkout session is real money and confirms the booking when the amount matches.
 */
const TRANSITIONS: Readonly<
  Record<BookingEvent, { from: readonly BookingStatus[]; to: BookingStatus }>
> = {
  price: { from: ['DRAFT'], to: 'PRICED' },
  hold: { from: ['PRICED'], to: 'HELD' },
  request_payment: { from: ['PRICED', 'HELD'], to: 'AWAITING_PAYMENT' },
  payment_abandoned: { from: ['AWAITING_PAYMENT'], to: 'PRICED' },
  partial_payment: { from: ['AWAITING_PAYMENT', 'PARTIALLY_PAID'], to: 'PARTIALLY_PAID' },
  payment_succeeded: {
    from: ['PRICED', 'HELD', 'AWAITING_PAYMENT', 'PARTIALLY_PAID'],
    to: 'PAID',
  },
  start_ticketing: { from: ['PAID'], to: 'TICKETING' },
  ticketed: { from: ['TICKETING'], to: 'CONFIRMED' },
  ticketing_exhausted: { from: ['TICKETING'], to: 'REFUND_PENDING' },
  fail: { from: ['DRAFT', 'PRICED', 'HELD'], to: 'FAILED' },
  cancel: { from: UNPAID, to: 'CANCELLED' },
  expire: { from: UNPAID, to: 'EXPIRED' },
  request_refund: { from: ['PAID', 'PARTIALLY_PAID', 'CONFIRMED'], to: 'REFUND_PENDING' },
  refunded: { from: ['REFUND_PENDING'], to: 'REFUNDED' },
};

export class InvalidBookingTransition extends Error {
  constructor(
    readonly from: BookingStatus,
    readonly event: BookingEvent,
  ) {
    super(`Booking event "${event}" is not allowed from ${from}`);
    this.name = 'InvalidBookingTransition';
  }
}

export function canTransition(from: BookingStatus, event: BookingEvent): boolean {
  return TRANSITIONS[event].from.includes(from);
}

/** The status `event` leads to from `from`; throws `InvalidBookingTransition` otherwise. */
export function nextStatus(from: BookingStatus, event: BookingEvent): BookingStatus {
  if (!canTransition(from, event)) throw new InvalidBookingTransition(from, event);
  return TRANSITIONS[event].to;
}

/** Statuses no event leaves. */
export function isTerminal(status: BookingStatus): boolean {
  return BOOKING_EVENTS.every((event) => !canTransition(status, event));
}
