import type { Messages } from '@suskii/i18n';

/** The catalog subset the visa booking widget needs on the client (plain module). */
export type BookVisaMessages = Record<'visa', Pick<Messages['visa'], 'book'>> &
  Record<'search', Pick<Messages['search'], 'travellers'>>;

export const pickBookVisaMessages = (messages: Messages): BookVisaMessages => ({
  visa: { book: messages.visa.book },
  search: { travellers: messages.search.travellers },
});
