import { z } from 'zod';

/** ISO 4217 codes the platform can display and settle in. Order drives UI selectors. */
export const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR'] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: CurrencyCode = 'NGN';

export const currencyCodeSchema = z.enum(SUPPORTED_CURRENCIES);

export function isSupportedCurrency(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
