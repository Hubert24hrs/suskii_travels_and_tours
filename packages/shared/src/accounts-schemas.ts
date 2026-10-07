import { z } from './zod-setup';

import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, PRIME_PERIODS } from './accounts';
import { currencyCodeSchema } from './currency';
import { localeCodeSchema } from './locale';
import { cabinClassSchema, iataCodeSchema, isoDateSchema } from './search';

/** Validation for account preferences, notification choices, Prime plans and price alerts. */

export const preferencesInputSchema = z
  .object({
    locale: localeCodeSchema.nullable(),
    currency: currencyCodeSchema.nullable(),
    homeAirport: iataCodeSchema.nullable(),
    marketingConsent: z.boolean(),
  })
  .partial();
export type PreferencesInput = z.output<typeof preferencesInputSchema>;

export const notificationPreferenceInputSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});

export const notificationPreferencesInputSchema = z.object({
  changes: z.array(notificationPreferenceInputSchema).min(1).max(24),
});

/** Plan benefits as staff enter them (ADR-030). */
export const primeBenefitsSchema = z.object({
  markupShareBps: z.number().int().min(0).max(10_000),
  waivedFeeCodes: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .refine((codes) => new Set(codes).size === codes.length, 'duplicate_fee_code'),
  prioritySupport: z.boolean(),
});

export const primePeriodSchema = z.enum(PRIME_PERIODS);

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/** A price alert as a traveller creates it: a route and one date or one month (ADR-032). */
export const priceAlertInputSchema = z
  .object({
    origin: iataCodeSchema,
    destination: iataCodeSchema,
    departureDate: isoDateSchema.nullable().default(null),
    departureMonth: monthSchema.nullable().default(null),
    cabinClass: cabinClassSchema.default('economy'),
    currency: currencyCodeSchema,
    targetMinor: z.number().int().positive().max(1_000_000_000_000).nullable().default(null),
  })
  .refine((alert) => alert.origin !== alert.destination, {
    message: 'same_origin_destination',
    path: ['destination'],
  })
  .refine((alert) => (alert.departureDate === null) !== (alert.departureMonth === null), {
    message: 'date_or_month',
    path: ['departureDate'],
  });
export type PriceAlertInput = z.output<typeof priceAlertInputSchema>;
