import { z } from 'zod';

import { bookingVerticalSchema } from '../bookings/bookings.schemas';
import { named } from '../contract/contract';

const timestamp = z.iso.datetime();
const currency = z.string().regex(/^[A-Z]{3}$/);
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const channel = z.enum(['web', 'mobile']);
const userTier = z.enum(['guest', 'member', 'prime']);
const cabinClass = z.enum(['economy', 'premium_economy', 'business', 'first']);
const adjustmentType = z.enum(['percentage', 'fixed']);
const iata = z.string().regex(/^[A-Z]{3}$/);
const country = z.string().regex(/^[A-Z]{2}$/);

/** Shared checks (ADR-035): percentages in basis points up to 100%, money with its currency. */
function checkAdjustment(
  value: {
    type: 'percentage' | 'fixed';
    value: number;
    currency: string | null;
    minAmountMinor: number | null;
    maxAmountMinor: number | null;
    validFrom: string | null;
    validTo: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.type === 'percentage' && value.value > 10_000) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'percent_too_large' });
  }
  if (
    (value.type === 'fixed' || value.minAmountMinor !== null || value.maxAmountMinor !== null) &&
    value.currency === null
  ) {
    ctx.addIssue({ code: 'custom', path: ['currency'], message: 'currency_required' });
  }
  if (
    value.minAmountMinor !== null &&
    value.maxAmountMinor !== null &&
    value.minAmountMinor > value.maxAmountMinor
  ) {
    ctx.addIssue({ code: 'custom', path: ['maxAmountMinor'], message: 'below_minimum' });
  }
  if (
    value.validFrom &&
    value.validTo &&
    Date.parse(value.validTo) <= Date.parse(value.validFrom)
  ) {
    ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'ends_before_start' });
  }
}

const markupFields = z.object({
  name: z.string().trim().min(2).max(100),
  vertical: bookingVerticalSchema,
  priority: z.number().int().min(0).max(10_000).meta({ description: 'Lowest number wins.' }),
  active: z.boolean(),
  channel: channel.nullable(),
  userTier: userTier.nullable(),
  supplier: z.string().trim().min(1).max(40).nullable(),
  originCode: iata.nullable(),
  destinationCode: iata.nullable(),
  originCountry: country.nullable(),
  destinationCountry: country.nullable(),
  carrierCode: z
    .string()
    .regex(/^[A-Z0-9]{2,3}$/)
    .nullable(),
  cabinClass: cabinClass.nullable(),
  type: adjustmentType,
  value: minor.meta({
    description: 'Basis points for percentages (250 = 2.5%), minor units of `currency` for fixed.',
  }),
  currency: currency.nullable(),
  minAmountMinor: minor.nullable(),
  maxAmountMinor: minor.nullable(),
  validFrom: timestamp.nullable(),
  validTo: timestamp.nullable(),
});
export type MarkupFields = z.infer<typeof markupFields>;

export const markupRuleInputSchema = named(
  'MarkupRuleInput',
  markupFields.superRefine(checkAdjustment),
);
export const markupRulePatchSchema = named('MarkupRulePatch', markupFields.partial());
/** The merged rule after a patch is checked like a new one. */
export const markupRuleCheck = markupFields.superRefine(checkAdjustment);

export const adminMarkupRuleSchema = named(
  'AdminMarkupRule',
  markupFields.extend({ id: z.uuid(), createdAt: timestamp, updatedAt: timestamp }),
);

const feeFields = z.object({
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,39}$/)
    .meta({
      description: 'Stable machine code, e.g. service_fee; Prime plans waive fees by code.',
    }),
  label: z.string().trim().min(2).max(80),
  vertical: bookingVerticalSchema,
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  channel: channel.nullable(),
  userTier: userTier.nullable(),
  type: adjustmentType,
  value: minor,
  currency: currency.nullable(),
  basis: z.enum(['per_booking', 'per_passenger']),
  minAmountMinor: minor.nullable(),
  maxAmountMinor: minor.nullable(),
  validFrom: timestamp.nullable(),
  validTo: timestamp.nullable(),
});
export type FeeFields = z.infer<typeof feeFields>;

export const feeRuleInputSchema = named('FeeRuleInput', feeFields.superRefine(checkAdjustment));
export const feeRulePatchSchema = named('FeeRulePatch', feeFields.partial());
export const feeRuleCheck = feeFields.superRefine(checkAdjustment);

export const adminFeeRuleSchema = named(
  'AdminFeeRule',
  feeFields.extend({ id: z.uuid(), createdAt: timestamp, updatedAt: timestamp }),
);

export const ruleListQuerySchema = z.object({
  vertical: bookingVerticalSchema.optional(),
});

export const adminMarkupRuleListSchema = named(
  'AdminMarkupRuleList',
  z.object({ rules: z.array(adminMarkupRuleSchema) }),
);
export const adminFeeRuleListSchema = named(
  'AdminFeeRuleList',
  z.object({ rules: z.array(adminFeeRuleSchema) }),
);

export const ruleIdParamsSchema = z.object({ id: z.uuid() });
