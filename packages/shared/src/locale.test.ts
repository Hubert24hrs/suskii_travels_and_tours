import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale, localeCodeSchema } from './locale';

describe('locale', () => {
  it('defaults to en-NG, which is in the supported list', () => {
    expect(DEFAULT_LOCALE).toBe('en-NG');
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('only lists locales that Intl can canonicalise unchanged', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Intl.getCanonicalLocales(locale)).toEqual([locale]);
    }
  });

  it('narrows supported locales and rejects everything else', () => {
    expect(isSupportedLocale('en-GB')).toBe(true);
    expect(isSupportedLocale('fr-FR')).toBe(false);
    expect(localeCodeSchema.safeParse('en-us').success).toBe(false);
  });
});
