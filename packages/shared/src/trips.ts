/**
 * Combined trips (ADR-099): a traveller puts a flight, a hotel, a car, an airport transfer and
 * travel insurance together, or any of them, and pays once. Each part stays an ordinary booking;
 * this module names the parts and the plan a trip starts from. Zod-free, so every client can
 * import it.
 */

/** The parts a trip can have, in the order a traveller adds them. */
export const TRIP_COMPONENTS = ['flight', 'hotel', 'car', 'transfer', 'insurance'] as const;
export type TripComponent = (typeof TRIP_COMPONENTS)[number];

/** A trip stay as long as the longest hotel stay we search. */
export const TRIP_MAX_NIGHTS = 30;
export const TRIP_MAX_ADULTS = 9;
export const TRIP_MAX_CHILDREN = 8;
/** Open trips one account may have at a time. */
export const TRIP_MAX_OPEN = 10;

/** Where a trip leaves from: an airport. */
export interface TripPlace {
  /** IATA airport code, for the flight search. */
  code: string;
  /** The airport's name as the traveller chose it. */
  name: string;
  cityName: string | null;
  countryCode: string;
}

/** Where a trip goes: the airport, and its city for the hotel and the car. */
export interface TripDestination extends TripPlace {
  /** The catalog city, for the hotel search; null when the airport has none. */
  cityId: string | null;
}

/** What the traveller asked for. No personal data: places, dates and head counts. */
export interface TripPlan {
  origin: TripPlace;
  destination: TripDestination;
  /** ISO dates: the day out and the day back. */
  departDate: string;
  returnDate: string;
  adults: number;
  children: number;
  /** The parts wanted; a traveller may want only one or two. */
  components: TripComponent[];
}

/**
 * Which part of a trip a booking is, from what it sells: a flight, a hotel stay, a rental car,
 * an airport transfer or travel insurance. Null for anything else (tours, visas, bus tickets,
 * rides, memberships, other add-ons), which a trip does not take.
 */
export function tripComponentOf(item: {
  kind: string;
  /** The add-on's product type, for `kind: 'addon'`. */
  addonType?: string | null;
}): TripComponent | null {
  switch (item.kind) {
    case 'flight':
      return 'flight';
    case 'hotel':
      return 'hotel';
    case 'rental':
      return 'car';
    case 'addon':
      return item.addonType === 'airport_transfer'
        ? 'transfer'
        : item.addonType === 'insurance'
          ? 'insurance'
          : null;
    default:
      return null;
  }
}

/** "Lagos to London": a trip's name from its plan, for lists and the provider's page. */
export function tripTitle(plan: Pick<TripPlan, 'origin' | 'destination'>): {
  from: string;
  to: string;
} {
  return {
    from: plan.origin.cityName ?? plan.origin.name,
    to: plan.destination.cityName ?? plan.destination.name,
  };
}

/** Where a trip stands, from its parts: nothing added, to pay, paid, or closed. */
export const TRIP_STATES = ['empty', 'open', 'awaiting_payment', 'paid', 'closed'] as const;
export type TripState = (typeof TRIP_STATES)[number];

/** How a part of a trip stands for the traveller, from its booking's status. */
export const TRIP_PART_STATES = ['to_pay', 'paying', 'paid', 'confirmed', 'closed'] as const;
export type TripPartState = (typeof TRIP_PART_STATES)[number];

/** A booking's status as a trip shows it. */
export function tripPartState(bookingStatus: string): TripPartState {
  switch (bookingStatus) {
    case 'DRAFT':
    case 'PRICED':
    case 'HELD':
      return 'to_pay';
    case 'AWAITING_PAYMENT':
    case 'PARTIALLY_PAID':
      return 'paying';
    case 'PAID':
    case 'TICKETING':
      return 'paid';
    case 'CONFIRMED':
      return 'confirmed';
    default:
      // Cancelled, expired, failed, refunded or being refunded: no longer part of the total.
      return 'closed';
  }
}

/** A trip's state from its parts' states. */
export function tripState(parts: readonly TripPartState[]): TripState {
  const live = parts.filter((part) => part !== 'closed');
  if (parts.length === 0) return 'empty';
  if (live.length === 0) return 'closed';
  if (live.every((part) => part === 'paid' || part === 'confirmed')) return 'paid';
  if (live.some((part) => part === 'paying')) return 'awaiting_payment';
  return 'open';
}
