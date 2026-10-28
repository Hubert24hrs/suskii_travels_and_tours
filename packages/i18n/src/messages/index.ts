import { DEFAULT_LOCALE, isSupportedLocale, type LocaleCode } from '@suskii/shared/lite';

import { mergeMessages, type PluralMessage } from '../translator';

import { ar } from './ar';
import { en } from './en';
import { enUS } from './en-US';
import { fr } from './fr';
import { pt } from './pt';
import { sw } from './sw';

type Widen<T> = T extends string
  ? string
  : T extends { readonly other: string }
    ? PluralMessage
    : { readonly [K in keyof T]: Widen<T[K]> };

/**
 * Catalog shape: every locale provides the same keys (string values, not literals). Plural leaves
 * take the forms their language needs (Arabic: zero, one, two, few, many, other).
 */
export type Messages = Widen<typeof en>;

const catalogs: Record<LocaleCode, Messages> = {
  'en-NG': en,
  'en-GB': en,
  'en-US': mergeMessages<Messages>(en, enUS),
  fr,
  sw,
  ar,
  pt,
};

/** Messages for a supported locale; anything else falls back to the default (en-NG). */
export function getMessages(locale: string): Messages {
  return catalogs[isSupportedLocale(locale) ? locale : DEFAULT_LOCALE];
}
