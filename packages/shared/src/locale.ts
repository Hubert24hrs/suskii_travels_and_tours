import { z } from './zod-setup';

import { SUPPORTED_LOCALES } from './locale-codes';

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  localeDirection,
  type LocaleCode,
  type TextDirection,
} from './locale-codes';
export { acceptedLanguages, negotiateLocale } from './locale-negotiation';

export const localeCodeSchema = z.enum(SUPPORTED_LOCALES);
