import { z } from 'zod';

import {
  CATALOG_STATUSES,
  countryCodeSchema,
  currencyCodeSchema,
  primeBenefitsSchema,
  primePeriodSchema,
  primePricesSchema,
  slugSchema,
} from '@suskii/shared';

import { primeBenefitsDtoSchema } from '../bookings/bookings.schemas';
import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

const timestamp = z.iso.datetime();

/** Positive amounts, one per currency and country (ADR-082); a null country is everywhere else. */
const planPrices = primePricesSchema;

const primePriceSchema = named(
  'PrimePrice',
  z.object({
    amountMinor: z.number().int(),
    currency: z.string().length(3),
    country: z.string().length(2).nullable().meta({
      description: 'Only for visitors from this country; null for everywhere else.',
    }),
  }),
);

export const primePlanSchema = named(
  'PrimePlan',
  z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    summary: z.string(),
    period: primePeriodSchema,
    price: moneySchema.nullable().meta({
      description:
        "In the requested currency for the visitor's country; null when the plan is not sold in it there.",
    }),
    prices: z
      .array(moneySchema)
      .meta({ description: "One per currency, as priced for the visitor's country." }),
    benefits: primeBenefitsDtoSchema,
    sample: z.boolean().meta({ description: 'Demo plan (`db:seed:demo`): show a "Sample" badge.' }),
  }),
);

export const primePlanListSchema = named(
  'PrimePlanList',
  z.object({ plans: z.array(primePlanSchema) }),
);

export const primePlansQuerySchema = z.object({
  currency: currencyCodeSchema.optional(),
  country: countryCodeSchema.optional().meta({
    description:
      "The visitor's country for the displayed prices (the website's server passes its edge country); defaults to the edge's country of this request. A quote is always priced for the edge's country of the quote request.",
  }),
});

export const myPrimeSchema = named(
  'MyPrime',
  z.object({
    member: z.boolean(),
    current: z
      .object({
        plan: z.object({ slug: z.string(), name: z.string(), period: primePeriodSchema }),
        startsAt: timestamp,
        until: timestamp.meta({ description: 'The end of the last paid term.' }),
        benefits: primeBenefitsDtoSchema,
      })
      .nullable(),
    terms: z.array(
      z.object({
        id: z.uuid(),
        planName: z.string(),
        status: z.enum(['active', 'cancelled']),
        startsAt: timestamp,
        endsAt: timestamp,
        bookingId: z.uuid(),
      }),
    ),
  }),
);

// --- Admin -----------------------------------------------------------------------------

export const adminPrimePlanSchema = named(
  'AdminPrimePlan',
  z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    summary: z.string(),
    period: primePeriodSchema,
    prices: z.array(primePriceSchema),
    benefits: primeBenefitsSchema,
    status: z.enum(CATALOG_STATUSES),
    sample: z.boolean(),
    sortOrder: z.number().int(),
    activeMembers: z.number().int(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);

export const adminPrimePlanListSchema = named(
  'AdminPrimePlanList',
  z.object({ plans: z.array(adminPrimePlanSchema) }),
);

const planFields = {
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(300),
  period: primePeriodSchema,
  prices: planPrices,
  benefits: primeBenefitsSchema,
  sortOrder: z.number().int().min(0).max(1000).default(0),
};

export const createPrimePlanSchema = named('CreatePrimePlan', z.object(planFields));
export type CreatePrimePlan = z.output<typeof createPrimePlanSchema>;

export const updatePrimePlanSchema = named(
  'UpdatePrimePlan',
  z
    .object({
      name: planFields.name,
      summary: planFields.summary,
      prices: planFields.prices,
      benefits: planFields.benefits,
      sortOrder: z.number().int().min(0).max(1000),
      status: z.enum(CATALOG_STATUSES),
    })
    .partial()
    .refine((value) => Object.keys(value).length > 0, 'nothing_to_update'),
);
export type UpdatePrimePlan = z.output<typeof updatePrimePlanSchema>;

export const planIdParamsSchema = z.object({ id: z.uuid() });
