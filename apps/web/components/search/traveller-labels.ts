'use client';

import type { PassengerPickerLabels } from '@suskii/ui-web';
import type { TravellerCounts } from '@suskii/shared';

import { useSearchT } from './use-search-t';

/** Localised labels and the summary line for the traveller picker. */
export function useTravellerLabels(): {
  labels: PassengerPickerLabels;
  summary: (counts: TravellerCounts) => string;
} {
  const { t } = useSearchT();
  return {
    labels: {
      types: {
        adults: {
          title: t('search.travellers.adults'),
          description: t('search.travellers.adultsHint'),
        },
        children: {
          title: t('search.travellers.children'),
          description: t('search.travellers.childrenHint'),
        },
        infants: {
          title: t('search.travellers.infants'),
          description: t('search.travellers.infantsHint'),
        },
      },
      increment: {
        adults: t('search.travellers.addAdult'),
        children: t('search.travellers.addChild'),
        infants: t('search.travellers.addInfant'),
      },
      decrement: {
        adults: t('search.travellers.removeAdult'),
        children: t('search.travellers.removeChild'),
        infants: t('search.travellers.removeInfant'),
      },
      done: t('search.travellers.done'),
      close: t('search.travellers.close'),
    },
    summary: ({ adults, children, infants }) =>
      [
        t('search.travellers.adultsCount', { count: adults }),
        children > 0 ? t('search.travellers.childrenCount', { count: children }) : null,
        infants > 0 ? t('search.travellers.infantsCount', { count: infants }) : null,
      ]
        .filter((part): part is string => part !== null)
        .join(', '),
  };
}
