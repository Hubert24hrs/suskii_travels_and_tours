import { z } from 'zod';

import {
  countryCodeSchema,
  money,
  RENTAL_EXTRA_ISSUES,
  RENTAL_EXTRA_MAX_QUANTITY,
  RENTAL_EXTRAS,
  rentalExtrasCharge,
  slugSchema,
  toWire,
  zero,
  type Money,
  type RentalExtraChoice,
  type RentalExtraLine,
  type RentalExtraOffer,
  type RentalRates,
} from '@suskii/shared';

import type { RentalVehicle } from '../generated/prisma/client';

/**
 * What a car offers beyond its daily rate (ADR-098): extras per day, a flat fee to take it
 * abroad and other places it may be returned. Staff enter them with the car; they are stored as
 * JSON on the vehicle and read through `rentalOptions()`, which never trusts what is stored.
 */

const minor = z.number().int().min(0).max(10_000_000_000);
const airportCode = z.string().regex(/^[A-Z]{3}$/, 'invalid_airport_code');

export const airportCodeSchema = airportCode;

export const rentalExtraOfferSchema = z.object({
  code: z.enum(RENTAL_EXTRAS),
  dailyMinor: minor.min(1),
  max: z.number().int().min(1).max(RENTAL_EXTRA_MAX_QUANTITY),
});

export const rentalCrossBorderSchema = z.object({
  countries: z
    .array(countryCodeSchema)
    .min(1)
    .max(20)
    .meta({ description: 'Countries the car may be driven to, ISO 3166-1 alpha-2.' }),
  feeMinor: minor.meta({ description: 'Flat fee per rental for the cover and the papers.' }),
});

export const rentalReturnBranchSchema = z.object({
  code: slugSchema,
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  feeMinor: minor.meta({ description: 'One-way fee for returning the car here.' }),
  airportCode: airportCode.nullable().default(null),
});

export const rentalExtrasSchema = z
  .array(rentalExtraOfferSchema)
  .max(RENTAL_EXTRAS.length)
  .refine((extras) => new Set(extras.map((extra) => extra.code)).size === extras.length, {
    message: 'duplicate_extra',
  });
export const rentalReturnBranchesSchema = z
  .array(rentalReturnBranchSchema)
  .max(10)
  .refine((branches) => new Set(branches.map((branch) => branch.code)).size === branches.length, {
    message: 'duplicate_branch',
  });

export interface RentalReturnBranch {
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  airportCode: string | null;
}

export interface RentalOptions {
  extras: RentalExtraOffer[];
  crossBorder: { countries: string[]; fee: Money } | null;
  returnBranches: (RentalReturnBranch & { fee: Money })[];
}

/** A car's options as stored. Anything unreadable is left out: it never fails a search. */
export function rentalOptions(vehicle: {
  extras: unknown;
  crossBorder: unknown;
  returnBranches: unknown;
  currency: string;
}): RentalOptions {
  const extras = rentalExtrasSchema.safeParse(vehicle.extras);
  const crossBorder = rentalCrossBorderSchema.safeParse(vehicle.crossBorder);
  const branches = rentalReturnBranchesSchema.safeParse(vehicle.returnBranches);
  return {
    extras: extras.success
      ? extras.data.map((extra) => ({
          code: extra.code,
          daily: money(BigInt(extra.dailyMinor), vehicle.currency),
          max: extra.max,
        }))
      : [],
    crossBorder: crossBorder.success
      ? {
          countries: crossBorder.data.countries,
          fee: money(BigInt(crossBorder.data.feeMinor), vehicle.currency),
        }
      : null,
    returnBranches: branches.success
      ? branches.data.map(({ feeMinor, ...branch }) => ({
          ...branch,
          fee: money(BigInt(feeMinor), vehicle.currency),
        }))
      : [],
  };
}

/** What the renter chose beyond the car and the period. */
export interface RentalSelection {
  extras: readonly RentalExtraChoice[];
  /** The `code` of another branch to return the car to; null for the pickup branch. */
  returnBranch: string | null;
  crossBorder: boolean;
}

export const NO_RENTAL_SELECTION: RentalSelection = {
  extras: [],
  returnBranch: null,
  crossBorder: false,
};

/** Why a selection cannot be priced (`quote-invalid` codes). */
export const RENTAL_OPTION_ISSUES = {
  ...RENTAL_EXTRA_ISSUES,
  returnBranchUnavailable: 'return_branch_unavailable',
  crossBorderUnavailable: 'cross_border_unavailable',
} as const;
export type RentalOptionIssue = (typeof RENTAL_OPTION_ISSUES)[keyof typeof RENTAL_OPTION_ISSUES];

export interface RentalOptionCharges {
  extras: RentalExtraLine[];
  extrasTotal: Money;
  returnBranch: RentalReturnBranch | null;
  oneWay: Money;
  crossBorder: { countries: string[] } | null;
  crossBorderFee: Money;
}

/**
 * A selection priced against what the car offers today, or the first reason it cannot be. Used
 * for the quote and again at the payment re-check, so a withdrawn option is never sold.
 */
export function rentalOptionCharges(
  options: RentalOptions,
  selection: RentalSelection,
  days: number,
  chauffeur: boolean,
  currency: string,
): RentalOptionCharges | { issue: RentalOptionIssue } {
  const extras = rentalExtrasCharge(options.extras, selection.extras, days, chauffeur, currency);
  if ('issue' in extras) return extras;
  let returnBranch: RentalReturnBranch | null = null;
  let oneWay = zero(currency);
  if (selection.returnBranch !== null) {
    const branch = options.returnBranches.find((entry) => entry.code === selection.returnBranch);
    if (!branch) return { issue: RENTAL_OPTION_ISSUES.returnBranchUnavailable };
    const { fee, ...place } = branch;
    returnBranch = place;
    oneWay = fee;
  }
  if (selection.crossBorder && !options.crossBorder) {
    return { issue: RENTAL_OPTION_ISSUES.crossBorderUnavailable };
  }
  return {
    extras: extras.lines,
    extrasTotal: extras.total,
    returnBranch,
    oneWay,
    crossBorder:
      selection.crossBorder && options.crossBorder
        ? { countries: options.crossBorder.countries }
        : null,
    crossBorderFee:
      selection.crossBorder && options.crossBorder ? options.crossBorder.fee : zero(currency),
  };
}

/** A car's rates as the pricing rules read them: for the quote and the payment re-check. */
export const rentalRates = (vehicle: {
  currency: string;
  dailyMinor: bigint;
  weeklyMinor: bigint | null;
  monthlyMinor: bigint | null;
  chauffeurDailyMinor: bigint | null;
  depositMinor: bigint;
}): RentalRates => ({
  daily: money(vehicle.dailyMinor, vehicle.currency),
  weekly: vehicle.weeklyMinor === null ? null : money(vehicle.weeklyMinor, vehicle.currency),
  monthly: vehicle.monthlyMinor === null ? null : money(vehicle.monthlyMinor, vehicle.currency),
  chauffeurDaily:
    vehicle.chauffeurDailyMinor === null
      ? null
      : money(vehicle.chauffeurDailyMinor, vehicle.currency),
  deposit: money(vehicle.depositMinor, vehicle.currency),
});

/** A car as every list and page shows it: its rates, options and terms on the wire. */
export function vehicleCard(vehicle: RentalVehicle) {
  const options = rentalOptions(vehicle);
  return {
    id: vehicle.id,
    slug: vehicle.slug,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    category: vehicle.category,
    transmission: vehicle.transmission,
    seats: vehicle.seats,
    features: vehicle.features,
    photoUrls: vehicle.photoUrls,
    artKey: vehicle.artKey,
    sample: vehicle.sample,
    cityName: vehicle.cityName,
    branch: {
      name: vehicle.branchName,
      address: vehicle.branchAddress,
      lat: vehicle.lat,
      lng: vehicle.lng,
      airportCode: vehicle.airportCode,
    },
    daily: toWire(money(vehicle.dailyMinor, vehicle.currency)),
    weekly:
      vehicle.weeklyMinor === null ? null : toWire(money(vehicle.weeklyMinor, vehicle.currency)),
    monthly:
      vehicle.monthlyMinor === null ? null : toWire(money(vehicle.monthlyMinor, vehicle.currency)),
    minDriverAge: vehicle.minDriverAge,
    extras: options.extras.map((extra) => ({
      code: extra.code,
      daily: toWire(extra.daily),
      max: extra.max,
    })),
    crossBorder: options.crossBorder
      ? { countries: options.crossBorder.countries, fee: toWire(options.crossBorder.fee) }
      : null,
    returnBranches: options.returnBranches.map(({ fee, ...branch }) => ({
      ...branch,
      fee: toWire(fee),
    })),
    chauffeurDaily:
      vehicle.chauffeurDailyMinor === null
        ? null
        : toWire(money(vehicle.chauffeurDailyMinor, vehicle.currency)),
    deposit: toWire(money(vehicle.depositMinor, vehicle.currency)),
    delivery:
      vehicle.deliveryPerKmMinor !== null && vehicle.deliveryMaxKm !== null
        ? {
            perKm: toWire(money(vehicle.deliveryPerKmMinor, vehicle.currency)),
            maxKm: vehicle.deliveryMaxKm,
          }
        : null,
    mileage: {
      kmPerDay: vehicle.mileageKmPerDay,
      excessKm:
        vehicle.excessKmMinor === null
          ? null
          : toWire(money(vehicle.excessKmMinor, vehicle.currency)),
    },
    fuelPolicy: vehicle.fuelPolicy as 'full_to_full' | 'same_to_same',
    insuranceSummary: vehicle.insuranceSummary,
  };
}
