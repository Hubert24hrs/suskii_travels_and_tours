import { z } from 'zod';

import {
  CATALOG_STATUSES,
  cancellationPolicySchema,
  currencyCodeSchema,
  handoverInputSchema,
  licenceNumberSchema,
  plateSchema,
  RENTAL_CATEGORIES,
  RENTAL_DEFAULT_MIN_DRIVER_AGE,
  RENTAL_DRIVER_AGE_MAX,
  RENTAL_DRIVER_AGE_MIN,
  RENTAL_EXTRAS,
  RENTAL_STATUSES,
  slugSchema,
  TRANSMISSIONS,
} from '@suskii/shared';

import { RENTAL_LICENCE_STATES } from '../bookings/bookings.schemas';
import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

import {
  airportCodeSchema,
  RENTAL_OPTION_ISSUES,
  rentalCrossBorderSchema,
  rentalExtrasSchema,
  rentalReturnBranchesSchema,
} from './rental-options';

/** Car rental (ADR-049, ADR-051): fleet search, licences, handovers and deposits. */

const timestamp = z.iso.datetime();
const isoDay = z.iso.date();
/** Branch local wall time, `YYYY-MM-DDTHH:mm`. */
export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'invalid_local_datetime');

export const FUEL_POLICIES = ['full_to_full', 'same_to_same'] as const;

/** Why part of a deposit is kept (short codes, never free text about a person). */
export const DEPOSIT_DEDUCTION_REASONS = [
  'damage',
  'fuel',
  'excess_mileage',
  'late_return',
  'cleaning',
  'other',
] as const;

export const LICENCE_REJECTION_REASONS = [
  'unreadable',
  'expired',
  'name_mismatch',
  'not_a_licence',
  'other',
] as const;

/** Why a rental cannot be quoted (`quote-invalid` with `code`). */
export const RENTAL_QUOTE_ISSUES = {
  periodInvalid: 'period_invalid',
  tooLong: 'too_long',
  chauffeurUnavailable: 'chauffeur_unavailable',
  deliveryUnavailable: 'delivery_unavailable',
  deliveryTooFar: 'delivery_too_far',
  currencyUnavailable: 'currency_unavailable',
  notAvailable: 'not_available',
  driverTooYoung: 'driver_too_young',
  ...RENTAL_OPTION_ISSUES,
} as const;

const driverAge = z.number().int().min(RENTAL_DRIVER_AGE_MIN).max(RENTAL_DRIVER_AGE_MAX);

export const vehicleIdParamsSchema = z.object({ vehicleId: z.uuid() });
export const slugParamsSchema = z.object({ slug: slugSchema });
export const reservationIdParamsSchema = z.object({ reservationId: z.uuid() });
export const idParamsSchema = z.object({ id: z.uuid() });

export const rentalSearchQuerySchema = z.object({
  city: z.string().trim().min(2).max(80).default('Lagos'),
  pickupAt: localDateTimeSchema,
  returnAt: localDateTimeSchema,
  category: z.enum(RENTAL_CATEGORIES).optional(),
  transmission: z.enum(TRANSMISSIONS).optional(),
  airport: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false)
    .meta({ description: 'Only cars whose branch is at an airport.' }),
  driverAge: z.coerce.number().pipe(driverAge).optional().meta({
    description: 'Self-drive only: leaves out cars whose minimum driver age is higher.',
  }),
  chauffeur: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
});
export type RentalSearchQuery = z.output<typeof rentalSearchQuerySchema>;

const vehicleCardSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  category: z.enum(RENTAL_CATEGORIES),
  transmission: z.enum(TRANSMISSIONS),
  seats: z.number().int(),
  features: z.array(z.string()),
  photoUrls: z.array(z.string()),
  artKey: z.string().nullable(),
  sample: z.boolean(),
  cityName: z.string(),
  branch: z.object({
    name: z.string(),
    address: z.string(),
    lat: z.number(),
    lng: z.number(),
    airportCode: z
      .string()
      .nullable()
      .meta({ description: 'IATA code when the branch is at an airport.' }),
  }),
  daily: moneySchema,
  weekly: moneySchema.nullable().meta({ description: 'The price of seven days, where offered.' }),
  monthly: moneySchema.nullable().meta({ description: 'The price of thirty days, where offered.' }),
  minDriverAge: z.number().int().meta({ description: 'Youngest driver of a self-drive rental.' }),
  extras: z
    .array(
      z.object({
        code: z.enum(RENTAL_EXTRAS),
        daily: moneySchema,
        max: z.number().int(),
      }),
    )
    .meta({ description: 'Charged per day and per unit.' }),
  crossBorder: z
    .object({ countries: z.array(z.string()), fee: moneySchema })
    .nullable()
    .meta({ description: 'Where the car may be driven abroad, and the flat fee; null when not.' }),
  returnBranches: z
    .array(
      z.object({
        code: z.string(),
        name: z.string(),
        address: z.string(),
        lat: z.number(),
        lng: z.number(),
        airportCode: z.string().nullable(),
        fee: moneySchema,
      }),
    )
    .meta({ description: 'Other places the car may be returned, with the one-way fee.' }),
  chauffeurDaily: moneySchema
    .nullable()
    .meta({ description: 'Null when no chauffeur is offered.' }),
  deposit: moneySchema,
  delivery: z
    .object({ perKm: moneySchema, maxKm: z.number().int() })
    .nullable()
    .meta({ description: 'Delivery at pickup, per started kilometre; null when not offered.' }),
  mileage: z.object({
    kmPerDay: z.number().int().nullable().meta({ description: 'Null for unlimited mileage.' }),
    excessKm: moneySchema.nullable(),
  }),
  fuelPolicy: z.enum(FUEL_POLICIES),
  insuranceSummary: z.string(),
});

export const rentalSearchResultSchema = named(
  'RentalSearchResult',
  z.object({
    days: z.number().int(),
    vehicles: z.array(
      vehicleCardSchema.extend({
        estimate: z.object({
          rental: moneySchema.meta({
            description: 'Car and chauffeur for the period, before fees.',
          }),
          deposit: moneySchema,
          blocks: z
            .object({ months: z.number().int(), weeks: z.number().int(), days: z.number().int() })
            .meta({ description: 'How the days were priced: months, weeks and single days.' }),
        }),
      }),
    ),
  }),
);

export const rentalVehicleSchema = named(
  'RentalVehicle',
  vehicleCardSchema.extend({
    cancellationPolicy: cancellationPolicySchema,
    timeZone: z.string(),
  }),
);

export const availabilityQuerySchema = z.object({
  from: isoDay,
  to: isoDay,
});
export const availabilitySchema = named(
  'RentalAvailability',
  z.object({
    vehicleId: z.uuid(),
    timeZone: z.string(),
    blocked: z.array(z.object({ from: timestamp, until: timestamp })).meta({
      description: 'Periods taken by other rentals, turnaround included. No booking data.',
    }),
  }),
);

// ---------------------------------------------------------------------------
// Renter (the booking's owner)
// ---------------------------------------------------------------------------

export const licenceBodySchema = z.object({
  number: licenceNumberSchema,
  expiresOn: isoDay,
});

export const reservationSchema = named(
  'RentalReservation',
  z.object({
    id: z.uuid(),
    bookingId: z.uuid(),
    status: z.enum(RENTAL_STATUSES),
    licenceRequired: z.boolean(),
    licence: z
      .object({
        status: z.enum(RENTAL_LICENCE_STATES),
        expiresOn: isoDay,
        numberEndsWith: z.string(),
        rejectionReason: z.string().nullable(),
      })
      .nullable(),
  }),
);

// ---------------------------------------------------------------------------
// Staff (ground:manage)
// ---------------------------------------------------------------------------

const minor = z.number().int().min(0).max(10_000_000_000);
const httpsUrl = z.url().refine((value) => value.startsWith('https://'), 'https_required');

/** Every field of a car, with no defaults (updates must not reset what they leave out). */
const vehicleFields = z.object({
  slug: slugSchema,
  make: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  year: z.number().int().min(1990).max(2100),
  category: z.enum(RENTAL_CATEGORIES),
  transmission: z.enum(TRANSMISSIONS),
  seats: z.number().int().min(2).max(20),
  plate: plateSchema,
  features: z.array(z.string().trim().min(1).max(40)).max(20),
  photoUrls: z.array(httpsUrl).max(10),
  artKey: z.string().max(80).nullable(),
  cityName: z.string().trim().min(2).max(80),
  branchName: z.string().trim().min(2).max(120),
  branchAddress: z.string().trim().min(2).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  airportCode: airportCodeSchema.nullable(),
  timeZone: z.string().min(3).max(64),
  currency: currencyCodeSchema,
  dailyMinor: minor.min(1),
  weeklyMinor: minor.min(1).nullable(),
  monthlyMinor: minor.min(1).nullable(),
  minDriverAge: driverAge,
  extras: rentalExtrasSchema,
  crossBorder: rentalCrossBorderSchema.nullable(),
  returnBranches: rentalReturnBranchesSchema,
  chauffeurDailyMinor: minor.min(1).nullable(),
  depositMinor: minor,
  deliveryPerKmMinor: minor.min(1).nullable(),
  deliveryMaxKm: z.number().int().min(1).max(200).nullable(),
  mileageKmPerDay: z.number().int().min(1).max(5000).nullable(),
  excessKmMinor: minor.nullable(),
  fuelPolicy: z.enum(FUEL_POLICIES),
  insuranceSummary: z.string().trim().max(500),
  cancellationPolicy: cancellationPolicySchema,
});

export const vehicleBodySchema = vehicleFields.extend({
  features: vehicleFields.shape.features.default([]),
  photoUrls: vehicleFields.shape.photoUrls.default([]),
  artKey: vehicleFields.shape.artKey.default(null),
  airportCode: vehicleFields.shape.airportCode.default(null),
  weeklyMinor: vehicleFields.shape.weeklyMinor.default(null),
  monthlyMinor: vehicleFields.shape.monthlyMinor.default(null),
  minDriverAge: vehicleFields.shape.minDriverAge.default(RENTAL_DEFAULT_MIN_DRIVER_AGE),
  extras: vehicleFields.shape.extras.default([]),
  crossBorder: vehicleFields.shape.crossBorder.default(null),
  returnBranches: vehicleFields.shape.returnBranches.default([]),
  chauffeurDailyMinor: vehicleFields.shape.chauffeurDailyMinor.default(null),
  deliveryPerKmMinor: vehicleFields.shape.deliveryPerKmMinor.default(null),
  deliveryMaxKm: vehicleFields.shape.deliveryMaxKm.default(null),
  mileageKmPerDay: vehicleFields.shape.mileageKmPerDay.default(null),
  excessKmMinor: vehicleFields.shape.excessKmMinor.default(null),
  fuelPolicy: vehicleFields.shape.fuelPolicy.default('full_to_full'),
  insuranceSummary: vehicleFields.shape.insuranceSummary.default(''),
});
export const vehicleUpdateSchema = vehicleFields
  .omit({ slug: true, plate: true })
  .partial()
  .extend({ status: z.enum(CATALOG_STATUSES).optional() });

export const createdSchema = named('RentalCreated', z.object({ id: z.uuid() }));

export const adminVehicleListSchema = named(
  'AdminRentalVehicles',
  z.object({
    vehicles: z.array(
      vehicleCardSchema.extend({
        status: z.enum(CATALOG_STATUSES),
        plate: z.string(),
        upcomingRentals: z.number().int(),
      }),
    ),
  }),
);

export const adminReservationQuerySchema = z.object({
  status: z.enum(RENTAL_STATUSES).optional(),
  licence: z.enum(RENTAL_LICENCE_STATES).optional(),
});

export const adminReservationSchema = named(
  'AdminRentalReservation',
  z.object({
    id: z.uuid(),
    bookingId: z.uuid(),
    bookingReference: z.string(),
    bookingStatus: z.string(),
    vehicle: z.object({ id: z.uuid(), make: z.string(), model: z.string(), plate: z.string() }),
    renterName: z.string(),
    pickupAt: timestamp,
    returnAt: timestamp,
    chauffeur: z.boolean(),
    chauffeurDriverId: z.uuid().nullable(),
    delivery: z
      .object({ label: z.string(), lat: z.number(), lng: z.number(), km: z.number().int() })
      .nullable(),
    extras: z
      .array(z.object({ code: z.enum(RENTAL_EXTRAS), quantity: z.number().int() }))
      .meta({ description: 'What to fit or note before the car leaves.' }),
    returnBranch: z
      .object({ name: z.string(), address: z.string() })
      .nullable()
      .meta({ description: 'Where the car comes back when not to its own branch.' }),
    crossBorder: z
      .array(z.string())
      .nullable()
      .meta({ description: 'Countries the renter may drive to; null when the car stays.' }),
    driverAge: z.number().int().nullable(),
    status: z.enum(RENTAL_STATUSES),
    licenceRequired: z.boolean(),
    licence: z
      .object({
        id: z.uuid(),
        status: z.enum(RENTAL_LICENCE_STATES),
        expiresOn: isoDay,
        numberEndsWith: z.string(),
        rejectionReason: z.string().nullable(),
      })
      .nullable(),
    handovers: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(['check_out', 'check_in']),
        odometerKm: z.number().int(),
        fuelEighths: z.number().int(),
        damageNotes: z.string().nullable(),
        photoIds: z.array(z.uuid()),
        recordedById: z.uuid(),
        createdAt: timestamp,
      }),
    ),
    deposit: moneySchema,
    depositReleasedAt: timestamp.nullable(),
    depositKept: moneySchema.nullable(),
    depositDeductionReason: z.string().nullable(),
  }),
);
export const adminReservationListSchema = named(
  'AdminRentalReservations',
  z.object({ reservations: z.array(adminReservationSchema) }),
);

export const licenceReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.enum(LICENCE_REJECTION_REASONS).nullable().default(null),
  })
  .refine((body) => body.decision === 'approve' || body.reason !== null, {
    message: 'reason_required',
    path: ['reason'],
  });

export const photoCreatedSchema = named('RentalPhotoCreated', z.object({ id: z.uuid() }));

export const handoverBodySchema = handoverInputSchema.extend({
  kind: z.enum(['check_out', 'check_in']),
  photoIds: z
    .array(z.uuid())
    .min(1)
    .max(12)
    .meta({ description: 'From `adminUploadRentalPhoto`.' }),
  chauffeurDriverId: z
    .uuid()
    .nullable()
    .default(null)
    .meta({ description: 'Check-out of a chauffeured rental: an approved driver.' }),
});

export const depositReleaseSchema = z
  .object({
    keptMinor: minor.default(0),
    reason: z.enum(DEPOSIT_DEDUCTION_REASONS).nullable().default(null),
  })
  .refine((body) => body.keptMinor === 0 || body.reason !== null, {
    message: 'reason_required',
    path: ['reason'],
  });
