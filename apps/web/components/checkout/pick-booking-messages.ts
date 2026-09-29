import type { Messages } from '@suskii/i18n';

import type { BookingFlowMessages } from './checkout-messages';

export const pickBookingMessages = (messages: Messages): BookingFlowMessages => ({
  checkout: messages.checkout,
  booking: messages.booking,
  payment: messages.payment,
  results: messages.results,
  cabins: messages.cabins,
  common: messages.common,
});
