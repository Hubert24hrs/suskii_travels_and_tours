import type { Schemas } from '@suskii/api-client';
import type { Messages, Translator } from '@suskii/i18n';
import { tripSearchQuery, type TripComponent, type TripPlan } from '@suskii/shared';
import { useSyncExternalStore } from 'react';

/**
 * The trip a traveller is building (ADR-099). While they choose a part on the ordinary search
 * and checkout screens, the app remembers which trip and which part: checkout then adds the
 * booking to the trip instead of taking payment. Kept in memory only: it names a trip and a
 * part, never a person, and is gone when the app closes or the traveller signs out.
 */
export interface ActiveTrip {
  id: string;
  reference: string;
  component: TripComponent;
}

let active: ActiveTrip | null = null;
const listeners = new Set<() => void>();

export const activeTrip = {
  get: (): ActiveTrip | null => active,
  set: (next: ActiveTrip | null): void => {
    active = next;
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useActiveTrip(): ActiveTrip | null {
  return useSyncExternalStore(activeTrip.subscribe, activeTrip.get, activeTrip.get);
}

/** Which part of a trip a quote would be, from what it sells; null for anything a trip skips. */
export function quoteTripComponent(quote: {
  vertical: string;
  addon?: { type?: string } | null;
}): TripComponent | null {
  switch (quote.vertical) {
    case 'flights':
      return 'flight';
    case 'hotels':
      return 'hotel';
    case 'rentals':
      return 'car';
    case 'travel_addons':
      return quote.addon?.type === 'airport_transfer'
        ? 'transfer'
        : quote.addon?.type === 'insurance'
          ? 'insurance'
          : null;
    default:
      return null;
  }
}

const SEARCH_SCREENS = {
  flight: '/search/flights',
  hotel: '/search/hotels',
  car: '/rentals',
} as const;

/**
 * The search screen for the flight, the hotel or the car of a plan, prefilled with its places
 * and dates; null when the plan cannot prefill it (a destination without a catalog city). The
 * transfer and the insurance are chosen on the trip's own screen.
 */
export function tripSearchPath(
  plan: TripPlan,
  component: 'flight' | 'hotel' | 'car',
): string | null {
  const query = tripSearchQuery(plan, component);
  return query === null ? null : `${SEARCH_SCREENS[component]}?${query}`;
}

/**
 * What a part of a trip is, in one line: a route and its airline, a hotel and its city, or a
 * product's title. The trip screen and the receipt say it the same way.
 */
export function tripBookingLine(
  booking: Schemas['BookingSummary'],
  t: Translator<Messages>['t'],
): string {
  const { flight, hotel, product } = booking;
  if (flight)
    return t('trips.page.flightLine', {
      from: flight.origin.cityName ?? flight.origin.code,
      to: flight.destination.cityName ?? flight.destination.code,
      airline: flight.airline,
    });
  if (hotel) return `${hotel.name}, ${hotel.cityName}`;
  return product?.title ?? booking.reference;
}
