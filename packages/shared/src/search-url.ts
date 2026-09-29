import {
  CABIN_CLASSES,
  MAX_FLIGHT_SLICES,
  MAX_HOTEL_ROOMS,
  TRIP_TYPES,
  createFlightSearchFormSchema,
  createHotelSearchRequestSchema,
  type CabinClass,
  type FlightSearchForm,
  type HotelSearchRequest,
  type SearchSchemaOptions,
  type TripType,
} from './search';
import { DEFAULT_TRAVELLERS, type TravellerCounts } from './travellers';

/**
 * Search forms <-> URL query parameters (PROJECT_SPEC.json#/homepage_spec: "serialise search to
 * URL query params for shareable/SEO-friendly results pages"). Parameters are short, readable and
 * emitted in a fixed order with defaults omitted, so equal searches produce equal URLs.
 *
 *   /flights/search?trip=round_trip&from=LOS&to=LHR&depart=2026-12-10&return=2026-12-17&adults=2
 *   /flights/search?trip=multi_city&leg=LOS-LHR-2026-12-10&leg=LHR-CDG-2026-12-15&adults=1
 *   /hotels/search?dest=<city uuid>&checkin=2026-12-10&checkout=2026-12-12&room=2&room=1-7
 *
 * Parsing never throws: it returns an editable draft (to pre-fill forms, even from a stale or
 * hand-edited link) plus the validated form when every rule passes.
 */

/** Plain query object (Next.js `searchParams`) or `URLSearchParams`. */
export type QueryInput = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

const all = (query: QueryInput, key: string): string[] => {
  if (query instanceof URLSearchParams) return query.getAll(key);
  const value = query[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

const first = (query: QueryInput, key: string): string => all(query, key)[0]?.trim() ?? '';

/** Non-negative whole number, or `fallback` for anything else. */
const count = (value: string, fallback: number): number =>
  /^\d{1,2}$/.test(value) ? Number(value) : fallback;

const code = (value: string): string => (/^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : '');

const date = (value: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '');

const oneOf = <T extends string>(options: readonly T[], value: string, fallback: T): T =>
  (options as readonly string[]).includes(value) ? (value as T) : fallback;

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

export interface FlightLegDraft {
  origin: string;
  destination: string;
  departureDate: string;
}

/** Everything the flight form edits, before validation. Empty strings mean "not chosen yet". */
export interface FlightFormDraft {
  tripType: TripType;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  legs: FlightLegDraft[];
  travellers: TravellerCounts;
  cabinClass: CabinClass;
  directOnly: boolean;
  flexibleDates: boolean;
}

const emptyLeg = (): FlightLegDraft => ({ origin: '', destination: '', departureDate: '' });

export function emptyFlightDraft(): FlightFormDraft {
  return {
    tripType: 'round_trip',
    origin: '',
    destination: '',
    departureDate: '',
    returnDate: '',
    legs: [emptyLeg(), emptyLeg()],
    travellers: DEFAULT_TRAVELLERS,
    cabinClass: 'economy',
    directOnly: false,
    flexibleDates: false,
  };
}

/** The draft in the shape the form schema expects (fields irrelevant to the trip type dropped). */
export function flightDraftToInput(draft: FlightFormDraft): unknown {
  const common = {
    travellers: draft.travellers,
    cabinClass: draft.cabinClass,
    directOnly: draft.directOnly,
    flexibleDates: draft.flexibleDates,
  };
  if (draft.tripType === 'multi_city')
    return { tripType: 'multi_city', legs: draft.legs, ...common };
  const outbound = {
    origin: draft.origin,
    destination: draft.destination,
    departureDate: draft.departureDate,
  };
  if (draft.tripType === 'one_way') return { tripType: 'one_way', ...outbound, ...common };
  return { tripType: 'round_trip', ...outbound, returnDate: draft.returnDate, ...common };
}

export function flightFormToDraft(form: FlightSearchForm): FlightFormDraft {
  const base = emptyFlightDraft();
  const common = {
    travellers: form.travellers,
    cabinClass: form.cabinClass,
    directOnly: form.directOnly,
    flexibleDates: form.flexibleDates,
  };
  if (form.tripType === 'multi_city') {
    return {
      ...base,
      ...common,
      tripType: 'multi_city',
      legs: form.legs.map((leg) => ({ ...leg })),
    };
  }
  return {
    ...base,
    ...common,
    tripType: form.tripType,
    origin: form.origin,
    destination: form.destination,
    departureDate: form.departureDate,
    returnDate: form.tripType === 'round_trip' ? form.returnDate : '',
  };
}

const appendTravellers = (params: URLSearchParams, travellers: TravellerCounts): void => {
  params.set('adults', String(travellers.adults));
  if (travellers.children > 0) params.set('children', String(travellers.children));
  if (travellers.infants > 0) params.set('infants', String(travellers.infants));
};

const readTravellers = (query: QueryInput): TravellerCounts => ({
  adults: count(first(query, 'adults'), DEFAULT_TRAVELLERS.adults),
  children: count(first(query, 'children'), 0),
  infants: count(first(query, 'infants'), 0),
});

export function flightFormToParams(form: FlightSearchForm): URLSearchParams {
  const params = new URLSearchParams({ trip: form.tripType });
  if (form.tripType === 'multi_city') {
    for (const leg of form.legs) {
      params.append('leg', `${leg.origin}-${leg.destination}-${leg.departureDate}`);
    }
  } else {
    params.set('from', form.origin);
    params.set('to', form.destination);
    params.set('depart', form.departureDate);
    if (form.tripType === 'round_trip') params.set('return', form.returnDate);
  }
  appendTravellers(params, form.travellers);
  if (form.cabinClass !== 'economy') params.set('cabin', form.cabinClass);
  if (form.directOnly) params.set('direct', '1');
  if (form.flexibleDates) params.set('flex', '1');
  return params;
}

const LEG_PATTERN = /^([A-Za-z]{3})-([A-Za-z]{3})-(\d{4}-\d{2}-\d{2})$/;

export interface ParsedSearch<TDraft, TForm> {
  draft: TDraft;
  /** The validated form, or `null` when a rule fails (the draft still pre-fills the form). */
  form: TForm | null;
}

export function parseFlightSearchParams(
  query: QueryInput,
  options: SearchSchemaOptions = {},
): ParsedSearch<FlightFormDraft, FlightSearchForm> {
  const tripType = oneOf(TRIP_TYPES, first(query, 'trip'), 'round_trip');
  const legs = all(query, 'leg')
    .slice(0, MAX_FLIGHT_SLICES)
    .map((value) => {
      const match = LEG_PATTERN.exec(value.trim());
      return match
        ? {
            origin: code(match[1] ?? ''),
            destination: code(match[2] ?? ''),
            departureDate: date(match[3] ?? ''),
          }
        : emptyLeg();
    });
  while (legs.length < 2) legs.push(emptyLeg());

  const draft: FlightFormDraft = {
    tripType,
    origin: code(first(query, 'from')),
    destination: code(first(query, 'to')),
    departureDate: date(first(query, 'depart')),
    returnDate: date(first(query, 'return')),
    legs,
    travellers: readTravellers(query),
    cabinClass: oneOf(CABIN_CLASSES, first(query, 'cabin'), 'economy'),
    directOnly: first(query, 'direct') === '1',
    flexibleDates: first(query, 'flex') === '1',
  };
  const result = createFlightSearchFormSchema(options).safeParse(flightDraftToInput(draft));
  return { draft, form: result.success ? result.data : null };
}

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

export interface HotelRoomDraft {
  adults: number;
  childAges: number[];
}

export interface HotelFormDraft {
  /** City id from the catalog; empty until chosen. */
  cityId: string;
  checkIn: string;
  checkOut: string;
  rooms: HotelRoomDraft[];
  freeCancellationOnly: boolean;
}

export function emptyHotelDraft(): HotelFormDraft {
  return {
    cityId: '',
    checkIn: '',
    checkOut: '',
    rooms: [{ adults: 2, childAges: [] }],
    freeCancellationOnly: false,
  };
}

export function hotelDraftToInput(draft: HotelFormDraft): unknown {
  return {
    destination: { type: 'city', cityId: draft.cityId },
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    rooms: draft.rooms,
    freeCancellationOnly: draft.freeCancellationOnly,
  };
}

export function hotelFormToParams(form: HotelSearchRequest): URLSearchParams {
  const params = new URLSearchParams({
    dest: form.destination.cityId,
    checkin: form.checkIn,
    checkout: form.checkOut,
  });
  for (const room of form.rooms) params.append('room', [room.adults, ...room.childAges].join('-'));
  if (form.freeCancellationOnly) params.set('freecancel', '1');
  return params;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readRoom = (value: string): HotelRoomDraft | null => {
  if (!/^\d{1,2}(-\d{1,2}){0,6}$/.test(value)) return null;
  const [adults = 1, ...childAges] = value.split('-').map(Number);
  return { adults, childAges };
};

export function parseHotelSearchParams(
  query: QueryInput,
  options: SearchSchemaOptions = {},
): ParsedSearch<HotelFormDraft, HotelSearchRequest> {
  const dest = first(query, 'dest');
  const rooms = all(query, 'room')
    .slice(0, MAX_HOTEL_ROOMS)
    .map((value) => readRoom(value.trim()))
    .filter((room): room is HotelRoomDraft => room !== null);
  const draft: HotelFormDraft = {
    cityId: UUID_PATTERN.test(dest) ? dest.toLowerCase() : '',
    checkIn: date(first(query, 'checkin')),
    checkOut: date(first(query, 'checkout')),
    rooms: rooms.length > 0 ? rooms : emptyHotelDraft().rooms,
    freeCancellationOnly: first(query, 'freecancel') === '1',
  };
  const result = createHotelSearchRequestSchema(options).safeParse(hotelDraftToInput(draft));
  return { draft, form: result.success ? result.data : null };
}

/** Helpers shared with the other vertical forms (`vertical-forms.ts`). */
export const queryReaders = { all, first, count, date, oneOf, readTravellers, appendTravellers };
