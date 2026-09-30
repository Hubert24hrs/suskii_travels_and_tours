import type { TravellerCounts } from '@suskii/shared';

import { isInhouse, type ItemPayload } from './booking-pricing';
import { inhouseCountry, inhouseDates } from './inhouse-items';

/** What an add-on needs to know about a trip (ADR-027): never names or contact details. */
export interface TripFacts {
  countryCode: string | null;
  cityName: string | null;
  timeZone: string | null;
  startDate: string;
  endDate: string;
  travellers: TravellerCounts;
}

export function tripFacts(payload: ItemPayload): TripFacts | null {
  if (isInhouse(payload)) {
    const { start, end } = inhouseDates(payload);
    return {
      countryCode: inhouseCountry(payload),
      cityName: payload.kind === 'visa' ? null : payload.cityName,
      timeZone: payload.kind === 'visa' ? null : payload.timeZone,
      startDate: start,
      endDate: end,
      travellers: payload.travellers,
    };
  }
  if (payload.kind === 'hotel') {
    const childAges = payload.request.rooms.flatMap((room) => room.childAges);
    return {
      countryCode: payload.hotel.countryCode,
      cityName: payload.hotel.cityName,
      timeZone: null,
      startDate: payload.request.checkIn,
      endDate: payload.request.checkOut,
      travellers: {
        adults: payload.request.rooms.reduce((sum, room) => sum + room.adults, 0),
        children: childAges.filter((age) => age >= 2).length,
        infants: childAges.filter((age) => age < 2).length,
      },
    };
  }
  const slices = payload.offer.slices;
  const first = slices[0];
  const last = slices.at(-1);
  if (!first || !last) return null;
  // A return trip is "at" the first destination; a one-way or multi-city trip ends at the last.
  const roundTrip =
    slices.length === 2 &&
    last.destination.code === first.origin.code &&
    last.origin.code === first.destination.code;
  const place = roundTrip ? first.destination : last.destination;
  return {
    countryCode: place.countryCode,
    cityName: place.cityName,
    timeZone: place.timeZone,
    startDate: first.departureLocal.slice(0, 10),
    endDate: (slices.length > 1 ? last.departureLocal : first.arrivalLocal).slice(0, 10),
    travellers: payload.offer.passengers,
  };
}
