import { z } from 'zod';

// The subset of Hotelbeds APItude (Hotels API 1.0) we read, after the types in `hotelbeds.ts`
// (generated from the Hotelbeds OpenAPI) and `@otaip/adapter-hotelbeds` (written against the
// Hotelbeds sandbox), ADR-071. Objects are loose: unknown fields are ignored, and a hotel or rate
// missing a required field is skipped on its own.

const DECIMAL = /^-?\d+(\.\d+)?$/;
/** Hotelbeds sends amounts as decimal strings; the OpenAPI types say numbers. Accept both. */
const decimal = z
  .union([z.string(), z.number().finite()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .pipe(z.string().regex(DECIMAL));
const currency = z.string().regex(/^[A-Z]{3}$/);

export const hotelbedsErrorSchema = z.looseObject({
  error: z.looseObject({ code: z.string().optional(), message: z.string().optional() }).optional(),
  auditData: z.looseObject({ token: z.string().optional() }).optional(),
});

const tax = z.looseObject({
  included: z.boolean().optional(),
  amount: decimal.optional(),
  currency: currency.optional(),
  clientAmount: decimal.optional(),
  clientCurrency: currency.optional(),
});

export const hotelbedsRateSchema = z.looseObject({
  rateKey: z.string().min(1),
  rateType: z.enum(['BOOKABLE', 'RECHECK']),
  rateClass: z.string().optional(),
  net: decimal,
  paymentType: z.string().optional(),
  boardCode: z.string().optional(),
  boardName: z.string().optional(),
  rooms: z.number().int().positive().optional(),
  adults: z.number().int().nonnegative().optional(),
  children: z.number().int().nonnegative().optional(),
  cancellationPolicies: z
    .array(z.looseObject({ amount: decimal.optional(), from: z.string() }))
    .optional(),
  taxes: z
    .looseObject({ allIncluded: z.boolean().optional(), taxes: z.array(tax).optional() })
    .optional(),
});
export type HotelbedsRate = z.output<typeof hotelbedsRateSchema>;

const room = z.looseObject({
  code: z.string(),
  name: z.string().optional(),
  // Each rate is validated on its own, so one odd rate does not hide the room.
  rates: z.array(z.unknown()).optional(),
});
export type HotelbedsRoom = z.output<typeof room>;

export const hotelbedsHotelSchema = z.looseObject({
  code: z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]),
  name: z.string().min(1),
  categoryCode: z.string().optional(),
  destinationName: z.string().optional(),
  zoneName: z.string().optional(),
  latitude: decimal.optional(),
  longitude: decimal.optional(),
  currency: currency.optional(),
  rooms: z.array(room).optional(),
});
export type HotelbedsHotel = z.output<typeof hotelbedsHotelSchema>;

export const hotelbedsAvailabilitySchema = z.looseObject({
  hotels: z
    .looseObject({
      // Each hotel is validated on its own.
      hotels: z.array(z.unknown()).optional(),
    })
    .optional(),
});

export const hotelbedsCheckRateSchema = z.looseObject({
  hotel: z.looseObject({
    currency: currency.optional(),
    rooms: z.array(room).optional(),
  }),
});

export const hotelbedsBookingSchema = z.looseObject({
  booking: z.looseObject({
    reference: z.string().min(1),
    status: z.string().optional(),
    totalNet: decimal.optional(),
    currency: currency.optional(),
  }),
});
