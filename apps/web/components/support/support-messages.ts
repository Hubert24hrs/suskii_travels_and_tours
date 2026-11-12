import type { Messages } from '@suskii/i18n';

/** Catalog namespaces the support widgets need on the client (ADR-083). */
export type SupportMessages = Pick<Messages, 'support'>;

/** Server pages pass this subset to `I18nProvider` (never the whole catalog). */
export const pickSupportMessages = (messages: Messages): SupportMessages => ({
  support: messages.support,
});
