import { describe, expect, it } from 'vitest';

import {
  createFlightSearchFormSchema,
  createFlightSearchRequestSchema,
  createHotelSearchRequestSchema,
  SEARCH_ISSUES,
  toFlightSearchRequest,
} from './search';

const now = () => new Date('2026-10-01T12:00:00Z');
const requestSchema = createFlightSearchRequestSchema({ now });
const formSchema = createFlightSearchFormSchema({ now });
const hotelSchema = createHotelSearchRequestSchema({ now });
const passengers = { adults: 1, children: 0, infants: 0 };

const issues = (result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];

describe('flight search request', () => {
  it('normalises codes and applies defaults', () => {
    const parsed = requestSchema.parse({
      slices: [{ origin: ' los', destination: 'abv', departureDate: '2026-10-10' }],
      passengers,
    });
    expect(parsed).toEqual({
      slices: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-10-10' }],
      passengers,
      cabinClass: 'economy',
      directOnly: false,
    });
  });

  it('enforces the spec rules', () => {
    const result = requestSchema.safeParse({
      slices: [
        { origin: 'LOS', destination: 'LOS', departureDate: '2026-10-10' },
        { origin: 'ABV', destination: 'ACC', departureDate: '2026-10-05' },
        { origin: 'ACC', destination: 'NBO', departureDate: '2027-12-01' },
      ],
      passengers: { adults: 1, children: 0, infants: 2 },
    });
    expect(issues(result)).toEqual(
      expect.arrayContaining([
        `slices.0.destination:${SEARCH_ISSUES.sameOriginDestination}`,
        `slices.1.departureDate:${SEARCH_ISSUES.legsNotChronological}`,
        `slices.2.departureDate:${SEARCH_ISSUES.dateTooFar}`,
        'passengers.infants:infants_exceed_adults',
      ]),
    );
  });

  it('accepts a date that is still today somewhere on Earth, and rejects older ones', () => {
    // At 12:00 UTC it is already 1 October at UTC-12.
    expect(
      requestSchema.safeParse({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-10-01' }],
        passengers,
      }).success,
    ).toBe(true);
    const past = requestSchema.safeParse({
      slices: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-09-30' }],
      passengers,
    });
    expect(issues(past)).toEqual([`slices.0.departureDate:${SEARCH_ISSUES.dateInPast}`]);
  });

  it('limits slices to 1-5 and rejects bad codes and dates', () => {
    expect(requestSchema.safeParse({ slices: [], passengers }).success).toBe(false);
    expect(
      requestSchema.safeParse({
        slices: [{ origin: 'LAGOS', destination: 'ABV', departureDate: '2026-10-10' }],
        passengers,
      }).success,
    ).toBe(false);
    expect(
      requestSchema.safeParse({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-02-30' }],
        passengers,
      }).success,
    ).toBe(false);
  });
});

describe('flight search form', () => {
  const common = { travellers: passengers, cabinClass: 'business' as const };

  it('turns a round trip into two slices', () => {
    const form = formSchema.parse({
      tripType: 'round_trip',
      origin: 'LOS',
      destination: 'LHR',
      departureDate: '2026-12-18',
      returnDate: '2027-01-04',
      ...common,
    });
    expect(toFlightSearchRequest(form)).toEqual({
      slices: [
        { origin: 'LOS', destination: 'LHR', departureDate: '2026-12-18' },
        { origin: 'LHR', destination: 'LOS', departureDate: '2027-01-04' },
      ],
      passengers,
      cabinClass: 'business',
      directOnly: false,
    });
  });

  it('rejects a return before the departure', () => {
    const result = formSchema.safeParse({
      tripType: 'round_trip',
      origin: 'LOS',
      destination: 'LHR',
      departureDate: '2026-12-18',
      returnDate: '2026-12-10',
      ...common,
    });
    expect(issues(result)).toEqual([`returnDate:${SEARCH_ISSUES.returnBeforeDeparture}`]);
  });

  it('handles one-way and 2-5 chronological multi-city legs', () => {
    const oneWay = formSchema.parse({
      tripType: 'one_way',
      origin: 'ABV',
      destination: 'LOS',
      departureDate: '2026-10-20',
      ...common,
    });
    expect(toFlightSearchRequest(oneWay).slices).toHaveLength(1);

    const legs = [
      { origin: 'LOS', destination: 'NBO', departureDate: '2026-11-01' },
      { origin: 'NBO', destination: 'JNB', departureDate: '2026-11-05' },
      { origin: 'JNB', destination: 'LOS', departureDate: '2026-11-03' },
    ];
    const multi = formSchema.safeParse({ tripType: 'multi_city', legs, ...common });
    expect(issues(multi)).toEqual([`legs.2.departureDate:${SEARCH_ISSUES.legsNotChronological}`]);
    expect(
      formSchema.safeParse({ tripType: 'multi_city', legs: legs.slice(0, 1), ...common }).success,
    ).toBe(false);
  });
});

describe('hotel search request', () => {
  const cityId = '0192f0e0-0000-7000-8000-000000000010';

  it('reports malformed dates as issues instead of throwing', () => {
    const result = hotelSchema.safeParse({
      destination: { type: 'city', cityId },
      checkIn: 'soon',
      checkOut: '2026-13-45',
      rooms: [{ adults: 2 }],
    });
    expect(issues(result)).toEqual([
      'checkIn:Use a valid YYYY-MM-DD date',
      'checkOut:Use a valid YYYY-MM-DD date',
    ]);
  });

  it('accepts rooms with child ages and applies defaults', () => {
    const parsed = hotelSchema.parse({
      destination: { type: 'city', cityId },
      checkIn: '2026-10-10',
      checkOut: '2026-10-13',
      rooms: [{ adults: 2, childAges: [4, 9] }, { adults: 1 }],
    });
    expect(parsed.rooms[1]?.childAges).toEqual([]);
    expect(parsed.freeCancellationOnly).toBe(false);
  });

  it('enforces stay length, ordering and room limits', () => {
    const base = { destination: { type: 'city', cityId }, rooms: [{ adults: 1 }] };
    expect(
      issues(hotelSchema.safeParse({ ...base, checkIn: '2026-10-10', checkOut: '2026-10-10' })),
    ).toEqual([`checkOut:${SEARCH_ISSUES.checkOutNotAfterCheckIn}`]);
    expect(
      issues(hotelSchema.safeParse({ ...base, checkIn: '2026-10-10', checkOut: '2026-11-15' })),
    ).toEqual([`checkOut:${SEARCH_ISSUES.stayTooLong}`]);
    expect(
      issues(hotelSchema.safeParse({ ...base, checkIn: '2026-09-20', checkOut: '2026-09-22' })),
    ).toEqual([`checkIn:${SEARCH_ISSUES.dateInPast}`]);
    expect(
      hotelSchema.safeParse({
        ...base,
        checkIn: '2026-10-10',
        checkOut: '2026-10-11',
        rooms: Array.from({ length: 9 }, () => ({ adults: 1 })),
      }).success,
    ).toBe(false);
    expect(
      hotelSchema.safeParse({
        ...base,
        checkIn: '2026-10-10',
        checkOut: '2026-10-11',
        rooms: [{ adults: 1, childAges: [18] }],
      }).success,
    ).toBe(false);
  });
});
