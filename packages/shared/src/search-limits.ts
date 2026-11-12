/** Search limits and codes (Zod-free; the schemas live in search.ts). */

export const CABIN_CLASSES = ['economy', 'premium_economy', 'business', 'first'] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const TRIP_TYPES = ['round_trip', 'one_way', 'multi_city'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const MAX_FLIGHT_SLICES = 5;
export const MIN_MULTI_CITY_LEGS = 2;
/** Airlines sell about 330-361 days ahead. */
export const MAX_ADVANCE_DAYS = 361;

export const MAX_HOTEL_ROOMS = 8;
export const MAX_ADULTS_PER_ROOM = 6;
export const MAX_CHILDREN_PER_ROOM = 4;
export const MAX_CHILD_AGE = 17;
export const MAX_STAY_NIGHTS = 30;

/** Machine-readable issue codes; apps map them to localised messages. */
export const SEARCH_ISSUES = {
  sameOriginDestination: 'same_origin_destination',
  legsNotChronological: 'legs_not_chronological',
  returnBeforeDeparture: 'return_before_departure',
  dateInPast: 'date_in_past',
  dateTooFar: 'date_too_far',
  checkOutNotAfterCheckIn: 'check_out_not_after_check_in',
  stayTooLong: 'stay_too_long',
} as const;
