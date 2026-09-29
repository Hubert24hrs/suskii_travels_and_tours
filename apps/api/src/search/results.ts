import { compare, maxOf, minOf, type Money } from '@suskii/shared';

import type { PriceBreakdown } from '../pricing/pricing-engine';
import type {
  BoardType,
  SupplierFlightOffer,
  SupplierHotel,
  SupplierHotelRate,
} from '../suppliers/supplier.types';

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export function paginate<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
): { page: T[]; nextCursor: string | null } {
  const offset = cursor
    ? Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10)
    : 0;
  const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const page = items.slice(start, start + limit);
  const next = start + limit;
  return {
    page,
    nextCursor: next < items.length ? Buffer.from(String(next)).toString('base64url') : null,
  };
}

const range = (amounts: Money[]): { min: Money; max: Money } | null => {
  const [first, ...rest] = amounts;
  if (!first) return null;
  return { min: rest.reduce(minOf, first), max: rest.reduce(maxOf, first) };
};

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

export interface PricedFlight {
  id: string;
  offer: SupplierFlightOffer;
  price: PriceBreakdown;
}

export type DepartureWindow = 'night' | 'morning' | 'afternoon' | 'evening';
export type FlightSort = 'best' | 'cheapest' | 'fastest' | 'earliest';

export interface FlightFilters {
  stops?: string[] | undefined;
  airlines?: string[] | undefined;
  maxPrice?: number | undefined;
  maxDurationMinutes?: number | undefined;
  departureWindows?: string[] | undefined;
  refundable?: boolean | undefined;
  checkedBag?: boolean | undefined;
}

export function departureWindow(localDateTime: string): DepartureWindow {
  const hour = Number(localDateTime.slice(11, 13));
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** Stops bucket for an offer: its worst slice, capped at 2 ("2+"). */
export const stopsBucket = (offer: SupplierFlightOffer): number =>
  Math.min(2, Math.max(...offer.slices.map((slice) => slice.stops)));
export const totalDuration = (offer: SupplierFlightOffer): number =>
  offer.slices.reduce((acc, slice) => acc + slice.durationMinutes, 0);
const firstDeparture = (offer: SupplierFlightOffer): string => offer.slices[0]?.departureUtc ?? '';
const firstDepartureLocal = (offer: SupplierFlightOffer): string =>
  offer.slices[0]?.departureLocal ?? '';

export function filterFlights(
  items: readonly PricedFlight[],
  filters: FlightFilters,
): PricedFlight[] {
  return items.filter(({ offer, price }) => {
    if (filters.stops && !filters.stops.includes(String(stopsBucket(offer)))) return false;
    if (filters.airlines && !filters.airlines.includes(offer.owner.code)) return false;
    if (filters.maxPrice !== undefined && price.total.minor > BigInt(filters.maxPrice))
      return false;
    if (
      filters.maxDurationMinutes !== undefined &&
      offer.slices.some((slice) => slice.durationMinutes > (filters.maxDurationMinutes ?? 0))
    )
      return false;
    if (
      filters.departureWindows &&
      !filters.departureWindows.includes(departureWindow(firstDepartureLocal(offer)))
    )
      return false;
    if (filters.refundable !== undefined && offer.conditions.refundable !== filters.refundable)
      return false;
    if (filters.checkedBag !== undefined && offer.baggage.checked >= 1 !== filters.checkedBag)
      return false;
    return true;
  });
}

/**
 * "Best" balances price (60%), total duration (30%) and stops (10%), each relative to the best
 * value in the result set. Ties fall back to price, then departure time, then id.
 */
export function sortFlights(items: readonly PricedFlight[], sort: FlightSort): PricedFlight[] {
  const minPrice = Math.max(1, Math.min(...items.map((item) => Number(item.price.total.minor))));
  const minDuration = Math.max(1, Math.min(...items.map((item) => totalDuration(item.offer))));
  const score = (item: PricedFlight): number =>
    0.6 * (Number(item.price.total.minor) / minPrice) +
    0.3 * (totalDuration(item.offer) / minDuration) +
    0.1 * stopsBucket(item.offer);
  const byPrice = (a: PricedFlight, b: PricedFlight) => compare(a.price.total, b.price.total);
  const tieBreak = (a: PricedFlight, b: PricedFlight) =>
    byPrice(a, b) ||
    firstDeparture(a.offer).localeCompare(firstDeparture(b.offer)) ||
    a.id.localeCompare(b.id);
  const comparators: Record<FlightSort, (a: PricedFlight, b: PricedFlight) => number> = {
    best: (a, b) => score(a) - score(b) || tieBreak(a, b),
    cheapest: tieBreak,
    fastest: (a, b) => totalDuration(a.offer) - totalDuration(b.offer) || tieBreak(a, b),
    earliest: (a, b) =>
      firstDeparture(a.offer).localeCompare(firstDeparture(b.offer)) || tieBreak(a, b),
  };
  return [...items].sort(comparators[sort]);
}

export function flightFacets(items: readonly PricedFlight[]) {
  const airlines = new Map<
    string,
    { code: string; name: string; count: number; minPrice: Money }
  >();
  const stops = new Map<number, { stops: number; count: number; minPrice: Money }>();
  const windows = new Map<DepartureWindow, number>();
  for (const { offer, price } of items) {
    const airline = airlines.get(offer.owner.code);
    if (airline) {
      airline.count += 1;
      airline.minPrice = minOf(airline.minPrice, price.total);
    } else {
      airlines.set(offer.owner.code, {
        code: offer.owner.code,
        name: offer.owner.name,
        count: 1,
        minPrice: price.total,
      });
    }
    const bucket = stopsBucket(offer);
    const stop = stops.get(bucket);
    if (stop) {
      stop.count += 1;
      stop.minPrice = minOf(stop.minPrice, price.total);
    } else {
      stops.set(bucket, { stops: bucket, count: 1, minPrice: price.total });
    }
    const window = departureWindow(firstDepartureLocal(offer));
    windows.set(window, (windows.get(window) ?? 0) + 1);
  }
  const durations = items.map((item) => totalDuration(item.offer));
  return {
    airlines: [...airlines.values()].sort((a, b) => compare(a.minPrice, b.minPrice)),
    stops: [...stops.values()].sort((a, b) => a.stops - b.stops),
    price: range(items.map((item) => item.price.total)),
    durationMinutes:
      durations.length > 0 ? { min: Math.min(...durations), max: Math.max(...durations) } : null,
    departureWindows: (['night', 'morning', 'afternoon', 'evening'] as const)
      .filter((window) => windows.has(window))
      .map((window) => ({ window, count: windows.get(window) ?? 0 })),
    refundable: items.filter((item) => item.offer.conditions.refundable).length,
    withCheckedBag: items.filter((item) => item.offer.baggage.checked >= 1).length,
  };
}

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

export interface PricedRate {
  id: string;
  rate: SupplierHotelRate;
  price: PriceBreakdown;
}

export interface PricedHotel {
  id: string;
  hotel: SupplierHotel;
  rates: PricedRate[];
  cheapest: PricedRate;
}

export type HotelSort = 'recommended' | 'price' | 'rating' | 'stars';

export interface HotelFilters {
  stars?: string[] | undefined;
  minRating?: number | undefined;
  freeCancellation?: boolean | undefined;
  amenities?: string[] | undefined;
  /** Neighbourhoods, as named in the `areas` facet. */
  areas?: string[] | undefined;
  board?: BoardType | undefined;
  maxPrice?: number | undefined;
}

/** Applies rate-level filters first (board, free cancellation), then hotel-level ones. */
export function filterHotels(items: readonly PricedHotel[], filters: HotelFilters): PricedHotel[] {
  const result: PricedHotel[] = [];
  for (const item of items) {
    const { hotel } = item;
    if (filters.stars && !filters.stars.includes(String(hotel.stars))) continue;
    if (filters.minRating !== undefined && (hotel.reviewScore ?? 0) < filters.minRating) continue;
    if (filters.areas && (hotel.area === null || !filters.areas.includes(hotel.area))) continue;
    if (
      filters.amenities &&
      !filters.amenities.every((amenity) => hotel.amenities.includes(amenity))
    )
      continue;
    const rates = item.rates.filter(
      ({ rate, price }) =>
        (filters.board === undefined || rate.board === filters.board) &&
        (filters.freeCancellation !== true || rate.refundable) &&
        (filters.maxPrice === undefined || price.total.minor <= BigInt(filters.maxPrice)),
    );
    const cheapest = rates.reduce<PricedRate | undefined>(
      (best, rate) => (best && compare(best.price.total, rate.price.total) <= 0 ? best : rate),
      undefined,
    );
    if (cheapest) result.push({ ...item, rates, cheapest });
  }
  return result;
}

/** "Recommended" balances quality (reviews, stars) against price. */
export function sortHotels(items: readonly PricedHotel[], sort: HotelSort): PricedHotel[] {
  const minPrice = Math.max(
    1,
    Math.min(...items.map((item) => Number(item.cheapest.price.total.minor))),
  );
  // Quality (review score plus 1.5 per star) with a gentle price penalty: a hotel twice the
  // cheapest price needs about 20% more quality to rank level.
  const value = (item: PricedHotel): number =>
    ((item.hotel.reviewScore ?? 6) + 1.5 * item.hotel.stars) /
    (Number(item.cheapest.price.total.minor) / minPrice) ** 0.3;
  const byPrice = (a: PricedHotel, b: PricedHotel) =>
    compare(a.cheapest.price.total, b.cheapest.price.total) || a.id.localeCompare(b.id);
  const comparators: Record<HotelSort, (a: PricedHotel, b: PricedHotel) => number> = {
    recommended: (a, b) => value(b) - value(a) || byPrice(a, b),
    price: byPrice,
    rating: (a, b) => (b.hotel.reviewScore ?? 0) - (a.hotel.reviewScore ?? 0) || byPrice(a, b),
    stars: (a, b) => b.hotel.stars - a.hotel.stars || byPrice(a, b),
  };
  return [...items].sort(comparators[sort]);
}

export function hotelFacets(items: readonly PricedHotel[]) {
  const stars = new Map<number, { stars: number; count: number; minPrice: Money }>();
  const amenities = new Map<string, number>();
  const boards = new Map<BoardType, number>();
  const areas = new Map<string, number>();
  for (const item of items) {
    if (item.hotel.area) areas.set(item.hotel.area, (areas.get(item.hotel.area) ?? 0) + 1);
    const entry = stars.get(item.hotel.stars);
    if (entry) {
      entry.count += 1;
      entry.minPrice = minOf(entry.minPrice, item.cheapest.price.total);
    } else {
      stars.set(item.hotel.stars, {
        stars: item.hotel.stars,
        count: 1,
        minPrice: item.cheapest.price.total,
      });
    }
    for (const amenity of item.hotel.amenities)
      amenities.set(amenity, (amenities.get(amenity) ?? 0) + 1);
    for (const board of new Set(item.rates.map(({ rate }) => rate.board)))
      boards.set(board, (boards.get(board) ?? 0) + 1);
  }
  return {
    stars: [...stars.values()].sort((a, b) => b.stars - a.stars),
    price: range(items.map((item) => item.cheapest.price.total)),
    amenities: [...amenities]
      .map(([amenity, count]) => ({ amenity, count }))
      .sort((a, b) => b.count - a.count || a.amenity.localeCompare(b.amenity)),
    boards: [...boards].map(([board, count]) => ({ board, count })),
    areas: [...areas]
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)),
    freeCancellation: items.filter((item) => item.rates.some(({ rate }) => rate.refundable)).length,
  };
}
