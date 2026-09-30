import { createFormatters, createTranslator, getMessages, type Messages } from '@suskii/i18n';
import { cache } from 'react';

import { getPreferences } from './preferences';

/** Translator, formatters and preferences for the current request (server components). */
export const getI18n = cache(async () => {
  const { locale, currency } = await getPreferences();
  const messages = getMessages(locale);
  const { t } = createTranslator<Messages>(messages, locale);
  return { locale, currency, messages, t, format: createFormatters(locale) };
});

export type I18n = Awaited<ReturnType<typeof getI18n>>;

/** The catalog subset the root layout provides to the error boundary (app/error.tsx). */
export type ErrorMessages = Record<'pages', Pick<Messages['pages'], 'error'>>;
