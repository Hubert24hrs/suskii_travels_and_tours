import type { TravellerCounts } from '@suskii/shared';

import type { PassengerPickerLabels } from '../components/passenger-picker';

export const passengerLabels: PassengerPickerLabels = {
  types: {
    adults: { title: 'Adults', description: '12 years and over' },
    children: { title: 'Children', description: 'Ages 2 to 11' },
    infants: { title: 'Infants', description: 'Under 2, on lap' },
  },
  increment: { adults: 'Add an adult', children: 'Add a child', infants: 'Add an infant' },
  decrement: { adults: 'Remove an adult', children: 'Remove a child', infants: 'Remove an infant' },
  done: 'Done',
  close: 'Close',
};

export const summarise = ({ adults, children, infants }: TravellerCounts): string =>
  `${adults} adults, ${children} children, ${infants} infants`;
