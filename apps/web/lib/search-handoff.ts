import type { CurrencyCode } from '@suskii/shared/lite';

import type { Schemas } from './browser-api';

type FlightRequest = Schemas['FlightSearchRequestInput'];
type HotelRequest = Schemas['HotelSearchRequestInput'];
type FlightResult = Schemas['FlightSearchResult'];
type HotelResult = Schemas['HotelSearchResult'];

/** How long a search started by the form waits for its results page to pick it up. */
const HANDOFF_MS = 30_000;

interface Pending<T> {
  key: string;
  startedAt: number;
  result: Promise<T | null>;
}

let flight: Pending<FlightResult> | null = null;
let hotel: Pending<HotelResult> | null = null;
let warmed = false;

/**
 * On the form's first touch, loads (once) the API client a search needs, so on a slow network
 * the search can start the moment the traveller presses Search (ADR-075).
 */
export function warmSearch(): void {
  if (warmed) return;
  warmed = true;
  import('./browser-api').catch(() => undefined);
}

/** Identifies a search: the request, the display currency and the size of the first page. */
export const searchKey = (request: unknown, currency: string, limit: number): string =>
  JSON.stringify([request, currency, limit]);

const fresh = <T>(pending: Pending<T> | null, key: string): Promise<T | null> | null =>
  pending?.key === key && Date.now() - pending.startedAt < HANDOFF_MS ? pending.result : null;

/**
 * Starts a flight search as the form is submitted, so it runs while the results page loads
 * instead of after (ADR-075). The API client loads on demand: the homepage does not ship it.
 */
export function startFlightSearch(
  request: FlightRequest,
  currency: CurrencyCode,
  limit: number,
): void {
  flight = {
    key: searchKey(request, currency, limit),
    startedAt: Date.now(),
    result: import('./browser-api')
      .then(({ browserApi }) =>
        browserApi().POST('/v1/flights/searches', {
          params: { query: { currency, limit } },
          body: request,
        }),
      )
      .then(({ data }) => data ?? null)
      .catch(() => null),
  };
}

/** The flight search the form started for this key, if it is recent; else null. */
export const handedFlightSearch = (key: string): Promise<FlightResult | null> | null =>
  fresh(flight, key);

/** As `startFlightSearch`, for hotels. */
export function startHotelSearch(
  request: HotelRequest,
  currency: CurrencyCode,
  limit: number,
): void {
  hotel = {
    key: searchKey(request, currency, limit),
    startedAt: Date.now(),
    result: import('./browser-api')
      .then(({ browserApi }) =>
        browserApi().POST('/v1/hotels/searches', {
          params: { query: { currency, limit } },
          body: request,
        }),
      )
      .then(({ data }) => data ?? null)
      .catch(() => null),
  };
}

/** The hotel search the form started for this key, if it is recent; else null. */
export const handedHotelSearch = (key: string): Promise<HotelResult | null> | null =>
  fresh(hotel, key);
