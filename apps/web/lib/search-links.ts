import {
  flightFormToParams,
  hotelFormToParams,
  type FlightSearchRequest,
  type HotelSearchRequest,
} from '@suskii/shared';

import type { FlightDeal } from './api';

/** Pre-filled flight search for a deal card (the dates and cabin of the fare found). */
export function dealSearchHref(deal: FlightDeal): string {
  const common = {
    origin: deal.origin.code,
    destination: deal.destination.code,
    departureDate: deal.departureDate,
    travellers: { adults: 1, children: 0, infants: 0 },
    cabinClass: deal.cabinClass,
    directOnly: false,
    flexibleDates: false,
  };
  const params = deal.returnDate
    ? flightFormToParams({ ...common, tripType: 'round_trip', returnDate: deal.returnDate })
    : flightFormToParams({ ...common, tripType: 'one_way' });
  return `/flights/search?${params.toString()}`;
}

/**
 * The search page for an API search request, e.g. the `request` of an expired offer, so the
 * traveller can search again with every input preserved.
 */
export function flightRequestHref(request: FlightSearchRequest): string {
  const [outbound, back] = request.slices;
  const common = {
    travellers: request.passengers,
    cabinClass: request.cabinClass,
    directOnly: request.directOnly,
    flexibleDates: false,
  };
  if (!outbound) return '/flights/search';
  const roundTrip =
    request.slices.length === 2 &&
    back?.origin === outbound.destination &&
    back.destination === outbound.origin;
  const params =
    request.slices.length === 1
      ? flightFormToParams({ ...common, tripType: 'one_way', ...outbound })
      : roundTrip
        ? flightFormToParams({
            ...common,
            tripType: 'round_trip',
            ...outbound,
            returnDate: back.departureDate,
          })
        : flightFormToParams({ ...common, tripType: 'multi_city', legs: request.slices });
  return `/flights/search?${params.toString()}`;
}

export function hotelRequestHref(request: HotelSearchRequest): string {
  return `/hotels/search?${hotelFormToParams(request).toString()}`;
}

const INHOUSE_PAGES: Partial<Record<string, string>> = {
  package: '/packages',
  tour: '/tours',
  visa: '/visa',
  addon: '/travel-add-ons',
};

/** Search page for the `request` of a 410 (expired offer or quote); the homepage when unknown. */
export function searchAgainHref(request: unknown): string {
  if (typeof request !== 'object' || request === null) return '/';
  // In-house quote requests (ADR-025) name the product kind; their catalog lists today's offers.
  if ('kind' in request) return INHOUSE_PAGES[String(request.kind)] ?? '/';
  if ('slices' in request) return flightRequestHref(request as FlightSearchRequest);
  if ('destination' in request) return hotelRequestHref(request as HotelSearchRequest);
  return '/';
}
