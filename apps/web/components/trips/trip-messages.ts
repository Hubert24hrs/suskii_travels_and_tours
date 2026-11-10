'use client';

import type { Messages } from '@suskii/i18n';
import { useTranslator } from '@suskii/i18n/react';

import type { BookingFlowMessages } from '../checkout/checkout-messages';
import type { SearchMessages } from '../search/search-messages';

/** What the trip plan form needs: its own strings and the search fields it reuses. */
export type TripPlannerMessages = SearchMessages & Pick<Messages, 'trips'>;

/** What a trip's page needs: its own strings and the payment method names of checkout. */
export type TripPageMessages = BookingFlowMessages & Pick<Messages, 'trips'>;

export const usePlannerT = () => useTranslator<TripPlannerMessages>();
export const useTripT = () => useTranslator<TripPageMessages>();
