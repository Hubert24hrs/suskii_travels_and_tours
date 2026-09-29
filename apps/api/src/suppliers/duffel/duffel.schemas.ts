import { z } from 'zod';

// The subset of Duffel's v2 API we read (https://duffel.com/docs/api/v2). Objects are loose:
// unknown fields are ignored, missing required fields fail validation for that offer only.

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);

const place = z.looseObject({
  iata_code: z.string().length(3),
  name: z.string().nullish(),
  time_zone: z.string(),
  city_name: z.string().nullish(),
  iata_country_code: z.string().length(2).nullish(),
});

const carrier = z.looseObject({ iata_code: z.string().nullish(), name: z.string() });

const penalty = z
  .looseObject({
    allowed: z.boolean(),
    penalty_amount: decimal.nullish(),
    penalty_currency: currency.nullish(),
  })
  .nullish();

const segment = z.looseObject({
  origin: place,
  destination: place,
  departing_at: z.string(),
  arriving_at: z.string(),
  marketing_carrier: carrier,
  marketing_carrier_flight_number: z.string(),
  operating_carrier: carrier,
  aircraft: z.looseObject({ name: z.string() }).nullish(),
  passengers: z
    .array(
      z.looseObject({
        cabin_class: z.enum(['economy', 'premium_economy', 'business', 'first']).nullish(),
        baggages: z
          .array(
            z.looseObject({ type: z.enum(['checked', 'carry_on']), quantity: z.number().int() }),
          )
          .default([]),
      }),
    )
    .default([]),
});

export const duffelOfferSchema = z.looseObject({
  id: z.string(),
  expires_at: z.string(),
  total_amount: decimal,
  total_currency: currency,
  base_amount: decimal.nullish(),
  base_currency: currency.nullish(),
  tax_amount: decimal.nullish(),
  tax_currency: currency.nullish(),
  owner: carrier,
  slices: z.array(
    z.looseObject({
      fare_brand_name: z.string().nullish(),
      segments: z.array(segment).min(1),
    }),
  ),
  conditions: z
    .looseObject({ refund_before_departure: penalty, change_before_departure: penalty })
    .nullish(),
  payment_requirements: z
    .looseObject({
      requires_instant_payment: z.boolean(),
      payment_required_by: z.string().nullish(),
    })
    .nullish(),
});

export type DuffelOffer = z.infer<typeof duffelOfferSchema>;

export const duffelErrorSchema = z.looseObject({
  errors: z.array(
    z.looseObject({
      code: z.string().nullish(),
      title: z.string().nullish(),
      message: z.string().nullish(),
    }),
  ),
});

export const duffelAirlineSchema = z.looseObject({
  iata_code: z.string().nullish(),
  name: z.string(),
  logo_symbol_url: z.string().nullish(),
});

export const duffelAirlinesPageSchema = z.looseObject({
  data: z.array(z.unknown()),
  meta: z.looseObject({ after: z.string().nullish() }).nullish(),
});
