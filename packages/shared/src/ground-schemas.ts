import { z } from './zod-setup';

import { phoneSchema } from './auth';
import {
  FUEL_EIGHTHS_MAX,
  layoutSeats,
  MAX_SEATS_PER_HOLD,
  NIGERIA_BOUNDS,
  RATING_MAX,
  RATING_MIN,
  RIDE_PIN_PATTERN,
  SEAT_NUMBER_PATTERN,
  WEST_AFRICA_BOUNDS,
  withinBounds,
  type GeoBounds,
} from './ground';

/** Validation for Cars input (ADR-049 to ADR-053). */

const coordinate = z.number().refine(Number.isFinite, 'must_be_finite');

/** A point inside `bounds`: Nigeria by default, West Africa when the API's flag widens it. */
export const geoPointSchema = (bounds: GeoBounds = NIGERIA_BOUNDS) =>
  z
    .object({ lat: coordinate.min(-90).max(90), lng: coordinate.min(-180).max(180) })
    .refine((point) => withinBounds(point, bounds), 'outside_service_area');

export const nigeriaPointSchema = geoPointSchema(NIGERIA_BOUNDS);
export const westAfricaPointSchema = geoPointSchema(WEST_AFRICA_BOUNDS);

/** A named place a rider picks: a label for receipts plus the coordinates. */
export const placeSchema = (bounds: GeoBounds = NIGERIA_BOUNDS) =>
  z.object({
    label: z.string().trim().min(1).max(200),
    point: geoPointSchema(bounds),
  });

export const seatNumberSchema = z.string().regex(SEAT_NUMBER_PATTERN, 'invalid_seat');

/** Seats a rider asks to hold: distinct and at most `MAX_SEATS_PER_HOLD`. */
export const seatSelectionSchema = z
  .array(seatNumberSchema)
  .min(1)
  .max(MAX_SEATS_PER_HOLD)
  .refine((seats) => new Set(seats).size === seats.length, 'duplicate_seat');

/** A coach layout entered by staff: rows of seat numbers or `null`, every seat distinct. */
export const busSeatLayoutSchema = z
  .object({
    rows: z.array(z.array(seatNumberSchema.nullable()).min(1).max(6)).min(1).max(20),
  })
  .refine((layout) => {
    const seats = layoutSeats(layout);
    return seats.length > 0 && new Set(seats).size === seats.length;
  }, 'duplicate_or_missing_seats');

const minor = z.number().int().min(0).max(1_000_000_000);

/** A ride fare table row as staff enter it (minor units of `currency`). */
export const rideFareRuleSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  baseMinor: minor,
  perKmMinor: minor,
  perMinuteMinor: minor,
  bookingFeeMinor: minor,
  minimumMinor: minor,
  cancellationFeeMinor: minor,
  freeCancelSeconds: z.number().int().min(0).max(3600),
  waitGraceSeconds: z.number().int().min(0).max(3600),
  driverShareBps: z.number().int().min(0).max(10_000),
});

export const ridePinSchema = z.string().regex(RIDE_PIN_PATTERN, 'invalid_pin');

export const ratingSchema = z.object({
  stars: z.number().int().min(RATING_MIN).max(RATING_MAX),
  comment: z.string().trim().max(500).nullable(),
});

/** A trusted contact who gets an SMS on SOS (ADR-050); at most three per rider. */
export const emergencyContactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: phoneSchema,
});
export const emergencyContactsSchema = z.array(emergencyContactSchema).max(3);

/** Nigeria's National Identification Number: 11 digits. */
export const ninSchema = z.string().regex(/^\d{11}$/, 'invalid_nin');

/** Licence plates as printed (`LND-123-AB`, `ABC 123 XY`), normalised to upper case. */
export const plateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9 -]{3,10}[A-Z0-9]$/, 'invalid_plate');

/** What a handover records (ADR-051): odometer, fuel, and damage notes. */
export const handoverInputSchema = z.object({
  odometerKm: z.number().int().min(0).max(2_000_000),
  fuelEighths: z.number().int().min(0).max(FUEL_EIGHTHS_MAX),
  damageNotes: z.string().trim().max(1000).nullable(),
});

export type EmergencyContact = z.infer<typeof emergencyContactSchema>;
export type HandoverInput = z.infer<typeof handoverInputSchema>;
export type RideFareRuleInput = z.infer<typeof rideFareRuleSchema>;
export type RatingInput = z.infer<typeof ratingSchema>;
