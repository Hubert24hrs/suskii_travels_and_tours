import { z } from 'zod';

import {
  BOOKING_STATUSES,
  CABIN_CLASSES,
  contactDetailsSchema,
  flightSearchRequestSchema,
  GENDERS,
  hotelGuestSchema,
  hotelSearchRequestSchema,
  localeCodeSchema,
  PASSENGER_ISSUES,
  PASSENGER_TITLES,
  PASSENGER_TYPES,
  passengerInputSchema,
  travellerInputSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema, priceSchema } from '../pricing/pricing.schemas';
import { flightOfferSchema, flightSliceSchema, hotelRateSchema } from '../search/search.schemas';

const timestamp = z.iso.datetime();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const verticalSchema = z.enum(['flights', 'hotels']);
const boardSchema = z.enum(['room_only', 'breakfast_included', 'half_board', 'full_board']);

export const bookingIdParamsSchema = z.object({ bookingId: z.uuid() });
export const quoteIdParamsSchema = z.object({ quoteId: z.uuid() });
export const documentParamsSchema = z.object({ bookingId: z.uuid(), documentId: z.uuid() });
export const travellerIdParamsSchema = z.object({ travellerId: z.uuid() });
export const paymentReferenceParamsSchema = z.object({
  reference: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export const webhookParamsSchema = z.object({ provider: z.string().regex(/^[a-z]{2,20}$/) });

export const BOOKING_TOKEN_HEADER = {
  name: 'X-Booking-Token',
  required: false,
  description:
    'Guest bookings: the access token returned when the booking was created. Account bookings use the session instead.',
};

// ---------------------------------------------------------------------------
// Quotes (checkout)
// ---------------------------------------------------------------------------

export const quoteSchema = named(
  'Quote',
  z.object({
    quoteId: z.uuid(),
    vertical: verticalSchema,
    currency: z.string().length(3),
    expiresAt: timestamp,
    termsVersion: z.string().meta({ description: 'Send back as `termsVersion` when booking.' }),
    flight: z.object({ offer: flightOfferSchema, request: flightSearchRequestSchema }).nullable(),
    hotel: z
      .object({
        name: z.string(),
        stars: z.number().int(),
        area: z.string().nullable(),
        cityName: z.string(),
        countryCode: z.string().length(2),
        amenities: z.array(z.string()),
        rate: hotelRateSchema,
        nights: z.number().int(),
        request: hotelSearchRequestSchema,
      })
      .nullable(),
  }),
);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const extraSelectionSchema = named(
  'ExtraSelection',
  z.object({
    serviceId: z.string().min(1).max(200),
    passengerIndex: z
      .number()
      .int()
      .min(0)
      .max(8)
      .meta({ description: 'Position in `passengers` as sent.' }),
    quantity: z.number().int().min(1).max(4),
  }),
);

export const createBookingRequestSchema = named(
  'CreateBookingRequest',
  z.object({
    quoteId: z.uuid(),
    contact: contactDetailsSchema,
    passengers: z
      .array(passengerInputSchema)
      .max(9)
      .default([])
      .meta({ description: 'Flights: every traveller the offer was priced for.' }),
    guests: z
      .array(hotelGuestSchema)
      .max(8)
      .default([])
      .meta({ description: 'Hotels: one lead guest per room, in room order.' }),
    extras: z.array(extraSelectionSchema).max(18).default([]),
    promoCode: z.string().trim().min(3).max(32).nullable().default(null),
    termsVersion: z.string().min(1).max(32),
    acceptTerms: z.literal(true),
    locale: localeCodeSchema.default('en-NG'),
    turnstileToken: z.string().min(1).max(2048).nullable().default(null).meta({
      description: 'Cloudflare Turnstile token (action `checkout`); required for guests.',
    }),
  }),
);
export type CreateBookingRequest = z.output<typeof createBookingRequestSchema>;

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export const bookingExtraSchema = named(
  'BookingExtra',
  z.object({
    serviceId: z.string(),
    type: z.literal('checked_bag'),
    weightKg: z.number().int(),
    quantity: z.number().int(),
    unitPrice: moneySchema,
    amount: moneySchema,
  }),
);

export const bookingPriceSchema = named(
  'BookingPrice',
  priceSchema.extend({
    extras: z
      .array(bookingExtraSchema)
      .meta({ description: 'Sold at supplier cost, no discount.' }),
    total: moneySchema.meta({ description: 'fare + taxes + fees - discount + extras.' }),
  }),
);
export type BookingPriceDto = z.infer<typeof bookingPriceSchema>;

export const bookingPriceChangeSchema = named(
  'BookingPriceChange',
  z.object({
    previous: moneySchema,
    current: moneySchema,
    difference: moneySchema,
    price: bookingPriceSchema,
  }),
);

const maskedDocumentSchema = z.object({
  hint: z.string().meta({ description: 'Last three characters of the passport number.' }),
  issuingCountry: z.string().length(2),
  expiryDate: isoDate,
});

export const passengerIssueSchema = named(
  'PassengerIssue',
  z.object({
    index: z.number().int().nullable(),
    path: z.array(z.string()),
    code: z.enum(Object.values(PASSENGER_ISSUES) as [string, ...string[]]),
  }),
);

export const bookingPassengerSchema = named(
  'BookingPassenger',
  z.object({
    position: z.number().int(),
    type: z.enum(PASSENGER_TYPES),
    title: z.enum(PASSENGER_TITLES).nullable(),
    givenNames: z.string(),
    surname: z.string(),
    dateOfBirth: isoDate.nullable(),
    roomIndex: z.number().int().nullable(),
    document: maskedDocumentSchema.nullable(),
    ticketNumber: z.string().nullable(),
    extraBags: z.number().int(),
  }),
);

export const bookingSchema = named(
  'Booking',
  z.object({
    id: z.uuid(),
    reference: z.string(),
    status: z.enum(BOOKING_STATUSES),
    vertical: verticalSchema,
    createdAt: timestamp,
    paymentDeadline: timestamp.nullable(),
    confirmedAt: timestamp.nullable(),
    contact: z.object({ email: z.string(), phone: z.string() }).meta({ description: 'Masked.' }),
    price: bookingPriceSchema,
    pendingPriceChange: bookingPriceChangeSchema
      .nullable()
      .meta({ description: 'A re-priced total waiting for consent (`price-consent`).' }),
    flight: z
      .object({
        owner: z.object({ code: z.string(), name: z.string() }),
        slices: z.array(flightSliceSchema),
        baggage: z.object({ carryOn: z.number().int(), checked: z.number().int() }),
        conditions: z.object({ refundable: z.boolean(), changeable: z.boolean() }),
        cabinClass: z.enum(CABIN_CLASSES),
        airlineReference: z.string().nullable(),
        request: flightSearchRequestSchema,
      })
      .nullable(),
    hotel: z
      .object({
        name: z.string(),
        stars: z.number().int(),
        area: z.string().nullable(),
        cityName: z.string(),
        countryCode: z.string().length(2),
        checkIn: isoDate,
        checkOut: isoDate,
        nights: z.number().int(),
        rooms: z.number().int(),
        roomName: z.string(),
        board: boardSchema,
        refundable: z.boolean(),
        freeCancellationUntil: timestamp.nullable(),
        payAtProperty: moneySchema.nullable(),
        confirmationNumber: z.string().nullable(),
        request: hotelSearchRequestSchema,
      })
      .nullable(),
    passengers: z.array(bookingPassengerSchema),
    warnings: z.array(passengerIssueSchema),
    payment: z
      .object({
        id: z.uuid(),
        status: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'expired']),
        amount: moneySchema,
        checkoutUrl: z
          .string()
          .nullable()
          .meta({ description: 'Set while the session can still be paid.' }),
        expiresAt: timestamp,
      })
      .nullable()
      .meta({ description: 'The latest payment attempt.' }),
    documents: z.array(
      z.object({
        id: z.uuid(),
        type: z.enum(['e_ticket', 'hotel_voucher']),
        fileName: z.string(),
        sizeBytes: z.number().int(),
        createdAt: timestamp,
      }),
    ),
  }),
);
export type BookingDto = z.infer<typeof bookingSchema>;

export const createdBookingSchema = named(
  'CreatedBooking',
  z.object({
    booking: bookingSchema,
    accessToken: z.string().nullable().meta({
      description:
        'Guest bookings only, returned once: send it as `X-Booking-Token`. It cannot be recovered.',
    }),
  }),
);

export const paymentSessionSchema = named(
  'PaymentSession',
  z.object({
    paymentId: z.uuid(),
    checkoutUrl: z.string().meta({ description: 'Send the traveller here (hosted checkout).' }),
    amount: moneySchema,
    expiresAt: timestamp,
  }),
);

export const priceConsentRequestSchema = named(
  'PriceConsentRequest',
  z.object({
    total: moneySchema.meta({ description: 'The new total exactly as shown to the traveller.' }),
  }),
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const webhookReceiptSchema = named(
  'WebhookReceipt',
  z.object({ received: z.literal(true) }),
);

export const mockPaymentSchema = named(
  'MockPayment',
  z.object({
    reference: z.string(),
    bookingReference: z.string(),
    amount: moneySchema,
    status: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'expired']),
    expiresAt: timestamp,
    returnUrl: z.string(),
  }),
);

export const mockPaymentCompleteRequestSchema = named(
  'MockPaymentCompleteRequest',
  z.object({ outcome: z.enum(['succeeded', 'failed']) }),
);

export const mockPaymentResultSchema = named(
  'MockPaymentResult',
  z.object({
    status: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'expired']),
    returnUrl: z.string(),
  }),
);

// ---------------------------------------------------------------------------
// Saved travellers
// ---------------------------------------------------------------------------

export const travellerRequestSchema = named('TravellerRequest', travellerInputSchema);

export const travellerSchema = named(
  'Traveller',
  z.object({
    id: z.uuid(),
    title: z.enum(PASSENGER_TITLES),
    gender: z.enum(GENDERS),
    givenNames: z.string(),
    surname: z.string(),
    dateOfBirth: isoDate,
    nationality: z.string().length(2),
    document: maskedDocumentSchema.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);
export type TravellerDto = z.infer<typeof travellerSchema>;

export const travellerListSchema = named(
  'TravellerList',
  z.object({ travellers: z.array(travellerSchema) }),
);

// ---------------------------------------------------------------------------
// Internal (worker)
// ---------------------------------------------------------------------------

export const expiryRunSchema = named('BookingExpiryRun', z.object({ expired: z.number().int() }));

export const ticketingRunSchema = named(
  'TicketingRun',
  z.object({
    attempted: z.number().int(),
    confirmed: z.number().int(),
    retrying: z.number().int(),
    exhausted: z.number().int(),
  }),
);
