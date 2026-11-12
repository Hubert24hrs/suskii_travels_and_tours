import type { Messages } from '@suskii/i18n';

import { pickBookingMessages } from '../checkout/pick-booking-messages';
import { pickSearchMessages } from '../search/search-messages';

import type { TripPageMessages, TripPlannerMessages } from './trip-messages';

export const pickPlannerMessages = (messages: Messages): TripPlannerMessages => ({
  ...pickSearchMessages(messages),
  trips: messages.trips,
});

export const pickTripMessages = (messages: Messages): TripPageMessages => ({
  ...pickBookingMessages(messages),
  trips: messages.trips,
});
