import type { Messages } from '@suskii/i18n';

/** The catalog subset the date picker needs on the client (plain module: servers call it). */
export type BookDepartureMessages = Record<'inhouse', Pick<Messages['inhouse'], 'book'>> &
  Record<'search', Pick<Messages['search'], 'travellers'>>;

export const pickBookDepartureMessages = (messages: Messages): BookDepartureMessages => ({
  inhouse: { book: messages.inhouse.book },
  search: { travellers: messages.search.travellers },
});
