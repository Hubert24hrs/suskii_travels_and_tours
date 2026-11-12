/**
 * BCP 47 locale tags with message catalogs (ADR-076). English keeps its regions; the other
 * languages have one catalog each, without a region. `pcm` (Nigerian Pidgin) is planned.
 */
export const SUPPORTED_LOCALES = ['en-NG', 'en-GB', 'en-US', 'fr', 'sw', 'ar', 'pt'] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: LocaleCode = 'en-NG';

export function isSupportedLocale(value: string): value is LocaleCode {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export type TextDirection = 'ltr' | 'rtl';

/** Arabic is written right to left; every other supported language left to right. */
export const localeDirection = (locale: string): TextDirection =>
  locale.split('-')[0]?.toLowerCase() === 'ar' ? 'rtl' : 'ltr';
