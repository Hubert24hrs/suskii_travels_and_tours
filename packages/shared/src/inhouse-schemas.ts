import { z } from './zod-setup';

import {
  ADDON_DETAIL_FIELDS,
  MAX_CANCELLATION_TIERS,
  sortTiers,
  type CancellationTier,
} from './inhouse';
import { moneyWireSchema } from './money-schema';

/** Validation for catalog content entered by staff and stored as JSON (ADR-025). */

export const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, digits and single dashes');

const text = (max: number) => z.string().trim().min(1).max(max);

export const cancellationTierSchema = z.object({
  daysBefore: z.number().int().min(0).max(365),
  refundBps: z.number().int().min(0).max(10_000),
});

/**
 * Tiers with distinct `daysBefore`; cancelling earlier never refunds less than cancelling later.
 */
export const cancellationPolicySchema = z
  .array(cancellationTierSchema)
  .min(1)
  .max(MAX_CANCELLATION_TIERS)
  .superRefine((tiers: CancellationTier[], ctx) => {
    const sorted = sortTiers(tiers);
    sorted.forEach((tier, index) => {
      const next = sorted[index + 1];
      if (!next) return;
      if (next.daysBefore === tier.daysBefore)
        ctx.addIssue({ code: 'custom', message: 'duplicate_tier' });
      if (next.refundBps > tier.refundBps)
        ctx.addIssue({ code: 'custom', message: 'later_refunds_more' });
    });
  });

const positiveMoney = moneyWireSchema.refine((value) => value.amountMinor > 0, 'must_be_positive');

/** Per-person base prices in one currency; `null` bars children or infants. */
export const perPersonPricesSchema = z
  .object({
    adult: positiveMoney,
    child: moneyWireSchema.nullable(),
    infant: moneyWireSchema.nullable(),
  })
  .refine(
    (prices) =>
      [prices.child, prices.infant].every(
        (price) => price === null || price.currency === prices.adult.currency,
      ),
    'currency_mismatch',
  );

export const itineraryDaySchema = z.object({
  day: z.number().int().min(1).max(60),
  title: text(120),
  body: text(2000),
});
export const itinerarySchema = z.array(itineraryDaySchema).max(60);

/** Highlights, inclusions and exclusions. */
export const textListSchema = z.array(text(200)).max(30);

export const meetingPointSchema = z.object({
  name: text(120),
  address: text(300),
  notes: z.string().trim().max(500).nullable(),
});

export const visaChecklistItemSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower-case letters, digits and underscores'),
  label: text(120),
  description: z.string().trim().max(500),
  required: z.boolean(),
});
export const visaChecklistSchema = z
  .array(visaChecklistItemSchema)
  .min(1)
  .max(30)
  .refine((items) => new Set(items.map((item) => item.key)).size === items.length, 'duplicate_key');

export const addonDetailFieldsSchema = z
  .array(z.enum(ADDON_DETAIL_FIELDS))
  .max(ADDON_DETAIL_FIELDS.length)
  .refine((fields) => new Set(fields).size === fields.length, 'duplicate_field');

export type PerPersonPricesWire = z.infer<typeof perPersonPricesSchema>;
export type ItineraryDay = z.infer<typeof itineraryDaySchema>;
export type MeetingPoint = z.infer<typeof meetingPointSchema>;
export type VisaChecklistItem = z.infer<typeof visaChecklistItemSchema>;
