import { cookies } from 'next/headers';
import { cache } from 'react';

import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  isSupportedCurrency,
  isSupportedLocale,
  type CurrencyCode,
  type LocaleCode,
} from '@suskii/shared';

/** Functional preference cookies (no consent needed): display currency and locale (ADR-010). */
export const CURRENCY_COOKIE = 'suskii_currency';
export const LOCALE_COOKIE = 'suskii_locale';

export interface Preferences {
  locale: LocaleCode;
  currency: CurrencyCode;
}

export const getPreferences = cache(async (): Promise<Preferences> => {
  const store = await cookies();
  const locale = store.get(LOCALE_COOKIE)?.value ?? '';
  const currency = store.get(CURRENCY_COOKIE)?.value ?? '';
  return {
    locale: isSupportedLocale(locale) ? locale : DEFAULT_LOCALE,
    currency: isSupportedCurrency(currency) ? currency : DEFAULT_CURRENCY,
  };
});
