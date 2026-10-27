import { label } from '../../lib/i18n';
import type { SelectOption } from '../ui';

/** Booking verticals as the API names them, for pricing, promo and tax forms. */
export const VERTICALS = [
  'flights',
  'hotels',
  'packages',
  'tours',
  'visa',
  'travel_addons',
  'prime',
  'buses',
  'rides',
  'rentals',
] as const;
export type Vertical = (typeof VERTICALS)[number];

export const verticalOptions: SelectOption[] = VERTICALS.map((vertical) => ({
  value: vertical,
  label: label('verticals', vertical),
}));
