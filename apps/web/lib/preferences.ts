import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  isSupportedCurrency,
  isSupportedLocale,
  type CurrencyCode,
  type LocaleCode,
} from '@suskii/shared';

import { hostCookie } from './cookie-names';

/** Functional preference cookies (no consent needed): display currency and locale (ADR-010). */
export const CURRENCY_COOKIE = hostCookie('suskii_currency');
export const LOCALE_COOKIE = hostCookie('suskii_locale');
/** Data saver chosen in the footer, `on` or `off` (ADR-075). */
export const DATA_SAVER_COOKIE = hostCookie('suskii_data_saver');

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

/**
 * Data saver (ADR-075): the footer choice wins; without one, the browser's `Save-Data` signal
 * (sent when the phone's data saver is on). Pages then ask for fewer results and show art instead
 * of photos.
 */
export const getDataSaver = cache(async (): Promise<boolean> => {
  const choice = (await cookies()).get(DATA_SAVER_COOKIE)?.value;
  if (choice === 'on' || choice === 'off') return choice === 'on';
  return (await headers()).get('save-data')?.toLowerCase() === 'on';
});
