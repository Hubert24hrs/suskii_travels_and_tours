import type { Messages } from '@suskii/i18n';

/** The catalog namespaces the client-side search module needs (the rest stays on the server). */
export type SearchMessages = Pick<Messages, 'search' | 'cabins' | 'common'>;

export const pickSearchMessages = (messages: Messages): SearchMessages => ({
  search: messages.search,
  cabins: messages.cabins,
  common: messages.common,
});
