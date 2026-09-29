import { daysBetween, utcToLocal } from '@suskii/shared';

import type { AirportInfo } from '../../catalog/catalog.service';
import { OfferUnavailableError, SupplierUnavailableError } from '../supplier.errors';
import type { FlightSearchQuery, HotelSearchQuery, SupplierPassenger } from '../supplier.types';

import { MOCK_HUBS } from './carriers';
import { distanceKm, MockFlightSupplier, type AirportDirectory } from './mock-flight-supplier';
import { MockHotelSupplier } from './mock-hotel-supplier';

// Coordinates and zones as in the seeded OurAirports data.
const AIRPORTS: AirportInfo[] = [
  {
    code: 'LOS',
    name: 'Murtala Muhammed International Airport',
    cityName: 'Lagos',
    countryCode: 'NG',
    latitude: 6.577,
    longitude: 3.321,
    timeZone: 'Africa/Lagos',
  },
  {
    code: 'ABV',
    name: 'Nnamdi Azikiwe International Airport',
    cityName: 'Abuja',
    countryCode: 'NG',
    latitude: 9.007,
    longitude: 7.263,
    timeZone: 'Africa/Lagos',
  },
  {
    code: 'PHC',
    name: 'Port Harcourt International Airport',
    cityName: 'Port Harcourt',
    countryCode: 'NG',
    latitude: 5.015,
    longitude: 6.95,
    timeZone: 'Africa/Lagos',
  },
  {
    code: 'KAN',
    name: 'Mallam Aminu Kano International Airport',
    cityName: 'Kano',
    countryCode: 'NG',
    latitude: 12.048,
    longitude: 8.525,
    timeZone: 'Africa/Lagos',
  },
  {
    code: 'ACC',
    name: 'Kotoka International Airport',
    cityName: 'Accra',
    countryCode: 'GH',
    latitude: 5.605,
    longitude: -0.167,
    timeZone: 'Africa/Accra',
  },
  {
    code: 'NBO',
    name: 'Jomo Kenyatta International Airport',
    cityName: 'Nairobi',
    countryCode: 'KE',
    latitude: -1.319,
    longitude: 36.928,
    timeZone: 'Africa/Nairobi',
  },
  {
    code: 'ADD',
    name: 'Addis Ababa Bole International Airport',
    cityName: 'Addis Ababa',
    countryCode: 'ET',
    latitude: 8.978,
    longitude: 38.8,
    timeZone: 'Africa/Addis_Ababa',
  },
  {
    code: 'LHR',
    name: 'London Heathrow Airport',
    cityName: 'London',
    countryCode: 'GB',
    latitude: 51.471,
    longitude: -0.46,
    timeZone: 'Europe/London',
  },
  {
    code: 'DXB',
    name: 'Dubai International Airport',
    cityName: 'Dubai',
    countryCode: 'AE',
    latitude: 25.25,
    longitude: 55.371,
    timeZone: 'Asia/Dubai',
  },
  {
    code: 'CDG',
    name: 'Charles de Gaulle Airport',
    cityName: 'Paris',
    countryCode: 'FR',
    latitude: 49.01,
    longitude: 2.548,
    timeZone: 'Europe/Paris',
  },
  {
    code: 'IST',
    name: 'Istanbul Airport',
    cityName: 'Istanbul',
    countryCode: 'TR',
    latitude: 41.262,
    longitude: 28.742,
    timeZone: 'Europe/Istanbul',
  },
  {
    code: 'JNB',
    name: 'O. R. Tambo International Airport',
    cityName: 'Johannesburg',
    countryCode: 'ZA',
    latitude: -26.139,
    longitude: 28.246,
    timeZone: 'Africa/Johannesburg',
  },
  {
    code: 'JFK',
    name: 'John F. Kennedy International Airport',
    cityName: 'New York',
    countryCode: 'US',
    latitude: 40.64,
    longitude: -73.779,
    timeZone: 'America/New_York',
  },
  {
    code: 'MEL',
    name: 'Melbourne Airport',
    cityName: 'Melbourne',
    countryCode: 'AU',
    latitude: -37.673,
    longitude: 144.843,
    timeZone: 'Australia/Melbourne',
  },
  {
    code: 'SYD',
    name: 'Sydney Kingsford Smith Airport',
    cityName: 'Sydney',
    countryCode: 'AU',
    latitude: -33.946,
    longitude: 151.177,
    timeZone: 'Australia/Sydney',
  },
];

const directory: AirportDirectory = {
  airportInfo: (codes) =>
    Promise.resolve(
      new Map(AIRPORTS.filter((a) => codes.includes(a.code)).map((a) => [a.code, a])),
    ),
};
const NOW = new Date('2026-10-01T06:00:00Z');
const signal = new AbortController().signal;
const query = (overrides: Partial<FlightSearchQuery> = {}): FlightSearchQuery => ({
  slices: [{ origin: 'LOS', destination: 'LHR', departureDate: '2026-11-20' }],
  passengers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'economy',
  maxConnections: null,
  ...overrides,
});

describe('MockFlightSupplier', () => {
  const supplier = new MockFlightSupplier(directory, () => NOW);

  it('is deterministic for the same query', async () => {
    const a = await supplier.search(query(), signal);
    const b = await supplier.search(query(), signal);
    expect(a.map((o) => [o.supplierOfferId, o.price.base.minor])).toEqual(
      b.map((o) => [o.supplierOfferId, o.price.base.minor]),
    );
    expect(a.length).toBeGreaterThan(5);
  });

  it('builds plausible itineraries: real hubs, consistent times, sensible durations', async () => {
    const offers = await supplier.search(query(), signal);
    const carriers = new Set(offers.map((o) => o.owner.code));
    expect(carriers.has('BA') || carriers.has('VS')).toBe(true); // direct from London hubs
    for (const offer of offers) {
      for (const slice of offer.slices) {
        expect(slice.origin.code).toBe('LOS');
        expect(slice.destination.code).toBe('LHR');
        for (const segment of slice.segments) {
          expect(Date.parse(segment.arrivalUtc)).toBeGreaterThan(Date.parse(segment.departureUtc));
          expect(utcToLocal(new Date(segment.departureUtc), segment.origin.timeZone)).toBe(
            segment.departureLocal,
          );
          expect(utcToLocal(new Date(segment.arrivalUtc), segment.destination.timeZone)).toBe(
            segment.arrivalLocal,
          );
        }
        if (slice.stops === 1) {
          const hub = slice.segments[0]?.destination.code ?? '';
          expect(MOCK_HUBS).toContain(hub);
          expect(slice.layovers[0]?.durationMinutes).toBeGreaterThanOrEqual(75);
        }
        // LOS-LHR is about 5,000 km: roughly 6-7 hours direct.
        if (slice.stops === 0) expect(slice.durationMinutes).toBeGreaterThan(330);
        expect(slice.arrivalDayOffset).toBe(daysBetween(slice.departureLocal, slice.arrivalLocal));
      }
      expect(offer.price.base.currency).toBe('USD');
      expect(offer.price.base.minor > 0n).toBe(true);
    }
    const los = AIRPORTS.find((a) => a.code === 'LOS');
    const lhr = AIRPORTS.find((a) => a.code === 'LHR');
    if (!los || !lhr) throw new Error('fixture missing');
    expect(distanceKm(los, lhr)).toBeGreaterThan(4900);
  });

  it('prices Nigerian domestic routes in NGN with domestic carriers', async () => {
    const offers = await supplier.search(
      query({ slices: [{ origin: 'PHC', destination: 'ABV', departureDate: '2026-11-20' }] }),
      signal,
    );
    expect(offers.every((o) => o.price.base.currency === 'NGN')).toBe(true);
    expect(offers.some((o) => ['P4', 'W3', 'QI'].includes(o.owner.code))).toBe(true);
    expect(offers.map((o) => o.slices[0]?.fareBrand)).not.toContain('Economy Flex'); // domestic brands
  });

  it('honours direct-only, round trips, multi-city and passenger mix', async () => {
    const direct = await supplier.search(query({ maxConnections: 0 }), signal);
    expect(direct.every((o) => o.slices.every((s) => s.stops === 0))).toBe(true);

    const roundTrip = await supplier.search(
      query({
        slices: [
          { origin: 'LOS', destination: 'NBO', departureDate: '2026-11-20' },
          { origin: 'NBO', destination: 'LOS', departureDate: '2026-11-30' },
        ],
      }),
      signal,
    );
    expect(roundTrip.length).toBeGreaterThan(0);
    expect(
      roundTrip.every(
        (o) =>
          o.slices.length === 2 &&
          o.slices.every((s) => s.segments.every((g) => g.marketingCarrier.code === o.owner.code)),
      ),
    ).toBe(true);

    const family = await supplier.search(
      query({ passengers: { adults: 2, children: 1, infants: 1 } }),
      signal,
    );
    const single = await supplier.search(query(), signal);
    expect(family.every((o) => o.passengers.adults === 2 && o.passengers.infants === 1)).toBe(true);
    expect(Math.min(...family.map((o) => Number(o.price.base.minor)))).toBeGreaterThan(
      Math.min(...single.map((o) => Number(o.price.base.minor))) * 2.5,
    );
  });

  it('falls back to a clearly fictional carrier where no fixture route exists', async () => {
    const offers = await supplier.search(
      query({ slices: [{ origin: 'SYD', destination: 'MEL', departureDate: '2026-11-20' }] }),
      signal,
    );
    expect(offers.every((o) => o.owner.code === 'ZZ' && o.owner.name === 'Suskii Mock Air')).toBe(
      true,
    );
    expect(
      await supplier.search(
        query({ slices: [{ origin: 'LOS', destination: 'XXX', departureDate: '2026-11-20' }] }),
        signal,
      ),
    ).toEqual([]);
  });

  it('re-prices with an optional drift and refuses expired offers', async () => {
    const [offer] = await supplier.search(query(), signal);
    if (!offer) throw new Error('no offer');
    const same = await supplier.reprice(offer, signal);
    expect(same.price.base).toEqual(offer.price.base);
    const drifting = new MockFlightSupplier(directory, () => NOW);
    drifting.repriceDriftBps = 500;
    const higher = await drifting.reprice(offer, signal);
    expect(higher.price.base.minor).toBe((offer.price.base.minor * 105n + 50n) / 100n);
    const later = new MockFlightSupplier(directory, () => new Date(NOW.getTime() + 60 * 60_000));
    await expect(later.reprice(offer, signal)).rejects.toBeInstanceOf(OfferUnavailableError);
  });

  it('applies re-price rules once, on the second re-price, to their outbound route only', async () => {
    const ruled = new MockFlightSupplier(directory, () => NOW, new Map([['LOS-LHR', 1000]]));
    const [offer] = await ruled.search(query(), signal);
    if (!offer) throw new Error('no offer');
    const quoted = await ruled.reprice(offer, signal);
    expect(quoted.price.base).toEqual(offer.price.base);
    expect(quoted.supplierOfferId).toBe(`${offer.supplierOfferId}~r1`);
    const beforePayment = await ruled.reprice(quoted, signal);
    expect(beforePayment.price.base.minor).toBe((offer.price.base.minor * 110n + 50n) / 100n);
    expect(beforePayment.services.map((service) => service.id)).toEqual(
      offer.services.map((service) => service.id),
    );
    const consented = await ruled.reprice(beforePayment, signal);
    expect(consented.price.base).toEqual(beforePayment.price.base);
    expect(consented.supplierOfferId).toBe(`${offer.supplierOfferId}~r3`);

    const [other] = await ruled.search(
      query({ slices: [{ origin: 'LOS', destination: 'ACC', departureDate: '2026-11-20' }] }),
      signal,
    );
    if (!other) throw new Error('no offer');
    const otherQuoted = await ruled.reprice(other, signal);
    expect((await ruled.reprice(otherQuoted, signal)).price.base).toEqual(other.price.base);
  });

  it('sells one extra 23 kg bag per passenger, priced in the fare currency', async () => {
    const [international] = await supplier.search(query(), signal);
    expect(international?.services).toEqual([
      {
        id: `${international?.supplierOfferId}.bag23`,
        type: 'checked_bag',
        weightKg: 23,
        maxQuantity: 2,
        price: { minor: 6_000n, currency: 'USD' },
      },
    ]);
    const [domestic] = await supplier.search(
      query({ slices: [{ origin: 'LOS', destination: 'ABV', departureDate: '2026-11-20' }] }),
      signal,
    );
    expect(domestic?.services[0]?.price).toEqual({ minor: 1_500_000n, currency: 'NGN' });
  });

  it('books idempotently: the same key gives the same PNR and tickets', async () => {
    const [offer] = await supplier.search(
      query({ passengers: { adults: 1, children: 0, infants: 1 } }),
      signal,
    );
    if (!offer) throw new Error('no offer');
    const passengers: SupplierPassenger[] = [
      {
        type: 'adult',
        title: 'ms',
        gender: 'f',
        givenNames: 'NGOZI',
        surname: 'EZE',
        dateOfBirth: '1990-01-01',
        nationality: 'NG',
        document: null,
      },
      {
        type: 'infant',
        title: 'miss',
        gender: 'f',
        givenNames: 'ADA',
        surname: 'EZE',
        dateOfBirth: '2026-01-01',
        nationality: 'NG',
        document: null,
      },
    ];
    const request = {
      offer,
      passengers,
      contact: { email: 'ngozi@example.com', phone: '+2348012345678' },
      services: [],
      idempotencyKey: 'item-1',
    };
    const first = await supplier.book(request, signal);
    expect(first.supplierReference).toMatch(/^[A-Z]{6}$/);
    expect(first.tickets.map((ticket) => ticket.passengerIndex)).toEqual([0, 1]);
    expect(first.tickets[0]?.number).toMatch(/^\d{13}$/);
    await expect(supplier.book(request, signal)).resolves.toEqual(first);
    expect(
      (await supplier.book({ ...request, idempotencyKey: 'item-2' }, signal)).supplierReference,
    ).not.toBe(first.supplierReference);

    const failing = new MockFlightSupplier(directory, () => NOW);
    failing.failNextBookings = 1;
    await expect(failing.book(request, signal)).rejects.toBeInstanceOf(SupplierUnavailableError);
    await expect(failing.book(request, signal)).resolves.toEqual(first);

    const departed = new MockFlightSupplier(directory, () => new Date('2026-12-01T00:00:00Z'));
    await expect(departed.book(request, signal)).rejects.toBeInstanceOf(OfferUnavailableError);
  });
});

describe('MockHotelSupplier', () => {
  const supplier = new MockHotelSupplier(() => NOW);
  const hotelQuery = (overrides: Partial<HotelSearchQuery> = {}): HotelSearchQuery => ({
    city: {
      id: 'city-lagos',
      name: 'Lagos',
      countryCode: 'NG',
      latitude: 6.45,
      longitude: 3.39,
      timeZone: 'Africa/Lagos',
    },
    checkIn: '2026-11-20',
    checkOut: '2026-11-23',
    rooms: [{ adults: 2, childAges: [] }],
    freeCancellationOnly: false,
    ...overrides,
  });

  it('returns a stable set of fictional hotels near the city, priced for the stay', async () => {
    const a = await supplier.search(hotelQuery(), signal);
    const b = await supplier.search(hotelQuery(), signal);
    expect(a.map((h) => h.supplierHotelId)).toEqual(b.map((h) => h.supplierHotelId));
    expect(a.length).toBeGreaterThanOrEqual(12);
    for (const hotel of a) {
      expect(hotel.stars).toBeGreaterThanOrEqual(2);
      expect(Math.abs(hotel.latitude - 6.45)).toBeLessThan(0.1);
      expect(
        hotel.rates.every((r) => r.price.base.currency === 'NGN' && r.payAtProperty === null),
      ).toBe(true);
      // 7.5% VAT in Nigeria.
      const rate = hotel.rates[0];
      if (rate)
        expect(Number(rate.price.taxes.minor)).toBeCloseTo(
          Number(rate.price.base.minor) * 0.075,
          -1,
        );
    }
    const longer = await supplier.search(hotelQuery({ checkOut: '2026-11-26' }), signal);
    expect(longer[0]?.rates[0]?.price.base.minor).not.toEqual(a[0]?.rates[0]?.price.base.minor);
  });

  it('filters to free cancellation and prices extra guests', async () => {
    const refundableOnly = await supplier.search(
      hotelQuery({ freeCancellationOnly: true }),
      signal,
    );
    expect(
      refundableOnly.every((h) => h.rates.every((r) => r.refundable && r.freeCancellationUntil)),
    ).toBe(true);
    const abroad = await supplier.search(
      hotelQuery({
        city: {
          id: 'city-london',
          name: 'London',
          countryCode: 'GB',
          latitude: 51.5,
          longitude: -0.12,
          timeZone: 'Europe/London',
        },
      }),
      signal,
    );
    expect(abroad[0]?.rates[0]?.price.base.currency).toBe('USD');
    expect(abroad[0]?.rates[0]?.payAtProperty?.currency).toBe('USD');
  });

  it('re-prices rates and refuses them after they expire', async () => {
    const [hotel] = await supplier.search(hotelQuery(), signal);
    const rate = hotel?.rates[0];
    if (!hotel || !rate) throw new Error('no rate');
    await expect(supplier.reprice(hotel, rate, hotelQuery(), signal)).resolves.toMatchObject({
      supplierRateId: rate.supplierRateId,
    });
    const later = new MockHotelSupplier(() => new Date(NOW.getTime() + 3_600_000));
    await expect(later.reprice(hotel, rate, hotelQuery(), signal)).rejects.toBeInstanceOf(
      OfferUnavailableError,
    );
  });

  it('confirms stays idempotently and refuses them after check-in', async () => {
    const [hotel] = await supplier.search(hotelQuery(), signal);
    const rate = hotel?.rates[0];
    if (!hotel || !rate) throw new Error('no rate');
    const request = {
      hotel,
      rate,
      query: hotelQuery(),
      guests: [{ givenNames: 'NGOZI', surname: 'EZE' }],
      contact: { email: 'ngozi@example.com', phone: '+2348012345678' },
      idempotencyKey: 'stay-1',
    };
    const confirmed = await supplier.book(request, signal);
    expect(confirmed.confirmationNumber).toMatch(/^MH[0-9A-Z]{8}$/);
    await expect(supplier.book(request, signal)).resolves.toEqual(confirmed);

    const failing = new MockHotelSupplier(() => NOW);
    failing.failNextBookings = 1;
    await expect(failing.book(request, signal)).rejects.toBeInstanceOf(SupplierUnavailableError);
    const late = new MockHotelSupplier(() => new Date('2026-11-21T00:00:00Z'));
    await expect(late.book(request, signal)).rejects.toBeInstanceOf(OfferUnavailableError);
  });
});
