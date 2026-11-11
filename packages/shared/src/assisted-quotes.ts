import { z } from './zod-setup';

import { currencyCodeSchema } from './currency';
import { reviewFlags } from './reviews';
import { isoDateSchema } from './search';

/**
 * Assisted quotes (ADR-104): a traveller asks for a price to be confirmed by a person; staff
 * verify it with the supplier and make an offer the traveller books through the ordinary
 * checkout. The rules both sides share live here.
 */

export const ASSISTED_QUOTE_PRODUCTS = [
  'flight',
  'hotel',
  'car',
  'transfer',
  'tour',
  'package',
  'other',
] as const;
export type AssistedQuoteProduct = (typeof ASSISTED_QUOTE_PRODUCTS)[number];

/**
 * `requested` waits for a person; `offered` has an offer the traveller can book until it lapses;
 * `booked` became a booking; `unavailable`, `expired` and `withdrawn` are closed.
 */
export const ASSISTED_QUOTE_STATUSES = [
  'requested',
  'offered',
  'unavailable',
  'expired',
  'withdrawn',
  'booked',
] as const;
export type AssistedQuoteStatus = (typeof ASSISTED_QUOTE_STATUSES)[number];

/** Why staff closed a request without an offer: a code the clients put into words. */
export const ASSISTED_QUOTE_CLOSE_REASONS = [
  'sold_out',
  'price_not_available',
  'supplier_declined',
  'not_sold_by_suskii',
  'duplicate',
  'other',
] as const;
export type AssistedQuoteCloseReason = (typeof ASSISTED_QUOTE_CLOSE_REASONS)[number];

/** Why staff could not book a paid assisted booking with the supplier (it is then refunded). */
export const ASSISTED_BOOKING_FAILURES = [
  'sold_out',
  'price_changed',
  'supplier_declined',
] as const;
export type AssistedBookingFailure = (typeof ASSISTED_BOOKING_FAILURES)[number];

/** Requests one account may have waiting or on offer at once. */
export const ASSISTED_QUOTE_OPEN_LIMIT = 5;
export const ASSISTED_QUOTE_TITLE_MAX = 160;
const PLACE_MAX = 80;

/** A few words about a thing or a place: no contact details and no links. */
const plainWords = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine((text) => reviewFlags([text]).length === 0, { message: 'no_contact_details' });

/** Places, dates and head counts. Who travels is entered at checkout, never here. */
export const assistedQuoteRequestSchema = z
  .object({
    /** Where from, for a flight or a transfer; null for a stay or a tour. */
    origin: plainWords(PLACE_MAX).nullable().default(null),
    destination: plainWords(PLACE_MAX),
    startDate: isoDateSchema,
    /** The last day (a return flight, check-out); null for a single day. */
    endDate: isoDateSchema.nullable().default(null),
    adults: z.number().int().min(1).max(9),
    children: z.number().int().min(0).max(8).default(0),
  })
  .refine((request) => request.endDate === null || request.endDate >= request.startDate, {
    message: 'end_before_start',
    path: ['endDate'],
  });
export type AssistedQuoteRequest = z.output<typeof assistedQuoteRequestSchema>;

export const assistedQuoteInputSchema = z.object({
  product: z.enum(ASSISTED_QUOTE_PRODUCTS),
  title: plainWords(ASSISTED_QUOTE_TITLE_MAX),
  request: assistedQuoteRequestSchema,
  currency: currencyCodeSchema,
  /** The indicative price it came from (ADR-102), when there was one. */
  observationId: z.uuid().nullable().default(null),
});
export type AssistedQuoteInput = z.output<typeof assistedQuoteInputSchema>;

/**
 * What staff verified and now offer: what it is, when, where, and its terms in plain words.
 * Shown to the traveller before they book.
 */
export const assistedOfferDetailsSchema = z
  .object({
    title: z.string().trim().min(2).max(ASSISTED_QUOTE_TITLE_MAX),
    /** What is included and the supplier's terms, as plain text (no markup). */
    summary: z.string().trim().min(10).max(1200),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    cityName: z.string().trim().min(2).max(PLACE_MAX).nullable().default(null),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .default(null),
    /** Whether the supplier refunds a cancellation; the terms themselves are in `summary`. */
    refundable: z.boolean(),
  })
  .refine((details) => details.endDate >= details.startDate, {
    message: 'end_before_start',
    path: ['endDate'],
  });
export type AssistedOfferDetails = z.output<typeof assistedOfferDetailsSchema>;

/** `Q-` and six characters, like `S-` for support, `T-` for a trip and `A-` for the assistant. */
export const ASSISTED_QUOTE_REFERENCE_PATTERN = /^Q-[A-Z0-9]{6}$/;

/** Whether a quote can still become a booking: on offer and not past its time. */
export const assistedQuoteBookable = (
  quote: { status: AssistedQuoteStatus; offerExpiresAt: Date | string | null },
  now = new Date(),
): boolean =>
  quote.status === 'offered' &&
  quote.offerExpiresAt !== null &&
  new Date(quote.offerExpiresAt).getTime() > now.getTime();
