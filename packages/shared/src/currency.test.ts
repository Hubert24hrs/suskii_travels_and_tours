import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  currencyCodeSchema,
  isSupportedCurrency,
} from './currency';

describe('currency', () => {
  it('defaults to NGN, which is in the supported list', () => {
    expect(DEFAULT_CURRENCY).toBe('NGN');
    expect(SUPPORTED_CURRENCIES).toContain(DEFAULT_CURRENCY);
  });

  it('only lists unique, upper-case ISO 4217 style codes', () => {
    expect(new Set(SUPPORTED_CURRENCIES).size).toBe(SUPPORTED_CURRENCIES.length);
    for (const code of SUPPORTED_CURRENCIES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('narrows supported codes and rejects everything else', () => {
    expect(isSupportedCurrency('GHS')).toBe(true);
    expect(isSupportedCurrency('ngn')).toBe(false);
    expect(isSupportedCurrency('JPY')).toBe(false);
  });

  it('validates with the Zod schema', () => {
    expect(currencyCodeSchema.parse('KES')).toBe('KES');
    expect(currencyCodeSchema.safeParse('BTC').success).toBe(false);
  });
});
