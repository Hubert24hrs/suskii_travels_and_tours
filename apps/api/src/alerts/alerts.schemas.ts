import { z } from 'zod';

import { CABIN_CLASSES, priceAlertInputSchema } from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

const timestamp = z.iso.datetime();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const priceAlertSchema = named(
  'PriceAlert',
  z.object({
    id: z.uuid(),
    origin: z.string().length(3),
    destination: z.string().length(3),
    departureDate: isoDate.nullable(),
    departureMonth: z.string().nullable().meta({ description: 'YYYY-MM: the cheapest date.' }),
    cabinClass: z.enum(CABIN_CLASSES),
    currency: z.string().length(3),
    target: moneySchema.nullable(),
    lastPrice: moneySchema.nullable(),
    lastCheckedAt: timestamp.nullable(),
    lastNotifiedAt: timestamp.nullable(),
    active: z.boolean(),
    endsOn: isoDate,
    createdAt: timestamp,
  }),
);
export type PriceAlertDto = z.infer<typeof priceAlertSchema>;

export const priceAlertListSchema = named(
  'PriceAlertList',
  z.object({
    alerts: z.array(priceAlertSchema),
    limit: z.number().int().meta({ description: 'Active alerts allowed per account.' }),
  }),
);

export const createPriceAlertSchema = named('CreatePriceAlert', priceAlertInputSchema);

export const alertIdParamsSchema = z.object({ id: z.uuid() });

export const priceAlertRunSchema = named(
  'PriceAlertRun',
  z.object({
    checked: z.number().int(),
    notified: z.number().int(),
    retired: z.number().int(),
    failed: z.number().int(),
  }),
);
