import type { Locale } from 'expo-localization';

import { deviceLocale } from './app-provider';

// The module object the app reads (an `import * as` copy would not reach it).
const localization = jest.requireMock<{ getLocales: () => Locale[] }>('expo-localization');

const languages = (...tags: string[]) =>
  jest
    .spyOn(localization, 'getLocales')
    .mockReturnValue(tags.map((languageTag) => ({ languageTag }) as Locale));

describe('deviceLocale (ADR-076)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('takes the first device language the app has, by language', () => {
    languages('fr-CI', 'en-GB');
    expect(deviceLocale()).toBe('fr');
    languages('de-DE', 'ar-EG');
    expect(deviceLocale()).toBe('ar');
    languages('sw-KE');
    expect(deviceLocale()).toBe('sw');
    languages('pt-AO');
    expect(deviceLocale()).toBe('pt');
  });

  it('keeps English regions and falls back to Nigerian English', () => {
    languages('en-GB');
    expect(deviceLocale()).toBe('en-GB');
    languages('en-KE');
    expect(deviceLocale()).toBe('en-NG');
    languages('de-DE', 'zh-CN');
    expect(deviceLocale()).toBe('en-NG');
  });
});
