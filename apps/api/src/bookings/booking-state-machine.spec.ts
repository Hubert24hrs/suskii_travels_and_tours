import { BOOKING_STATUSES, type BookingStatus } from '@suskii/shared';

import {
  BOOKING_EVENTS,
  InvalidBookingTransition,
  canTransition,
  isTerminal,
  nextStatus,
  type BookingEvent,
} from './booking-state-machine';

// Written out by hand from ADR-014 and ADR-018 rather than derived from the implementation, so a
// change to either side fails this test. Every one of the 13 x 15 state/event pairs is checked.
const EXPECTED: Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>> = {
  DRAFT: { price: 'PRICED', fail: 'FAILED', cancel: 'CANCELLED', expire: 'EXPIRED' },
  PRICED: {
    hold: 'HELD',
    request_payment: 'AWAITING_PAYMENT',
    payment_succeeded: 'PAID',
    fail: 'FAILED',
    cancel: 'CANCELLED',
    expire: 'EXPIRED',
  },
  HELD: {
    request_payment: 'AWAITING_PAYMENT',
    partial_payment: 'PARTIALLY_PAID',
    payment_succeeded: 'PAID',
    fail: 'FAILED',
    cancel: 'CANCELLED',
    expire: 'EXPIRED',
  },
  AWAITING_PAYMENT: {
    payment_abandoned: 'PRICED',
    partial_payment: 'PARTIALLY_PAID',
    payment_succeeded: 'PAID',
    cancel: 'CANCELLED',
    expire: 'EXPIRED',
  },
  PARTIALLY_PAID: {
    partial_payment: 'PARTIALLY_PAID',
    payment_succeeded: 'PAID',
    cancel: 'CANCELLED',
    default: 'REFUND_PENDING',
    request_refund: 'REFUND_PENDING',
  },
  PAID: { start_ticketing: 'TICKETING', request_refund: 'REFUND_PENDING' },
  TICKETING: { ticketed: 'CONFIRMED', ticketing_exhausted: 'REFUND_PENDING' },
  CONFIRMED: { request_refund: 'REFUND_PENDING' },
  FAILED: {},
  CANCELLED: {},
  REFUND_PENDING: { refunded: 'REFUNDED' },
  REFUNDED: {},
  EXPIRED: {},
};

const pairs = BOOKING_STATUSES.flatMap((status) =>
  BOOKING_EVENTS.map((event) => [status, event, EXPECTED[status][event] ?? null] as const),
);

describe('booking state machine', () => {
  it('covers every state and event', () => {
    expect(pairs).toHaveLength(13 * 15);
    expect(Object.keys(EXPECTED).sort()).toEqual([...BOOKING_STATUSES].sort());
  });

  it.each(pairs)('%s + %s -> %s', (status, event, expected) => {
    expect(canTransition(status, event)).toBe(expected !== null);
    if (expected === null) {
      expect(() => nextStatus(status, event)).toThrow(InvalidBookingTransition);
    } else {
      expect(nextStatus(status, event)).toBe(expected);
    }
  });

  it('describes a rejected transition', () => {
    const error = (() => {
      try {
        nextStatus('CONFIRMED', 'price');
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(InvalidBookingTransition);
    expect(error).toMatchObject({
      name: 'InvalidBookingTransition',
      from: 'CONFIRMED',
      event: 'price',
      message: 'Booking event "price" is not allowed from CONFIRMED',
    });
  });

  it('knows the terminal statuses', () => {
    expect(BOOKING_STATUSES.filter((status) => isTerminal(status))).toEqual([
      'FAILED',
      'CANCELLED',
      'REFUNDED',
      'EXPIRED',
    ]);
  });

  it('reaches CONFIRMED only through payment and ticketing', () => {
    let status: BookingStatus = 'DRAFT';
    for (const event of [
      'price',
      'request_payment',
      'payment_succeeded',
      'start_ticketing',
      'ticketed',
    ] as const) {
      status = nextStatus(status, event);
    }
    expect(status).toBe('CONFIRMED');
    expect(BOOKING_EVENTS.filter((event) => canTransition(status, event))).toEqual([
      'request_refund',
    ]);
  });
});
