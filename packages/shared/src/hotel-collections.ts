/**
 * Ways into a hotel search (ADR-097): fixed, explainable rules over what the supplier tells us
 * about a property, never a model's opinion. `deals` compares a hotel with the others of its
 * star class in the same search.
 */
export const HOTEL_COLLECTIONS = ['deals', 'family', 'luxury', 'honeymoon', 'long_stay'] as const;
export type HotelCollection = (typeof HOTEL_COLLECTIONS)[number];

/** A deal is at least this far below the usual price of its star class in the search. */
export const DEAL_MIN_PERCENT = 15;
/** Fewer hotels than this in a star class is too few to say what is usual. */
export const DEAL_MIN_CLASS_SIZE = 5;
/** A cheap hotel that guests rate poorly is not offered as a deal. */
export const DEAL_MIN_SCORE = 7;

/** What the rules read of a hotel. */
export interface CollectionHotel {
  stars: number;
  /** The supplier's review score out of 10; null when it has none. */
  reviewScore: number | null;
  propertyType: string | null;
  amenities: readonly string[];
  /** The most guests any of its rooms sleeps; null when the supplier does not say. */
  maxRoomGuests: number | null;
  roomNames: readonly string[];
  /** Percent below the usual price of its class (`dealPercent`); null when not known. */
  dealPercent: number | null;
}

const LONG_STAY_TYPES = ['apartment', 'villa'];
const LONG_STAY_AMENITIES = ['kitchen', 'kitchenette', 'laundry', 'washing_machine'];

/** The middle value of a list of minor-unit amounts; null for an empty list. */
export function medianMinor(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0n;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2n;
}

/**
 * How far below the usual (median) price of its star class a hotel is, in whole percent, or
 * null when the class is too small to say, the hotel is not below it, or guests rate it under
 * `DEAL_MIN_SCORE`. `classPrices` are the cheapest totals of every hotel of the class in the
 * search, this one included.
 */
export function dealPercent(
  price: bigint,
  classPrices: readonly bigint[],
  reviewScore: number | null,
): number | null {
  if (classPrices.length < DEAL_MIN_CLASS_SIZE) return null;
  if (reviewScore !== null && reviewScore < DEAL_MIN_SCORE) return null;
  const usual = medianMinor(classPrices);
  if (usual === null || usual <= 0n || price >= usual) return null;
  const percent = Number(((usual - price) * 100n) / usual);
  return percent >= DEAL_MIN_PERCENT ? percent : null;
}

/** The collections a hotel belongs to, in `HOTEL_COLLECTIONS` order. */
export function hotelCollections(hotel: CollectionHotel): HotelCollection[] {
  const score = hotel.reviewScore ?? 0;
  const has = (amenity: string): boolean => hotel.amenities.includes(amenity);
  const rules: Record<HotelCollection, boolean> = {
    deals: hotel.dealPercent !== null && hotel.dealPercent >= DEAL_MIN_PERCENT,
    // A room for three or more, or one the hotel itself calls a family room.
    family:
      (hotel.maxRoomGuests ?? 0) >= 3 || hotel.roomNames.some((name) => /\bfamily\b/i.test(name)),
    luxury: hotel.stars >= 5 || (hotel.stars === 4 && score >= 9),
    honeymoon: hotel.stars >= 4 && score >= 8 && (has('spa') || has('pool')),
    long_stay:
      (hotel.propertyType !== null && LONG_STAY_TYPES.includes(hotel.propertyType)) ||
      LONG_STAY_AMENITIES.some(has),
  };
  return HOTEL_COLLECTIONS.filter((collection) => rules[collection]);
}
