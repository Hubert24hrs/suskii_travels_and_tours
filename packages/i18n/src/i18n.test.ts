import { money } from '@suskii/shared';
import { describe, expect, it } from 'vitest';

import { createFormatters } from './format';
import { en } from './messages/en';
import { getMessages } from './messages';
import { createTranslator, mergeMessages } from './translator';

const leaves = (tree: object, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value] as [string, string]]
      : leaves(value as object, `${prefix}${key}.`),
  );

describe('translator', () => {
  const messages = {
    greeting: 'Hello {name}, you have {count} messages',
    hotels: { zero: 'No hotels', one: '{count} hotel', other: '{count} hotels' },
    nested: { deep: { value: 'Deep' } },
  } as const;
  const { t } = createTranslator(messages, 'en-NG');

  it('interpolates values and formats numbers for the locale', () => {
    expect(t('greeting', { name: 'Ada', count: 12_500 })).toBe(
      'Hello Ada, you have 12,500 messages',
    );
    expect(t('greeting')).toBe('Hello {name}, you have {count} messages');
    expect(t('nested.deep.value')).toBe('Deep');
  });

  it('selects plural forms, including an explicit zero', () => {
    expect(t('hotels', { count: 0 })).toBe('No hotels');
    expect(t('hotels', { count: 1 })).toBe('1 hotel');
    expect(t('hotels', { count: 248 })).toBe('248 hotels');
    expect(t('hotels')).toBe('{count} hotels');
  });

  it('returns the key for unknown entries instead of throwing', () => {
    expect(t('nested.missing' as never)).toBe('nested.missing');
    expect(t('nested' as never)).toBe('nested');
  });

  it('merges regional overlays without touching the base', () => {
    const merged = mergeMessages(messages, { nested: { deep: { value: 'Tief' } } });
    expect(merged.nested.deep.value).toBe('Tief');
    expect(merged.greeting).toBe(messages.greeting);
    expect(messages.nested.deep.value).toBe('Deep');
  });
});

describe('catalogs', () => {
  it('uses American spelling for en-US and falls back to en-NG', () => {
    expect(getMessages('en-US').search.travellers.label).toBe('Travelers');
    expect(getMessages('en-GB').search.travellers.label).toBe('Travellers');
    expect(getMessages('fr-FR')).toBe(getMessages('en-NG'));
  });

  it('keeps every locale on the same keys', () => {
    const baseKeys = leaves(en).map(([key]) => key);
    for (const locale of ['en-NG', 'en-GB', 'en-US']) {
      expect(leaves(getMessages(locale)).map(([key]) => key)).toEqual(baseKeys);
    }
  });

  it('never mentions a competitor brand or an unverified claim', () => {
    for (const locale of ['en-NG', 'en-US']) {
      for (const [key, value] of leaves(getMessages(locale))) {
        expect(value, key).not.toMatch(/wakanow/i);
        expect(value, key).not.toMatch(/\bIATA\b|million travell?ers/i);
      }
    }
  });
});

describe('formatters', () => {
  const format = createFormatters('en-NG');
  const now = new Date('2026-10-01T12:00:00Z');

  it('formats money exactly and rounds headline prices up', () => {
    expect(format.money(money(45_000_000n, 'NGN'))).toBe('₦450,000');
    expect(format.money({ amountMinor: 12_345, currency: 'USD' })).toBe('US$123.45');
    expect(format.moneyFrom(money(45_000_001n, 'NGN'))).toBe('₦450,001');
    expect(format.moneyFrom(money(45_000_000n, 'NGN'))).toBe('₦450,000');
    expect(createFormatters('en-US').moneyFrom({ amountMinor: 1_050, currency: 'JPY' })).toBe(
      '¥1,050',
    );
  });

  it('formats calendar dates without shifting across time zones', () => {
    expect(format.date('2026-12-10')).toBe('10 Dec 2026');
    expect(format.date('2026-12-10', 'weekday')).toBe('Thu, 10 Dec');
    expect(createFormatters('en-US').date('2026-12-10')).toBe('Dec 10, 2026');
    expect(format.dateRange('2026-12-10', '2026-12-17')).toBe('10–17 Dec');
  });

  it('describes how long ago a fare was checked', () => {
    expect(format.relativeTime('2026-10-01T10:00:00Z', now)).toBe('2 hours ago');
    expect(format.relativeTime('2026-09-30T12:00:00Z', now)).toBe('yesterday');
    expect(format.relativeTime('2026-10-01T11:59:40Z', now)).toBe('this minute');
  });

  it('formats numbers and lists', () => {
    expect(format.number(1_234_567)).toBe('1,234,567');
    expect(format.list(['Lagos', 'Abuja', 'Accra'])).toBe('Lagos, Abuja and Accra');
  });
});
