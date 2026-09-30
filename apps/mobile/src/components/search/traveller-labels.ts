import type { Messages, Translator } from '@suskii/i18n';
import type { PassengerPickerLabels } from '@suskii/ui-native';
import type { TravellerCounts } from '@suskii/shared';

type T = Translator<Messages>['t'];

export function passengerLabels(t: T): PassengerPickerLabels {
  return {
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
  };
}

export function travellerSummary(t: T, counts: TravellerCounts): string {
  return [
    t('search.travellers.adultsCount', { count: counts.adults }),
    counts.children > 0 ? t('search.travellers.childrenCount', { count: counts.children }) : '',
    counts.infants > 0 ? t('search.travellers.infantsCount', { count: counts.infants }) : '',
  ]
    .filter(Boolean)
    .join(', ');
}
