import { z } from 'zod';

import { toWire } from '@suskii/shared';

import { named } from '../contract/contract';

import type { PriceBreakdown } from './pricing-engine';

export const moneySchema = named(
  'Money',
  z.object({
    amountMinor: z
      .number()
      .int()
      .meta({ description: 'Integer minor units (kobo, cents). Never a float.' }),
    currency: z.string().length(3).meta({ description: 'ISO 4217 code.' }),
  }),
);

export const priceSchema = named(
  'Price',
  z.object({
    currency: z.string().length(3),
    fare: moneySchema.meta({ description: 'Base fare including our margin.' }),
    taxes: moneySchema.meta({ description: 'Taxes and charges collected for the supplier.' }),
    fees: z.array(z.object({ code: z.string(), label: z.string(), amount: moneySchema })),
    discount: z.object({ code: z.string(), amount: moneySchema }).nullable(),
    total: moneySchema,
    fx: z
      .object({
        from: z.string().length(3),
        to: z.string().length(3),
        rate: z.string().meta({ description: '1 unit of `from` in `to`, as an exact decimal.' }),
        asOf: z.iso.datetime(),
        provider: z.string(),
      })
      .nullable()
      .meta({ description: 'Present when the supplier price was converted.' }),
  }),
);

export type PriceDto = z.infer<typeof priceSchema>;

/** Customer-facing view of a breakdown: markup and supplier cost stay internal. */
export function toPriceDto(breakdown: PriceBreakdown): PriceDto {
  return {
    currency: breakdown.currency,
    fare: toWire(breakdown.fare),
    taxes: toWire(breakdown.taxes),
    fees: breakdown.fees.map((fee) => ({
      code: fee.code,
      label: fee.label,
      amount: toWire(fee.amount),
    })),
    discount: breakdown.discount
      ? { code: breakdown.discount.code, amount: toWire(breakdown.discount.amount) }
      : null,
    total: toWire(breakdown.total),
    fx: breakdown.fx,
  };
}
