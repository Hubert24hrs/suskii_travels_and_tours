import { flightFormToParams } from '@suskii/shared';

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
