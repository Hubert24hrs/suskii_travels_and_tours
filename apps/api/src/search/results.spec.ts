import { money } from '@suskii/shared';

import type { PriceBreakdown } from '../pricing/pricing-engine';
import type {
  SupplierFlightOffer,
  SupplierHotel,
  SupplierHotelRate,
} from '../suppliers/supplier.types';

import { queryHash } from './search-store';
import {
  departureWindow,
  filterFlights,
  filterHotels,
  flightFacets,
  hotelFacets,
  paginate,
  sortFlights,
  stopsBucket,
  type PricedFlight,
  type PricedHotel,
} from './results';

const price = (total: number): PriceBreakdown => ({
  currency: 'NGN',
  fare: money(total, 'NGN'),
  taxes: money(0, 'NGN'),
  fees: [],
  discount: null,
  total: money(total, 'NGN'),
  markup: null,
  supplierTotal: money(total, 'NGN'),
  fx: null,
});

const flight = (
  id: string,
  total: number,
  opts: {
    stops?: number;
    duration?: number;
    departs?: string;
    owner?: string;
    refundable?: boolean;
    checked?: number;
  },
): PricedFlight => {
  const slice = {
    origin: {
      code: 'LOS',
      name: null,
      cityName: null,
      countryCode: 'NG',
      timeZone: 'Africa/Lagos',
    },
    destination: {
      code: 'ABV',
      name: null,
      cityName: null,
      countryCode: 'NG',
      timeZone: 'Africa/Lagos',
    },
    departureLocal: opts.departs ?? '2026-11-20T08:00',
    departureUtc: `${opts.departs ?? '2026-11-20T08:00'}:00.000Z`,
    arrivalLocal: '2026-11-20T09:15',
    arrivalUtc: '2026-11-20T09:15:00.000Z',
    durationMinutes: opts.duration ?? 75,
    stops: opts.stops ?? 0,
    arrivalDayOffset: 0,
    fareBrand: null,
    segments: [],
    layovers: [],
  };
  const offer = {
    supplier: 'mock',
    supplierOfferId: id,
    owner: { code: opts.owner ?? 'P4', name: opts.owner ?? 'P4' },
    slices: [slice],
    baggage: { carryOn: 1, checked: opts.checked ?? 1 },
    conditions: {
      refundable: opts.refundable ?? false,
      refundPenalty: null,
      changeable: true,
      changePenalty: null,
    },
    cabinClass: 'economy',
    passengers: { adults: 1, children: 0, infants: 0 },
    price: { base: money(total, 'NGN'), taxes: money(0, 'NGN') },
    expiresAt: '2030-01-01T00:00:00.000Z',
    hold: { available: false, paymentRequiredBy: null },
    services: [],
  } as SupplierFlightOffer;
  return { id, offer, price: price(total) };
};

const items = [
  flight('a', 100_000, { stops: 1, duration: 300, departs: '2026-11-20T06:00', owner: 'QI' }),
  flight('b', 150_000, {
    stops: 0,
    duration: 75,
    departs: '2026-11-20T13:00',
    owner: 'P4',
    refundable: true,
  }),
  flight('c', 90_000, {
    stops: 2,
    duration: 600,
    departs: '2026-11-20T02:00',
    owner: 'W3',
    checked: 0,
  }),
];

describe('flight results', () => {
  it('buckets departure windows and stops', () => {
    expect(
      ['2026-11-20T04:59', '2026-11-20T05:00', '2026-11-20T12:00', '2026-11-20T18:00'].map(
        departureWindow,
      ),
    ).toEqual(['night', 'morning', 'afternoon', 'evening']);
    expect(stopsBucket(flight('x', 1, { stops: 3 }).offer)).toBe(2);
  });

  it('sorts by price, duration, departure and a balanced best score', () => {
    expect(sortFlights(items, 'cheapest').map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(sortFlights(items, 'fastest').map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(sortFlights(items, 'earliest').map((i) => i.id)).toEqual(['c', 'a', 'b']);
    // The direct 75-minute flight wins "best" despite costing more.
    expect(sortFlights(items, 'best')[0]?.id).toBe('b');
  });

  it('filters on every spec dimension', () => {
    const ids = (filters: Parameters<typeof filterFlights>[1]) =>
      filterFlights(items, filters).map((i) => i.id);
    expect(ids({ stops: ['0', '1'] })).toEqual(['a', 'b']);
    expect(ids({ airlines: ['W3'] })).toEqual(['c']);
    expect(ids({ maxPrice: 100_000 })).toEqual(['a', 'c']);
    expect(ids({ maxDurationMinutes: 300 })).toEqual(['a', 'b']);
    expect(ids({ departureWindows: ['night'] })).toEqual(['c']);
    expect(ids({ refundable: true })).toEqual(['b']);
    expect(ids({ checkedBag: true })).toEqual(['a', 'b']);
  });

  it('computes facets with the cheapest price per bucket', () => {
    const facets = flightFacets(items);
    expect(facets.stops.map((s) => [s.stops, s.count, s.minPrice.minor])).toEqual([
      [0, 1, 150_000n],
      [1, 1, 100_000n],
      [2, 1, 90_000n],
    ]);
    expect(facets.airlines[0]?.code).toBe('W3');
    expect(facets.price).toEqual({ min: money(90_000, 'NGN'), max: money(150_000, 'NGN') });
    expect(facets.refundable).toBe(1);
    expect(facets.withCheckedBag).toBe(2);
    expect(flightFacets([]).price).toBeNull();
  });
});

describe('paginate and queryHash', () => {
  it('pages with opaque cursors and ignores garbage cursors', () => {
    const list = Array.from({ length: 7 }, (_, i) => i);
    const first = paginate(list, undefined, 3);
    expect(first.page).toEqual([0, 1, 2]);
    const second = paginate(list, first.nextCursor ?? undefined, 3);
    expect(second.page).toEqual([3, 4, 5]);
    expect(paginate(list, second.nextCursor ?? undefined, 3)).toEqual({
      page: [6],
      nextCursor: null,
    });
    expect(paginate(list, 'not-a-cursor', 3).page).toEqual([0, 1, 2]);
  });

  it('hashes queries independently of key order', () => {
    expect(queryHash({ a: 1, b: [{ y: 2, x: 1 }] })).toBe(queryHash({ b: [{ x: 1, y: 2 }], a: 1 }));
    expect(queryHash({ a: 1 })).not.toBe(queryHash({ a: 2 }));
  });
});

describe('hotel results', () => {
  const rate = (total: number, refundable: boolean): SupplierHotelRate => ({
    supplierRateId: `rate-${total}`,
    roomName: 'Deluxe',
    board: 'room_only',
    refundable,
    freeCancellationUntil: null,
    price: { base: money(total, 'NGN'), taxes: money(0, 'NGN') },
    payAtProperty: null,
    expiresAt: '2026-12-01T00:00:00Z',
  });
  const hotel = (id: string, area: string | null, reviewScore: number): PricedHotel => {
    const rates = [{ id: `${id}.r0`, rate: rate(50_000, true), price: price(50_000) }];
    const supplierHotel = {
      supplier: 'mock',
      supplierHotelId: id,
      name: id,
      stars: 4,
      reviewScore,
      reviewCount: 10,
      latitude: 6.4,
      longitude: 3.4,
      area,
      cityName: 'Lagos',
      countryCode: 'NG',
      amenities: ['wifi'],
      rates: rates.map((entry) => entry.rate),
    } satisfies SupplierHotel;
    return { id, hotel: supplierHotel, rates, cheapest: rates[0] as PricedHotel['cheapest'] };
  };
  const items = [
    hotel('a', 'Victoria Island', 8.8),
    hotel('b', 'Ikeja', 7.1),
    hotel('c', 'Victoria Island', 9.2),
    hotel('d', null, 9.5),
  ];

  it('filters by area and minimum rating', () => {
    expect(filterHotels(items, { areas: ['Victoria Island'] }).map((item) => item.id)).toEqual([
      'a',
      'c',
    ]);
    expect(
      filterHotels(items, { areas: ['Victoria Island', 'Ikeja'], minRating: 8 }).map(
        (item) => item.id,
      ),
    ).toEqual(['a', 'c']);
  });

  it('counts areas in the facets, most common first', () => {
    expect(hotelFacets(items).areas).toEqual([
      { area: 'Victoria Island', count: 2 },
      { area: 'Ikeja', count: 1 },
    ]);
  });
});
