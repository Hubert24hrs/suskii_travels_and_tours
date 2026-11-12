import type {
  CabinClass,
  FlightFormDraft,
  TravellerCounts,
  TripType,
  HotelRoomDraft,
} from '@suskii/shared';

import type { CityOption } from './city-field';
import type { PlaceOption } from './places';

// Plain module (no 'use client'): server pages build pre-filled state with these helpers.

export interface Leg {
  origin: PlaceOption | null;
  destination: PlaceOption | null;
  date: string;
}

/** The form state: the shared draft, with places kept as options so fields can show labels. */
export interface FlightFormState {
  tripType: TripType;
  origin: PlaceOption | null;
  destination: PlaceOption | null;
  departureDate: string;
  returnDate: string;
  legs: Leg[];
  travellers: TravellerCounts;
  cabinClass: CabinClass;
  directOnly: boolean;
  flexibleDates: boolean;
}

export const emptyLeg = (): Leg => ({ origin: null, destination: null, date: '' });

export const EMPTY_FLIGHT_STATE: FlightFormState = {
  tripType: 'round_trip',
  origin: null,
  destination: null,
  departureDate: '',
  returnDate: '',
  legs: [emptyLeg(), emptyLeg()],
  travellers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'economy',
  directOnly: false,
  flexibleDates: false,
};

/** Builds the state from a URL draft and the airport options the server resolved. */
export function flightStateFromDraft(
  draft: FlightFormDraft,
  places: Readonly<Record<string, PlaceOption>>,
): FlightFormState {
  const place = (code: string) => (code ? (places[code] ?? null) : null);
  return {
    tripType: draft.tripType,
    origin: place(draft.origin),
    destination: place(draft.destination),
    departureDate: draft.departureDate,
    returnDate: draft.returnDate,
    legs: draft.legs.map((leg) => ({
      origin: place(leg.origin),
      destination: place(leg.destination),
      date: leg.departureDate,
    })),
    travellers: draft.travellers,
    cabinClass: draft.cabinClass,
    directOnly: draft.directOnly,
    flexibleDates: draft.flexibleDates,
  };
}

export interface HotelFormState {
  city: CityOption | null;
  checkIn: string;
  checkOut: string;
  rooms: HotelRoomDraft[];
  freeCancellationOnly: boolean;
}

export const EMPTY_HOTEL_STATE: HotelFormState = {
  city: null,
  checkIn: '',
  checkOut: '',
  rooms: [{ adults: 2, childAges: [] }],
  freeCancellationOnly: false,
};
