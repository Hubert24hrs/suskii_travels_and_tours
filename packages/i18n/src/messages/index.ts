import { DEFAULT_LOCALE, isSupportedLocale, type LocaleCode } from '@suskii/shared/lite';

import { mergeMessages } from '../translator';

import { en } from './en';
import { enUS } from './en-US';

type Widen<T> = T extends string ? string : { readonly [K in keyof T]: Widen<T[K]> };

/** Catalog shape: every locale provides the same keys (string values, not literals). */
export type Messages = Widen<typeof en>;

const catalogs: Record<LocaleCode, Messages> = {
  'en-NG': en,
  'en-GB': en,
  'en-US': mergeMessages<Messages>(en, enUS),
};

/** Messages for a supported locale; anything else falls back to the default (en-NG). */
export function getMessages(locale: string): Messages {
  return catalogs[isSupportedLocale(locale) ? locale : DEFAULT_LOCALE];
}
