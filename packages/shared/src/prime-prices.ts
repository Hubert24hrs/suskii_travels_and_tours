import { z } from './zod-setup';

import { countryCodeSchema } from './country-code';
import { moneyWireSchema } from './money-schema';

/**
 * A Suskii Prime plan price (ADR-082): an amount in a currency, for every country or only for
 * the one it names.
 */
export const primePriceSchema = moneyWireSchema.extend({
  country: countryCodeSchema.nullable().default(null),
});
export type PrimePrice = z.output<typeof primePriceSchema>;

/** At most this many entries per plan: a few currencies, each with a few country prices. */
export const MAX_PRIME_PRICES = 40;

/** Entries as staff enter them: positive amounts, one per currency and country. */
export const primePricesSchema = z
  .array(primePriceSchema.refine((price) => price.amountMinor > 0, 'must_be_positive'))
  .min(1)
  .max(MAX_PRIME_PRICES)
  .refine(
    (prices) =>
      new Set(prices.map((price) => `${price.currency}:${price.country ?? ''}`)).size ===
      prices.length,
    'one_price_per_currency_and_country',
  );

/**
 * The entry that applies in `country` for `currency`: the country's own, else the currency's
 * entry for everywhere, else null (the plan is not sold in that currency there).
 */
export function resolvePlanPrice<T extends { currency: string; country: string | null }>(
  prices: readonly T[],
  currency: string,
  country: string | null | undefined,
): T | null {
  const inCurrency = prices.filter((price) => price.currency === currency);
  const own = country ? inCurrency.find((price) => price.country === country) : undefined;
  return own ?? inCurrency.find((price) => price.country === null) ?? null;
}

/** One entry per currency as `country` would see it, in the order the currencies first appear. */
export function plansPricesFor<T extends { currency: string; country: string | null }>(
  prices: readonly T[],
  country: string | null | undefined,
): T[] {
  const currencies = [...new Set(prices.map((price) => price.currency))];
  return currencies
    .map((currency) => resolvePlanPrice(prices, currency, country))
    .filter((price): price is T => price !== null);
}
