import type { Messages } from '@suskii/i18n';

/**
 * Catalog namespaces the group request form needs on the client: its own copy, the airport
 * fields and date picker of the search forms, and the support errors.
 */
export type GroupRequestMessages = Pick<
  Messages,
  'groups' | 'search' | 'cabins' | 'common' | 'support'
>;

/** Server pages pass this subset to `I18nProvider` (never the whole catalog). */
export const pickGroupRequestMessages = (messages: Messages): GroupRequestMessages => ({
  groups: messages.groups,
  search: messages.search,
  cabins: messages.cabins,
  common: messages.common,
  support: messages.support,
});
