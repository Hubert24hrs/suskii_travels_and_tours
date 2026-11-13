import { z } from 'zod';

import {
  BOOKING_STATUSES,
  contactDetailsSchema,
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  localeCodeSchema,
  marketingAttributionSchema,
  passengerInputSchema,
  PAYMENT_PROVIDER_NAMES,
  TRIP_COMPONENTS,
  TRIP_PART_STATES,
  TRIP_STATES,
  tripPlanSchema,
} from '@suskii/shared';

import {
  addonDetailsInputSchema,
  bookingPriceChangeSchema,
  bookingSummarySchema,
  PAYMENT_METHODS,
  paymentMethodOptionSchema,
  paymentProviderOptionSchema,
} from '../bookings/bookings.schemas';
import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

/** Combined trips (ADR-099): a group of the traveller's own bookings, paid with one checkout. */

const timestamp = z.iso.datetime();

export const tripIdParamsSchema = z.object({ tripId: z.uuid() });
export const tripPartParamsSchema = z.object({ tripId: z.uuid(), bookingId: z.uuid() });

export const createTripSchema = named(
  'CreateTripRequest',
  z.object({
    plan: tripPlanSchema,
    currency: currencyCodeSchema
      .default(DEFAULT_CURRENCY)
      .meta({ description: 'Every part of the trip is booked and paid in this currency.' }),
  }),
);

export const addTripPartSchema = named(
  'AddTripPartRequest',
  z.object({
    bookingId: z.uuid().meta({
      description:
        "One of the caller's own unpaid bookings: a flight, a hotel, a rental car, an airport transfer or travel insurance.",
    }),
  }),
);

/**
 * Every part a trip still has to book, with one set of details (ADR-118): the contact once and
 * each traveller once. Each part takes the travellers its own quote was priced for.
 */
export const bookTripSchema = named(
  'BookTripRequest',
  z
    .object({
      contact: contactDetailsSchema,
      travellers: z.array(passengerInputSchema).min(1).max(9).meta({
        description:
          'Everyone on the trip, once: adults, children and lap infants. A flight, a transfer or insurance takes the travellers of each kind its quote was priced for, in this order; a hotel takes the adults as lead guests, one per room; a rental car the first adult as its renter, who shows the licence at pickup. Give a passport when any part goes abroad.',
      }),
      addonDetails: addonDetailsInputSchema.nullable().default(null).meta({
        description:
          "The airport transfer's details, when the trip has one that asks for them (`requiredDetails`).",
      }),
      termsVersion: z.string().min(1).max(32),
      acceptTerms: z.literal(true),
      locale: localeCodeSchema.default('en-NG'),
      marketing: marketingAttributionSchema.optional(),
    })
    .refine((input) => input.travellers.some((traveller) => traveller.type === 'adult'), {
      path: ['travellers'],
      message: 'adult_required',
    }),
);
export type BookTripRequest = z.output<typeof bookTripSchema>;

export const startTripPaymentSchema = named(
  'StartTripPaymentRequest',
  z.object({
    provider: z
      .enum(PAYMENT_PROVIDER_NAMES)
      .nullable()
      .default(null)
      .meta({ description: 'One of `payment.providers`; the default when null.' }),
    method: z
      .enum(PAYMENT_METHODS)
      .nullable()
      .default(null)
      .meta({ description: 'One of `payment.methods` (ADR-074).' }),
  }),
);
export type StartTripPaymentRequest = z.output<typeof startTripPaymentSchema>;

/**
 * A part Ask Suskii prepared (ADR-117): a quote that waits for the travellers' details. Its
 * checkout adds the booking to the trip, which then drops this entry; an expired one is not
 * shown. The price is the quote's, as it was quoted.
 */
export const tripPreparedPartSchema = z.object({
  component: z.enum(TRIP_COMPONENTS),
  quoteId: z.uuid(),
  title: z.string().min(1).max(200),
  price: moneySchema,
  expiresAt: timestamp,
});
export type TripPreparedPart = z.infer<typeof tripPreparedPartSchema>;

const tripPartSchema = z.object({
  component: z.enum(TRIP_COMPONENTS),
  state: z.enum(TRIP_PART_STATES).meta({
    description:
      '`to_pay` and `paying` count towards `due`; `paid` and `confirmed` are settled; `closed` (cancelled, expired, failed or refunded) is no longer part of the total.',
  }),
  status: z.enum(BOOKING_STATUSES),
  booking: bookingSummarySchema,
  due: moneySchema.meta({ description: 'What this part still costs; zero once it is paid.' }),
  priceChange: bookingPriceChangeSchema.nullable().meta({
    description:
      "A re-priced total waiting for the traveller's consent (`price-consent` on the booking). The trip cannot be paid while one is open.",
  }),
});

export const tripSchema = named(
  'Trip',
  z.object({
    id: z.uuid(),
    reference: z.string(),
    createdAt: timestamp,
    plan: tripPlanSchema,
    currency: z.string().length(3),
    state: z.enum(TRIP_STATES),
    parts: z.array(tripPartSchema).meta({
      description: 'The bookings in the trip, in the order parts are added to one.',
    }),
    missing: z
      .array(z.enum(TRIP_COMPONENTS))
      .meta({ description: 'Parts the plan asks for that no live booking fills yet.' }),
    total: moneySchema.meta({
      description: 'The sum of every live part: a price per part and one total for the trip.',
    }),
    due: moneySchema.meta({ description: 'What one payment would charge now.' }),
    prepared: z.array(tripPreparedPartSchema).optional().meta({
      description:
        'Parts Ask Suskii prepared that no live booking fills yet (ADR-117): each opens its checkout (`/checkout/{quoteId}`), which adds the booking to this trip. Unexpired quotes only. Absent from older answers.',
    }),
    totalWithPrepared: moneySchema.optional().meta({
      description:
        '`total` plus the quoted price of every part in `prepared`: what the trip comes to once each prepared part is booked at that price. Absent from older answers.',
    }),
    payment: z.object({
      providers: z.array(paymentProviderOptionSchema),
      methods: z.array(paymentMethodOptionSchema),
      open: z
        .object({
          id: z.uuid(),
          checkoutUrl: z.string(),
          amount: moneySchema,
          expiresAt: timestamp,
        })
        .nullable()
        .meta({ description: 'A hosted checkout still waiting for the traveller.' }),
    }),
  }),
);
export type TripDto = z.infer<typeof tripSchema>;

export const tripListSchema = named('TripList', z.object({ trips: z.array(tripSchema) }));

export const tripPaymentSessionSchema = named(
  'TripPaymentSession',
  z.object({
    paymentId: z.uuid(),
    status: z.literal('pending'),
    checkoutUrl: z.string().meta({ description: 'Send the traveller here (hosted checkout).' }),
    amount: moneySchema,
    parts: z.number().int().meta({ description: 'How many bookings this one payment covers.' }),
    expiresAt: timestamp,
  }),
);
