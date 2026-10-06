import { createFormatters, createTranslator, type MessageKey } from '@suskii/i18n';
import { adminMessages, type AdminMessages } from '@suskii/i18n/admin';
import { DEFAULT_LOCALE } from '@suskii/shared/lite';

/**
 * The console's copy and formatters. The console is English only (en-NG formatting), so one
 * translator serves every component without a provider.
 */
const translator = createTranslator<AdminMessages>(adminMessages, DEFAULT_LOCALE);

export type AdminKey = MessageKey<AdminMessages>;
export const t = translator.t;
export const format = createFormatters(DEFAULT_LOCALE);

/**
 * A label looked up by an API value (`label('refunds.statuses', 'needs_review')`); the value
 * itself when the catalog has no entry, so a new enum value still renders.
 */
export function label(group: string, value: string): string {
  const key = `${group}.${value}`;
  const text = t(key as AdminKey);
  return text === key ? value : text;
}
