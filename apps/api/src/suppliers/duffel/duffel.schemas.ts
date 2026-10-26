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
  /** Extras name the segments they cover by these ids. */
  id: z.string().nullish(),
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

/** One slice of an offer or an order; order slices have the same segment shape. */
export const duffelSliceSchema = z.looseObject({
  fare_brand_name: z.string().nullish(),
  segments: z.array(segment).min(1),
});

export type DuffelSlice = z.infer<typeof duffelSliceSchema>;

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
  slices: z.array(duffelSliceSchema),
  conditions: z
    .looseObject({ refund_before_departure: penalty, change_before_departure: penalty })
    .nullish(),
  payment_requirements: z
    .looseObject({
      requires_instant_payment: z.boolean(),
      payment_required_by: z.string().nullish(),
      price_guarantee_expires_at: z.string().nullish(),
    })
    .nullish(),
  /** In the order they were requested; orders must reference these ids. */
  passengers: z.array(z.looseObject({ id: z.string(), type: z.string().nullish() })).default([]),
  /**
   * Extras, only on a single offer fetched with `return_available_services=true`. Each is
   * checked with `duffelServiceSchema` on its own, so one odd service never drops the offer.
   */
  available_services: z.array(z.unknown()).nullish(),
});

export type DuffelOffer = z.infer<typeof duffelOfferSchema>;

/** An extra for one passenger on some segments, e.g. a checked bag (`metadata.type`). */
export const duffelServiceSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  total_amount: decimal,
  total_currency: currency,
  maximum_quantity: z.number().int(),
  passenger_ids: z.array(z.string()).default([]),
  segment_ids: z.array(z.string()).default([]),
  metadata: z
    .looseObject({ type: z.string().nullish(), maximum_weight_kg: z.number().nullish() })
    .nullish(),
});

export type DuffelService = z.infer<typeof duffelServiceSchema>;

export const duffelOrderSchema = z.looseObject({
  id: z.string(),
  booking_reference: z.string().min(1),
  total_amount: decimal.nullish(),
  total_currency: currency.nullish(),
  tax_amount: decimal.nullish(),
  tax_currency: currency.nullish(),
  payment_status: z
    .looseObject({
      awaiting_payment: z.boolean(),
      payment_required_by: z.string().nullish(),
      price_guarantee_expires_at: z.string().nullish(),
    })
    .nullish(),
  documents: z
    .array(
      z.looseObject({
        type: z.string(),
        unique_identifier: z.string(),
        passenger_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  passengers: z.array(z.looseObject({ id: z.string() })).default([]),
});

export type DuffelOrder = z.infer<typeof duffelOrderSchema>;

/** A pending or confirmed order cancellation (`/air/order_cancellations`). */
export const duffelOrderCancellationSchema = z.looseObject({
  id: z.string(),
  order_id: z.string().nullish(),
  refund_amount: decimal.nullish(),
  refund_currency: currency.nullish(),
  /** `balance` returns money to the account that paid; others are credits or card refunds. */
  refund_to: z.string().nullish(),
  expires_at: z.string().nullish(),
  confirmed_at: z.string().nullish(),
});

export type DuffelOrderCancellation = z.infer<typeof duffelOrderCancellationSchema>;

/**
 * An order's flights and airline-initiated changes (`GET /air/orders/{id}`, ADR-065). Slices and
 * changes are checked one by one, so one odd change never hides the others.
 */
export const duffelOrderChangesSchema = z.looseObject({
  id: z.string(),
  slices: z.array(z.unknown()),
  airline_initiated_changes: z.array(z.unknown()).nullish(),
});

/** A schedule or routing change the airline made: `removed` slices replaced by `added` ones. */
export const duffelAirlineChangeSchema = z.looseObject({
  id: z.string(),
  created_at: z.string(),
  action_taken: z.enum(['accepted', 'cancelled', 'changed']).nullish(),
  /** `accept` when it can be accepted through the API. */
  available_actions: z.array(z.string()).default([]),
  added: z.array(z.unknown()).default([]),
  removed: z.array(z.unknown()).default([]),
});

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
