import { createFormatters, createTranslator, getMessages } from '@suskii/i18n';

/** The Intl APIs Hermes lacks and the app uses (through @suskii/i18n). */
const MISSING = ['PluralRules', 'RelativeTimeFormat', 'ListFormat', 'Locale'] as const;

describe('Intl polyfills', () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    for (const name of MISSING) {
      saved.set(name, Object.getOwnPropertyDescriptor(Intl, name));
      Reflect.deleteProperty(Intl, name);
    }
  });

  afterEach(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(Intl, name, descriptor);
    }
  });

  it('give an engine without them what the translator and formatters need', () => {
    expect(() => createTranslator(getMessages('en-NG'), 'en-NG')).toThrow();

    jest.isolateModules(() => {
      // Loaded after the APIs are removed, in a fresh module registry (static imports hoist).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./polyfills');
    });

    const { t } = createTranslator(getMessages('en-NG'), 'en-NG');
    expect(t('results.flights.count', { count: 1 })).toBe('1 flight');
    expect(t('results.flights.count', { count: 3 })).toBe('3 flights');
    const format = createFormatters('en-NG');
    expect(format.relativeTime('2026-09-30T10:00:00Z', new Date('2026-09-30T12:00:00Z'))).toBe(
      '2 hours ago',
    );
    expect(format.list(['Lagos', 'Abuja', 'Accra'])).toBe('Lagos, Abuja and Accra');
    expect(createFormatters('en-US').list(['Lagos', 'Abuja', 'Accra'])).toBe(
      'Lagos, Abuja, and Accra',
    );
  });
});
