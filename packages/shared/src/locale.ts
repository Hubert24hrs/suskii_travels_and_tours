import * as z from 'zod';

import { SUPPORTED_LOCALES } from './locale-codes';

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type LocaleCode,
} from './locale-codes';

export const localeCodeSchema = z.enum(SUPPORTED_LOCALES);
