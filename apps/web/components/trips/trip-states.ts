import type { TripPartState, TripState } from '@suskii/shared/lite';
import type { BadgeProps } from '@suskii/ui-web';

type Variant = NonNullable<BadgeProps['variant']>;

/** Badge colours for a trip and for one of its parts. */
export const TRIP_STATE_VARIANT: Record<TripState, Variant> = {
  empty: 'neutral',
  open: 'info',
  awaiting_payment: 'warning',
  paid: 'success',
  closed: 'neutral',
};

export const TRIP_PART_VARIANT: Record<TripPartState, Variant> = {
  to_pay: 'info',
  paying: 'warning',
  paid: 'success',
  confirmed: 'success',
  closed: 'neutral',
};
