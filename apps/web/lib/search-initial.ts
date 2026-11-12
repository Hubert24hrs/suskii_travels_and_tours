import {
  parseAddonsParams,
  parseFlightSearchParams,
  parseHotelSearchParams,
  parsePackagesParams,
  parseToursParams,
  parseVisaParams,
  type QueryInput,
} from '@suskii/shared';

import type { CityOption } from '../components/search/city-field';
import {
  flightStateFromDraft,
  type FlightFormState,
  type HotelFormState,
} from '../components/search/form-state';
import type { PlaceOption } from '../components/search/places';
import type { SearchInitialState } from '../components/search/search-module';

import { api } from './api';

/** Next.js page `searchParams`. */
export type SearchParams = Record<string, string | string[] | undefined>;

async function placeOptions(codes: readonly string[]): Promise<Record<string, PlaceOption>> {
  const unique = [...new Set(codes.filter(Boolean))].slice(0, 10);
  const airports = await Promise.all(unique.map((code) => api.airport(code)));
  const places: Record<string, PlaceOption> = {};
  for (const airport of airports) {
    if (!airport) continue;
    places[airport.code] = {
      code: airport.code,
      name: airport.name,
      // OurAirports municipalities can carry a locality suffix ("Paris (Roissy-en-France, ...)").
      city: (airport.municipality ?? airport.name).replace(/\s*\(.*\)$/, ''),
      countryCode: airport.countryCode,
    };
  }
  return places;
}

async function cityOption(cityId: string): Promise<CityOption | null> {
  if (!cityId) return null;
  const city = await api.city(cityId);
  return city ? { id: city.id, name: city.name, countryName: city.countryName } : null;
}

/**
 * Parses a flight search URL. Airport labels are resolved through the API, so a link can never
 * make the form show one airport while searching another.
 */
export async function flightInitial(
  query: QueryInput,
): Promise<{ state: FlightFormState; valid: boolean }> {
  const { draft, form } = parseFlightSearchParams(query);
  const places = await placeOptions([
    draft.origin,
    draft.destination,
    ...draft.legs.flatMap((leg) => [leg.origin, leg.destination]),
  ]);
  return { state: flightStateFromDraft(draft, places), valid: form !== null };
}

export async function hotelInitial(
  query: QueryInput,
): Promise<{ state: HotelFormState; valid: boolean }> {
  const { draft, form } = parseHotelSearchParams(query);
  const city = await cityOption(draft.cityId);
  return {
    state: {
      city,
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      rooms: draft.rooms,
      freeCancellationOnly: draft.freeCancellationOnly,
    },
    valid: form !== null && city !== null,
  };
}

/** Initial state for the packages, tours, visa or add-ons form from its page URL. */
export async function verticalInitial(
  vertical: 'packages' | 'tours' | 'visa' | 'travel_addons',
  query: QueryInput,
): Promise<{ initial: SearchInitialState; hasQuery: boolean }> {
  const hasQuery = Object.keys(query).length > 0;
  switch (vertical) {
    case 'packages': {
      const { draft } = parsePackagesParams(query);
      return { initial: { packages: { draft, city: await cityOption(draft.cityId) } }, hasQuery };
    }
    case 'tours':
      return { initial: { tours: parseToursParams(query).draft }, hasQuery };
    case 'visa':
      return { initial: { visa: parseVisaParams(query).draft }, hasQuery };
    case 'travel_addons': {
      const draft = parseAddonsParams(query);
      return { initial: { addons: { draft, city: await cityOption(draft.cityId) } }, hasQuery };
    }
  }
}
