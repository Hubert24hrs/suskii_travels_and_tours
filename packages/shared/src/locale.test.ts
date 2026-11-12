import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  acceptedLanguages,
  isSupportedLocale,
  localeCodeSchema,
  localeDirection,
  negotiateLocale,
} from './locale';

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
    expect(isSupportedLocale('fr')).toBe(true);
    expect(isSupportedLocale('fr-FR')).toBe(false);
    expect(localeCodeSchema.safeParse('en-us').success).toBe(false);
  });

  it('writes Arabic right to left and everything else left to right', () => {
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('ar-EG')).toBe('rtl');
    for (const locale of SUPPORTED_LOCALES.filter((code) => code !== 'ar')) {
      expect(localeDirection(locale)).toBe('ltr');
    }
  });
});

describe('negotiateLocale', () => {
  it('matches other languages by their language subtag', () => {
    expect(negotiateLocale(['fr-CI', 'en'])).toBe('fr');
    expect(negotiateLocale(['sw-KE'])).toBe('sw');
    expect(negotiateLocale(['ar-EG'])).toBe('ar');
    expect(negotiateLocale(['pt-AO'])).toBe('pt');
    expect(negotiateLocale(['PT-br'])).toBe('pt');
  });

  it('matches English regions exactly, else the default English', () => {
    expect(negotiateLocale(['en-GB'])).toBe('en-GB');
    expect(negotiateLocale(['en-us'])).toBe('en-US');
    expect(negotiateLocale(['en-KE'])).toBe('en-NG');
    expect(negotiateLocale(['en'])).toBe('en-NG');
  });

  it('takes the first language it has, in order of preference', () => {
    expect(negotiateLocale(['de-DE', 'zh', 'pt-MZ', 'fr'])).toBe('pt');
    expect(negotiateLocale(['*', '', 'ar'])).toBe('ar');
  });

  it('answers null when nothing matches', () => {
    expect(negotiateLocale([])).toBeNull();
    expect(negotiateLocale(['de', 'zh-CN'])).toBeNull();
  });
});

describe('acceptedLanguages', () => {
  it('orders tags by quality and keeps the header order for ties', () => {
    expect(acceptedLanguages('fr-CI,fr;q=0.9,en;q=0.8,ar;q=0.9')).toEqual([
      'fr-CI',
      'fr',
      'ar',
      'en',
    ]);
  });

  it('drops tags with zero or invalid quality and empty parts', () => {
    expect(acceptedLanguages('sw;q=0, pt , ,de;q=abc')).toEqual(['pt']);
    expect(acceptedLanguages(null)).toEqual([]);
    expect(acceptedLanguages('')).toEqual([]);
  });
});
