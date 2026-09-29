'use server';

import { cookies } from 'next/headers';

import { isSupportedCurrency, isSupportedLocale } from '@suskii/shared';

import { CURRENCY_COOKIE, LOCALE_COOKIE } from '../lib/preferences';

const ONE_YEAR = 365 * 24 * 60 * 60;

async function setPreference(name: string, value: string): Promise<void> {
  (await cookies()).set(name, value, {
    path: '/',
    maxAge: ONE_YEAR,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
}

/** Display currency (header selector). Unknown values are ignored. */
export async function setCurrency(formData: FormData): Promise<void> {
  const value = formData.get('currency');
  if (typeof value === 'string' && isSupportedCurrency(value))
    await setPreference(CURRENCY_COOKIE, value);
}

/** Formatting locale (footer selector). Unknown values are ignored. */
export async function setLocale(formData: FormData): Promise<void> {
  const value = formData.get('locale');
  if (typeof value === 'string' && isSupportedLocale(value))
    await setPreference(LOCALE_COOKIE, value);
}
