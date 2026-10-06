import { z } from 'zod';

import { bookingVerticalSchema } from '../bookings/bookings.schemas';
import { named } from '../contract/contract';

import { booleanParam } from './admin.schemas';

const timestamp = z.iso.datetime();
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const limit = z.number().int().min(1).max(1_000_000);

const promoFields = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4,20}$/)
    .meta({ description: '4 to 20 letters and digits, stored upper-case.' }),
  description: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .meta({ description: 'Internal note for staff.' }),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).meta({
    description: 'Basis points for percentages (1000 = 10%), minor units of `currency` for fixed.',
  }),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  maxDiscountMinor: minor.nullable(),
  minSpendMinor: minor.nullable(),
  verticals: z
    .array(bookingVerticalSchema)
    .max(7)
    .refine((list) => new Set(list).size === list.length, 'duplicate_vertical')
    .meta({ description: 'Empty means every vertical.' }),
  validFrom: timestamp.nullable(),
  validTo: timestamp.nullable(),
  maxRedemptions: limit.nullable(),
  maxRedemptionsPerUser: limit.nullable(),
  requiresAccount: z.boolean(),
  active: z.boolean(),
});
export type PromoFields = z.infer<typeof promoFields>;

function checkPromo(value: PromoFields, ctx: z.RefinementCtx): void {
  if (value.type === 'percentage' && value.value > 10_000) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'percent_too_large' });
  }
  if (
    (value.type === 'fixed' || value.maxDiscountMinor !== null || value.minSpendMinor !== null) &&
    value.currency === null
  ) {
    ctx.addIssue({ code: 'custom', path: ['currency'], message: 'currency_required' });
  }
  if (
    value.validFrom &&
    value.validTo &&
    Date.parse(value.validTo) <= Date.parse(value.validFrom)
  ) {
    ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'ends_before_start' });
  }
  if (
    value.maxRedemptions !== null &&
    value.maxRedemptionsPerUser !== null &&
    value.maxRedemptionsPerUser > value.maxRedemptions
  ) {
    ctx.addIssue({ code: 'custom', path: ['maxRedemptionsPerUser'], message: 'above_total' });
  }
}

export const promoInputSchema = named('PromoCodeInput', promoFields.superRefine(checkPromo));
export const promoPatchSchema = named('PromoCodePatch', promoFields.partial());
export const promoCheck = promoFields.superRefine(checkPromo);

export const adminPromoSchema = named(
  'AdminPromoCode',
  promoFields.extend({
    id: z.uuid(),
    redemptions: z.number().int().min(0),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);

export const promoListQuerySchema = z.object({
  q: z.string().trim().min(1).max(20).optional().meta({ description: 'Code prefix.' }),
  active: booleanParam.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminPromoPageSchema = named(
  'AdminPromoCodePage',
  z.object({ items: z.array(adminPromoSchema), nextCursor: z.uuid().nullable() }),
);

export const promoIdParamsSchema = z.object({ id: z.uuid() });
