import type { Messages } from '@suskii/i18n';

/** The catalog subset the visa application page needs on the client (plain module). */
export type VisaApplicationMessages = Record<'visa', Pick<Messages['visa'], 'application'>> &
  Record<'booking', Pick<Messages['booking'], 'inhouse' | 'notFound'>>;

export const pickVisaApplicationMessages = (messages: Messages): VisaApplicationMessages => ({
  visa: { application: messages.visa.application },
  booking: { inhouse: messages.booking.inhouse, notFound: messages.booking.notFound },
});
