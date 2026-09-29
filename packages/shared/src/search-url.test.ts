import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { FlightSearchForm, HotelSearchRequest } from './search';
import {
  emptyFlightDraft,
  flightFormToDraft,
  flightFormToParams,
  hotelFormToParams,
  parseFlightSearchParams,
  parseHotelSearchParams,
} from './search-url';
import { addDays } from './time';

const now = () => new Date('2026-10-01T12:00:00Z');
const TODAY = '2026-10-01';

const iata = fc.stringMatching(/^[A-Z]{3}$/);
const offset = fc.integer({ min: 0, max: 330 });
const travellers = fc
  .integer({ min: 1, max: 9 })
  .chain((adults) =>
    fc
      .integer({ min: 0, max: Math.min(adults, 9 - adults) })
      .chain((infants) =>
        fc
          .integer({ min: 0, max: 9 - adults - infants })
          .map((children) => ({ adults, children, infants })),
      ),
  );
const common = {
  travellers,
  cabinClass: fc.constantFrom('economy', 'premium_economy', 'business', 'first' as const),
  directOnly: fc.boolean(),
  flexibleDates: fc.boolean(),
};
const route = fc.tuple(iata, iata).filter(([a, b]) => a !== b);

const roundTripForm: fc.Arbitrary<FlightSearchForm> = fc
  .record({
    tripType: fc.constant('round_trip' as const),
    route,
    depart: offset,
    stay: fc.integer({ min: 0, max: 30 }),
    ...common,
  })
  .map(({ route: [origin, destination], depart, stay, ...rest }) => ({
    ...rest,
    origin,
    destination,
    departureDate: addDays(TODAY, depart),
    returnDate: addDays(TODAY, depart + stay),
  }));

const oneWayForm: fc.Arbitrary<FlightSearchForm> = fc
  .record({ tripType: fc.constant('one_way' as const), route, depart: offset, ...common })
  .map(({ route: [origin, destination], depart, ...rest }) => ({
    ...rest,
    origin,
    destination,
    departureDate: addDays(TODAY, depart),
  }));

const multiCityForm: fc.Arbitrary<FlightSearchForm> = fc
  .record({
    tripType: fc.constant('multi_city' as const),
    legs: fc.array(fc.tuple(route, offset), { minLength: 2, maxLength: 5 }),
    ...common,
  })
  .map(({ legs, ...rest }) => {
    const days = legs.map(([, day]) => day).sort((a, b) => a - b);
    return {
      ...rest,
      legs: legs.map(([[origin, destination]], index) => ({
        origin,
        destination,
        departureDate: addDays(TODAY, days[index] ?? 0),
      })),
    };
  });

const viaString = (params: { toString(): string }) => new URLSearchParams(params.toString());

describe('flight search URLs', () => {
  it('round-trips every valid form through a URL string', () => {
    fc.assert(
      fc.property(fc.oneof(roundTripForm, oneWayForm, multiCityForm), (form) => {
        const parsed = parseFlightSearchParams(viaString(flightFormToParams(form)), { now });
        expect(parsed.form).toEqual(form);
        expect(parsed.draft).toEqual(flightFormToDraft(form));
      }),
    );
  });

  it('writes short, stable URLs with defaults omitted', () => {
    const params = flightFormToParams({
      tripType: 'round_trip',
      origin: 'LOS',
      destination: 'LHR',
      departureDate: '2026-12-10',
      returnDate: '2026-12-17',
      travellers: { adults: 2, children: 0, infants: 1 },
      cabinClass: 'economy',
      directOnly: false,
      flexibleDates: true,
    });
    expect(params.toString()).toBe(
      'trip=round_trip&from=LOS&to=LHR&depart=2026-12-10&return=2026-12-17&adults=2&infants=1&flex=1',
    );
    const multi = flightFormToParams({
      tripType: 'multi_city',
      legs: [
        { origin: 'LOS', destination: 'LHR', departureDate: '2026-12-10' },
        { origin: 'LHR', destination: 'CDG', departureDate: '2026-12-15' },
      ],
      travellers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'business',
      directOnly: true,
      flexibleDates: false,
    });
    expect(multi.toString()).toBe(
      'trip=multi_city&leg=LOS-LHR-2026-12-10&leg=LHR-CDG-2026-12-15&adults=1&cabin=business&direct=1',
    );
  });

  it('keeps a usable draft when a link is stale or hand-edited', () => {
    const stale = parseFlightSearchParams(
      { trip: 'round_trip', from: 'los', to: 'LHR', depart: '2026-01-10', return: '2026-01-17' },
      { now },
    );
    expect(stale.form).toBeNull();
    expect(stale.draft).toMatchObject({
      origin: 'LOS',
      destination: 'LHR',
      departureDate: '2026-01-10',
    });

    const junk = parseFlightSearchParams(
      { trip: 'space', from: '<script>', adults: '-3', cabin: 'cockpit', leg: ['nonsense'] },
      { now },
    );
    expect(junk.form).toBeNull();
    expect(junk.draft).toEqual(emptyFlightDraft());
  });

  it('applies the shared rules (same airports, infants per adult)', () => {
    const same = parseFlightSearchParams(
      new URLSearchParams('trip=one_way&from=LOS&to=LOS&depart=2026-10-10&adults=1'),
      { now },
    );
    expect(same.form).toBeNull();
    const infants = parseFlightSearchParams(
      new URLSearchParams('trip=one_way&from=LOS&to=ABV&depart=2026-10-10&adults=1&infants=2'),
      { now },
    );
    expect(infants.form).toBeNull();
  });
});

const hotelForm: fc.Arbitrary<HotelSearchRequest> = fc
  .record({
    cityId: fc.uuid(),
    checkIn: fc.integer({ min: 0, max: 300 }),
    nights: fc.integer({ min: 1, max: 30 }),
    rooms: fc.array(
      fc.record({
        adults: fc.integer({ min: 1, max: 6 }),
        childAges: fc.array(fc.integer({ min: 0, max: 17 }), { maxLength: 4 }),
      }),
      { minLength: 1, maxLength: 8 },
    ),
    freeCancellationOnly: fc.boolean(),
  })
  .map(({ cityId, checkIn, nights, rooms, freeCancellationOnly }) => ({
    destination: { type: 'city' as const, cityId: cityId.toLowerCase() },
    checkIn: addDays(TODAY, checkIn),
    checkOut: addDays(TODAY, checkIn + nights),
    rooms,
    freeCancellationOnly,
  }));

describe('hotel search URLs', () => {
  it('round-trips every valid form through a URL string', () => {
    fc.assert(
      fc.property(hotelForm, (form) => {
        const parsed = parseHotelSearchParams(viaString(hotelFormToParams(form)), { now });
        expect(parsed.form).toEqual(form);
      }),
    );
  });

  it('encodes rooms as adults plus child ages', () => {
    const params = hotelFormToParams({
      destination: { type: 'city', cityId: '01a0ea71-38e9-7127-b812-1b5f35f5212b' },
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      rooms: [
        { adults: 2, childAges: [] },
        { adults: 1, childAges: [7, 3] },
      ],
      freeCancellationOnly: true,
    });
    expect(params.toString()).toBe(
      'dest=01a0ea71-38e9-7127-b812-1b5f35f5212b&checkin=2026-12-10&checkout=2026-12-12&room=2&room=1-7-3&freecancel=1',
    );
  });

  it('ignores malformed values', () => {
    const parsed = parseHotelSearchParams(
      { dest: 'paris', room: ['x', '2-5'], checkin: 'soon' },
      { now },
    );
    expect(parsed.form).toBeNull();
    expect(parsed.draft).toMatchObject({
      cityId: '',
      checkIn: '',
      rooms: [{ adults: 2, childAges: [5] }],
    });
  });
});
