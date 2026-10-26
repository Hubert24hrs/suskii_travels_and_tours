import { z } from 'zod';

// The subset of Duffel Stays we read, after the types in Duffel's official SDK
// (`@duffel/api`, `Stays/StaysTypes`). Objects are loose: unknown fields are ignored, and a
// rate or result missing a required field is skipped on its own.

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);

export const duffelStaysRateSchema = z.looseObject({
  id: z.string().min(1),
  total_amount: decimal,
  total_currency: currency,
  tax_amount: decimal.nullish(),
  tax_currency: currency.nullish(),
  fee_amount: decimal.nullish(),
  fee_currency: currency.nullish(),
  due_at_accommodation_amount: decimal.nullish(),
  due_at_accommodation_currency: currency.nullish(),
  board_type: z.string(),
  cancellation_timeline: z
    .array(z.looseObject({ refund_amount: decimal, before: z.string(), currency }))
    .nullish(),
  payment_type: z.string(),
  available_payment_methods: z.array(z.string()).nullish(),
  loyalty_programme_required: z.boolean().nullish(),
  expires_at: z.string(),
});
export type DuffelStaysRate = z.output<typeof duffelStaysRateSchema>;

const room = z.looseObject({
  name: z.string(),
  // Each rate is validated on its own, so one odd rate does not hide the room.
  rates: z.array(z.unknown()),
});
export type DuffelStaysRoom = z.output<typeof room>;

export const duffelStaysAccommodationSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  rating: z.number().nullish(),
  review_score: z.number().nullish(),
  review_count: z.number().nullish(),
  amenities: z.array(z.looseObject({ type: z.string() })).nullish(),
  location: z.looseObject({
    address: z.looseObject({ city_name: z.string(), country_code: z.string().length(2) }),
    geographic_coordinates: z
      .looseObject({ latitude: z.number(), longitude: z.number() })
      .nullish(),
  }),
  rooms: z.array(room).nullish(),
});

export const duffelStaysSearchResultSchema = z.looseObject({
  id: z.string().min(1),
  accommodation: duffelStaysAccommodationSchema,
  cheapest_rate_total_amount: decimal,
  cheapest_rate_currency: currency,
  cheapest_rate_base_amount: decimal.nullish(),
  cheapest_rate_base_currency: currency.nullish(),
  cheapest_rate_due_at_accommodation_amount: decimal.nullish(),
  cheapest_rate_due_at_accommodation_currency: currency.nullish(),
  expires_at: z.string(),
});
export type DuffelStaysSearchResult = z.output<typeof duffelStaysSearchResultSchema>;

/** `fetch_all_rates` answers with the search result, its rooms and every rate filled in. */
export const duffelStaysAllRatesSchema = z.looseObject({
  accommodation: z.looseObject({ rooms: z.array(room).nullish() }),
});

export const duffelStaysQuoteSchema = z.looseObject({
  id: z.string().min(1),
  total_amount: decimal,
  total_currency: currency,
  tax_amount: decimal.nullish(),
  tax_currency: currency.nullish(),
  fee_amount: decimal.nullish(),
  fee_currency: currency.nullish(),
  due_at_accommodation_amount: decimal.nullish(),
  due_at_accommodation_currency: currency.nullish(),
});
export type DuffelStaysQuote = z.output<typeof duffelStaysQuoteSchema>;

export const duffelStaysBookingSchema = z.looseObject({
  id: z.string().min(1),
  reference: z.string().nullish(),
  status: z.string(),
});
