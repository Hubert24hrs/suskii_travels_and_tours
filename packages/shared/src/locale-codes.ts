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

/**
 * The best supported locale for a list of preferred language tags, most preferred first (the
 * browser's `Accept-Language`, the device's languages). English regions match exactly or fall
 * back to the default; any other language matches by its language subtag (`fr-CI` is `fr`).
 * Returns null when nothing matches, so the caller can apply its own default.
 */
export function negotiateLocale(preferred: readonly string[]): LocaleCode | null {
  for (const raw of preferred) {
    const tag = raw.trim();
    if (!tag || tag === '*') continue;
    const exact = SUPPORTED_LOCALES.find((code) => code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const language = tag.split('-')[0]?.toLowerCase() ?? '';
    if (language === 'en') return DEFAULT_LOCALE;
    const match = SUPPORTED_LOCALES.find((code) => code === language);
    if (match) return match;
  }
  return null;
}

/** Language tags from an `Accept-Language` header, highest quality first (ties keep order). */
export function acceptedLanguages(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.tag !== '' && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((entry) => entry.tag);
}
