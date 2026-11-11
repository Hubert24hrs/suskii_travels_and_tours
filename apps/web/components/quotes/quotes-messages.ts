import type { Messages } from '@suskii/i18n';

/** Catalog namespaces the price request pages need on the client (ADR-104). */
export type QuotesMessages = Pick<Messages, 'quotes'>;

/** Server pages pass this subset to `I18nProvider` (never the whole catalog). */
export const pickQuotesMessages = (messages: Messages): QuotesMessages => ({
  quotes: messages.quotes,
});
