import { z } from 'zod';

/** BCP 47 locale tags with message catalogs. `fr` and `pcm` are planned. */
export const SUPPORTED_LOCALES = ['en-NG', 'en-GB', 'en-US'] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: LocaleCode = 'en-NG';

export const localeCodeSchema = z.enum(SUPPORTED_LOCALES);

export function isSupportedLocale(value: string): value is LocaleCode {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
