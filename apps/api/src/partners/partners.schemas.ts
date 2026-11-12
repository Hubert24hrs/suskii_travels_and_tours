import { z } from 'zod';

import { countryCodeSchema } from '@suskii/shared';

import { dashboardQuerySchema } from '../admin/admin-dashboard.schemas';
import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';
import { currencyQuerySchema } from '../search/search.schemas';

export const PARTNER_CATEGORIES = [
  'car_rental',
  'transfer',
  'activity',
  'esim',
  'insurance',
] as const;
const isoDate = z.iso.date();
const count = z.number().int().min(0);

export const partnerCategorySchema = z.enum(PARTNER_CATEGORIES);

export const partnerOffersQuerySchema = currencyQuerySchema
  .extend({
    countryCode: countryCodeSchema.meta({ description: 'Destination country (ISO 3166-1).' }),
    cityName: z.string().trim().min(1).max(80).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    categories: z
      .string()
      .regex(/^[a-z_]+(,[a-z_]+)*$/)
      .transform((value) => value.split(','))
      .pipe(z.array(partnerCategorySchema).min(1))
      .optional()
      .meta({ description: 'Comma-separated categories; all when omitted.' }),
  })
  .refine((query) => !query.startDate || !query.endDate || query.endDate >= query.startDate, {
    path: ['endDate'],
    message: 'ends_before_start',
  });
export type PartnerOffersQuery = z.output<typeof partnerOffersQuerySchema>;

export const bookingPartnerOffersQuerySchema = currencyQuerySchema;

export const partnerOfferSchema = named(
  'PartnerOffer',
  z.object({
    id: z.string(),
    programId: z.string(),
    category: partnerCategorySchema,
    partnerName: z.string().meta({ description: 'The partner the traveller books with.' }),
    title: z
      .string()
      .nullable()
      .meta({ description: 'A product title (activities); null for a partner page.' }),
    imageUrl: z.string().nullable(),
    rating: z.object({ average: z.number().min(0).max(5), count }).nullable(),
    durationMinutes: z.number().int().positive().nullable(),
    fromPrice: moneySchema
      .nullable()
      .meta({ description: "The partner's lowest price, converted to the display currency." }),
    href: z.string().meta({
      description:
        'API path of the tracked link (`/v1/go/{token}`), opened in the browser; valid for PARTNER_LINK_TTL_HOURS.',
    }),
    sample: z.boolean().meta({ description: 'Invented sample data (local and test stacks).' }),
  }),
);

export const partnerOffersSchema = named(
  'PartnerOffers',
  z.object({
    trip: z.object({
      countryCode: z.string(),
      cityName: z.string().nullable(),
      startDate: isoDate.nullable(),
      endDate: isoDate.nullable(),
    }),
    offers: z.array(partnerOfferSchema),
    partial: z.boolean().meta({ description: 'True when a partner could not answer in time.' }),
  }),
);
export type PartnerOffersDto = z.infer<typeof partnerOffersSchema>;

export const partnerLinkParamsSchema = z.object({
  token: z.string().min(16).max(2048),
});

export const postbackParamsSchema = z.object({ network: z.enum(['travelpayouts']) });

const postbackFields = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .meta({ description: "The network's booking or action id." }),
  click: z.string().trim().max(64).optional().meta({ description: 'Our click id (the `sub_id`).' }),
  status: z.string().trim().min(1).max(32),
  price: z.string().trim().max(32).optional(),
  commission: z.string().trim().max(32).optional(),
  currency: z.string().trim().max(3).optional(),
  commission_currency: z.string().trim().max(3).optional(),
};
const postbackToken = {
  token: z.string().min(1).max(256).meta({ description: 'The postback secret.' }),
};

export const postbackQuerySchema = z.object({ ...postbackToken, ...postbackFields });
export const postbackTokenQuerySchema = z.object(postbackToken);
export const postbackBodySchema = z.object(postbackFields);
export type PostbackInput = z.infer<typeof postbackBodySchema>;

export const postbackResultSchema = named(
  'PartnerPostbackResult',
  z.object({ status: z.enum(['pending', 'confirmed', 'cancelled']) }),
);

export const partnerSummaryQuerySchema = dashboardQuerySchema;

const commissionTotals = z
  .array(moneySchema)
  .meta({ description: 'Per currency, never converted.' });
const conversionCounts = z.object({ pending: count, confirmed: count, cancelled: count });

export const partnerSummarySchema = named(
  'AdminPartnerSummary',
  z.object({
    range: z.object({ from: isoDate, to: isoDate }),
    programs: z.array(
      z.object({
        programId: z.string(),
        partnerName: z.string(),
        category: partnerCategorySchema,
        clicks: count,
        conversions: conversionCounts,
        confirmedCommission: commissionTotals,
        pendingCommission: commissionTotals,
      }),
    ),
    unattributed: z
      .object({
        conversions: conversionCounts,
        confirmedCommission: commissionTotals,
        pendingCommission: commissionTotals,
      })
      .meta({ description: 'Conversions whose click is unknown or was purged.' }),
  }),
);
export type PartnerSummaryDto = z.infer<typeof partnerSummarySchema>;
