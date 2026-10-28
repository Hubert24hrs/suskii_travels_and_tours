import type { LocaleCode } from '@suskii/shared/lite';

/**
 * Each language in its own language and script, for language pickers (ADR-076): a traveller who
 * does not read the current language can still find theirs. Render each with `lang={code}`.
 */
export const LOCALE_NAMES: Readonly<Record<LocaleCode, string>> = {
  'en-NG': 'English (Nigeria)',
  'en-GB': 'English (UK)',
  'en-US': 'English (US)',
  fr: 'Français',
  sw: 'Kiswahili',
  ar: 'العربية',
  pt: 'Português',
};
