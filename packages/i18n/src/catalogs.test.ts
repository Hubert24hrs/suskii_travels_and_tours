import { SUPPORTED_LOCALES } from '@suskii/shared/lite';
import { describe, expect, it } from 'vitest';

import { LOCALE_NAMES } from './locale-names';
import { getMessages } from './messages';
import { en } from './messages/en';

type Leaf = string | Readonly<Record<string, string>>;

/** Every leaf of a catalog by dot path; plural leaves stay objects. */
function leaves(tree: unknown, prefix = ''): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else if (
      value &&
      typeof value === 'object' &&
      typeof (value as { other?: unknown }).other === 'string'
    )
      out.set(path, value as Record<string, string>);
    else for (const [p, l] of leaves(value, path)) out.set(p, l);
  }
  return out;
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

/** Plural forms each translation must give; other forms fall back to `other`. */
const REQUIRED_FORMS: Record<string, readonly string[]> = {
  fr: ['one', 'other'],
  sw: ['one', 'other'],
  pt: ['one', 'other'],
  ar: ['one', 'two', 'few', 'many', 'other'],
};

/**
 * Strings that read the same in a language as in English: brand and product names, codes and
 * words the language shares. Anything else identical to the English is a string left untranslated.
 */
const SAME_AS_ENGLISH: Record<string, ReadonlySet<string>> = {
  fr: new Set([
    'Visa',
    'Menu',
    'Marketing',
    '15 minutes',
    'Destination',
    'Dates',
    'Date',
    'Minimum',
    'Maximum',
    'Transit',
    'Direct',
    'Restaurant',
    'Bar',
    'Spa',
    'Parking',
    'via {airports}',
    'Dr',
    'Distance',
    'Total',
    'Mobile money',
    'Version {version}',
    'Code',
    'Documents',
    'Selfie',
    '{count} date',
    '{count} dates',
    'Standard',
    'Contact {number}',
    'Notifications',
    '{hours} h',
  ]),
  sw: new Set(['Spa']),
  pt: new Set([
    '{count} hotel',
    'Menu',
    'Marketing',
    'Bar',
    'Spa',
    'via {airports}',
    'Total',
    'Selfie',
    'Snacks',
    'Manual',
    'App',
    '{hours} h',
  ]),
  ar: new Set(['you@example.com']),
};

/** True when a string has no words of its own: placeholders, numbers, symbols and brand names. */
const wordless = (text: string): boolean =>
  text
    .replace(/\{\w+\}|%s/g, '')
    .replace(
      /\b(Suskii Prime|Suskii|Prime|SMS|SUSKII T&T|WhatsApp|Google Play|App Store|Apple Pay|Google Pay|Google|Apple|Cloudflare|Meta|Facebook|Instagram|TikTok|iOS|Android|eSIM|USSD|PDF|JPEG|JPG|PNG|NIN|PIN|SOS|SUV|XL|USB|Wi-Fi|QR|LOS|DELETE)\b/g,
      '',
    )
    .replace(/[\s\p{P}\p{S}\d]/gu, '') === '';

const english = leaves(en);
const translations = SUPPORTED_LOCALES.filter((code) => !code.startsWith('en-'));

describe('translated catalogs', () => {
  it.each(translations)('%s keeps every English placeholder', (locale) => {
    const problems: string[] = [];
    for (const [path, leaf] of leaves(getMessages(locale))) {
      const source = english.get(path);
      if (source === undefined) continue;
      if (typeof leaf === 'string' && typeof source === 'string') {
        if (placeholders(leaf).join() !== placeholders(source).join()) problems.push(path);
      } else if (typeof leaf === 'object' && typeof source === 'object') {
        const allowed = new Set([
          ...placeholders(source.other ?? ''),
          ...placeholders(source.one ?? ''),
        ]);
        if (placeholders(leaf.other ?? '').join() !== placeholders(source.other ?? '').join())
          problems.push(`${path}.other`);
        for (const [form, text] of Object.entries(leaf))
          if (placeholders(text).some((name) => !allowed.has(name)))
            problems.push(`${path}.${form}`);
      } else {
        problems.push(`${path} (plural mismatch)`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(translations)('%s gives the plural forms its language needs', (locale) => {
    const missing: string[] = [];
    for (const [path, leaf] of leaves(getMessages(locale))) {
      if (typeof leaf !== 'object') continue;
      for (const form of REQUIRED_FORMS[locale] ?? ['other'])
        if (!(form in leaf)) missing.push(`${path}.${form}`);
    }
    expect(missing).toEqual([]);
  });

  it.each(translations)('%s leaves no English string in place', (locale) => {
    const same: string[] = [];
    for (const [path, leaf] of leaves(getMessages(locale))) {
      const source = english.get(path);
      const pairs: [string, string | undefined][] =
        typeof leaf === 'string'
          ? [[leaf, typeof source === 'string' ? source : undefined]]
          : Object.entries(leaf).map(([form, text]) => [
              text,
              typeof source === 'object' ? source[form] : undefined,
            ]);
      for (const [text, original] of pairs)
        if (text === original && !wordless(text) && !SAME_AS_ENGLISH[locale]?.has(text))
          same.push(`${path}: ${text}`);
    }
    expect(same).toEqual([]);
  });

  it('names every language in its own language', () => {
    expect(Object.keys(LOCALE_NAMES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(LOCALE_NAMES.ar).toBe('العربية');
  });
});
