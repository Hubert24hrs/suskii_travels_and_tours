/** Booking lifecycle constants shared by the API and clients (ADR-014). Zod-free. */

export const BOOKING_STATUSES = [
  'DRAFT',
  'PRICED',
  'HELD',
  'AWAITING_PAYMENT',
  'PARTIALLY_PAID',
  'PAID',
  'TICKETING',
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
  'EXPIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Payment or supplier work is still in flight: the booking page keeps polling. */
export const BOOKING_IN_PROGRESS_STATUSES: readonly BookingStatus[] = [
  'AWAITING_PAYMENT',
  'PAID',
  'TICKETING',
];

/**
 * Version of the booking conditions the traveller accepts at checkout. Bump it whenever that text
 * changes; the API stores it with every booking.
 */
export const BOOKING_TERMS_VERSION = '2026-09-29';

/** Short booking references: no 0/O, 1/I/L, so they survive being read over the phone. */
export const BOOKING_REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BOOKING_REFERENCE_LENGTH = 6;
