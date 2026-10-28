import { describe, expect, it } from 'vitest';

import { plansPricesFor, primePricesSchema, resolvePlanPrice } from './prime-prices';

const prices = [
  { amountMinor: 2_500_000, currency: 'NGN', country: null },
  { amountMinor: 2_500, currency: 'USD', country: null },
  { amountMinor: 1_800, currency: 'USD', country: 'GH' },
  { amountMinor: 2_000, currency: 'USD', country: 'KE' },
  { amountMinor: 1_500, currency: 'GBP', country: 'GB' },
];

describe('Prime prices per country (ADR-082)', () => {
  it("picks the country's own price, else the currency's price for everywhere", () => {
    expect(resolvePlanPrice(prices, 'USD', 'GH')?.amountMinor).toBe(1_800);
    expect(resolvePlanPrice(prices, 'USD', 'KE')?.amountMinor).toBe(2_000);
    expect(resolvePlanPrice(prices, 'USD', 'NG')?.amountMinor).toBe(2_500);
    expect(resolvePlanPrice(prices, 'USD', null)?.amountMinor).toBe(2_500);
    expect(resolvePlanPrice(prices, 'NGN', 'GH')?.amountMinor).toBe(2_500_000);
  });

  it('sells nothing in a currency that has only other countries’ prices', () => {
    expect(resolvePlanPrice(prices, 'GBP', 'GB')?.amountMinor).toBe(1_500);
    expect(resolvePlanPrice(prices, 'GBP', 'NG')).toBeNull();
    expect(resolvePlanPrice(prices, 'GBP', undefined)).toBeNull();
    expect(resolvePlanPrice(prices, 'EUR', 'FR')).toBeNull();
  });

  it('lists one price per currency as a visitor from a country sees them', () => {
    expect(
      plansPricesFor(prices, 'GH').map((price) => [price.currency, price.amountMinor]),
    ).toEqual([
      ['NGN', 2_500_000],
      ['USD', 1_800],
    ]);
    expect(plansPricesFor(prices, 'GB').map((price) => price.currency)).toEqual([
      'NGN',
      'USD',
      'GBP',
    ]);
  });

  it('accepts old entries without a country and refuses duplicates or zero', () => {
    expect(primePricesSchema.parse([{ amountMinor: 100, currency: 'USD' }])).toEqual([
      { amountMinor: 100, currency: 'USD', country: null },
    ]);
    expect(primePricesSchema.safeParse(prices).success).toBe(true);
    expect(
      primePricesSchema.safeParse([
        { amountMinor: 100, currency: 'USD', country: 'GH' },
        { amountMinor: 200, currency: 'USD', country: 'GH' },
      ]).success,
    ).toBe(false);
    expect(primePricesSchema.safeParse([{ amountMinor: 0, currency: 'USD' }]).success).toBe(false);
    expect(
      primePricesSchema.safeParse([{ amountMinor: 100, currency: 'USD', country: 'gh' }]).success,
    ).toBe(false);
  });
});
