import { money } from '@suskii/shared';

import {
  OfferUnavailableError,
  SupplierAmbiguousError,
  SupplierRequestError,
  SupplierUnavailableError,
} from '../supplier.errors';
import type { HotelBookingRequest, HotelSearchQuery, SupplierHotel } from '../supplier.types';

import { DuffelHotelSupplier } from './duffel-hotel-supplier';
import { DuffelClient } from './duffel.client';

// Shaped after the Stays types in Duffel's official SDK (`@duffel/api`, StaysTypes): search
// results, rates, quotes and bookings. Not captured from the live API.
const FUTURE = '2099-01-01T00:00:00Z';

const duffelRate = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  total_amount: '420.00',
  total_currency: 'USD',
  base_amount: '360.00',
  base_currency: 'USD',
  tax_amount: '45.00',
  tax_currency: 'USD',
  fee_amount: '15.00',
  fee_currency: 'USD',
  due_at_accommodation_amount: '12.50',
  due_at_accommodation_currency: 'USD',
  board_type: 'breakfast',
  cancellation_timeline: [{ refund_amount: '420.00', before: FUTURE, currency: 'USD' }],
  conditions: [],
  payment_type: 'pay_now',
  available_payment_methods: ['balance', 'card'],
  supported_loyalty_programme: null,
  loyalty_programme_required: false,
  source: 'duffel',
  expires_at: '2099-01-01T00:30:00Z',
  ...overrides,
});

const accommodation = (overrides: Record<string, unknown> = {}) => ({
  id: 'acc_0000AWr2VsUNIF1Vl91xg0',
  name: 'Eko Waterfront Hotel',
  rating: 4,
  review_score: 8.6,
  review_count: 336,
  amenities: [
    { type: 'wifi', description: 'Free Wi-Fi' },
    { type: 'pool', description: 'Outdoor pool' },
    { type: '24_hour_front_desk', description: '24-hour front desk' },
    { type: 'pets_allowed', description: 'Pets allowed' },
  ],
  location: {
    address: {
      city_name: 'Lagos',
      country_code: 'NG',
      line_one: '1 Ahmadu Bello Way',
      postal_code: '101241',
    },
    geographic_coordinates: { latitude: 6.4281, longitude: 3.4219 },
  },
  rooms: [],
  ...overrides,
});

const searchResult = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  check_in_date: '2026-11-20',
  check_out_date: '2026-11-23',
  accommodation: accommodation(),
  rooms: 1,
  guests: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 7 }],
  cheapest_rate_total_amount: '390.00',
  cheapest_rate_currency: 'USD',
  cheapest_rate_base_amount: '330.00',
  cheapest_rate_base_currency: 'USD',
  cheapest_rate_due_at_accommodation_amount: '0.00',
  cheapest_rate_due_at_accommodation_currency: 'USD',
  expires_at: '2099-01-01T00:30:00Z',
  ...overrides,
});

const query: HotelSearchQuery = {
  city: {
    id: 'city_lagos',
    name: 'Lagos',
    countryCode: 'NG',
    latitude: 6.5244,
    longitude: 3.3792,
    timeZone: 'Africa/Lagos',
  },
  checkIn: '2026-11-20',
  checkOut: '2026-11-23',
  rooms: [{ adults: 2, childAges: [7] }],
  freeCancellationOnly: false,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function fakeFetch(...responses: Response[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: url instanceof Request ? url.url : url.toString(),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = responses.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error('unexpected call'));
  }) as typeof fetch;
  return { fn, calls };
}

const supplierWith = (fetchImpl: typeof fetch) =>
  new DuffelHotelSupplier(
    new DuffelClient({
      baseUrl: 'https://api.duffel.test',
      token: 'duffel_test_secret',
      fetch: fetchImpl,
    }),
  );

const signal = new AbortController().signal;

describe('DuffelHotelSupplier', () => {
  it('searches around the city and lists each hotel at its cheapest price', async () => {
    const { fn, calls } = fakeFetch(
      json(200, {
        data: {
          results: [searchResult('srr_1'), { id: 'srr_broken', accommodation: {} }],
          created_at: '2026-10-26T10:00:00Z',
        },
      }),
    );
    const supplier = supplierWith(fn);
    const [hotel, ...rest] = await supplier.search(query, signal);

    expect(supplier.idempotentBooking).toBe(false);
    expect(rest).toEqual([]);
    expect(calls[0]).toMatchObject({ url: 'https://api.duffel.test/stays/search', method: 'POST' });
    expect(calls[0]?.body).toEqual({
      data: {
        rooms: 1,
        guests: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 7 }],
        check_in_date: '2026-11-20',
        check_out_date: '2026-11-23',
        location: { radius: 10, geographic_coordinates: { latitude: 6.5244, longitude: 3.3792 } },
        free_cancellation_only: false,
      },
    });
    expect(hotel).toMatchObject({
      supplier: 'duffel',
      supplierHotelId: 'acc_0000AWr2VsUNIF1Vl91xg0',
      supplierResultId: 'srr_1',
      ratesComplete: false,
      name: 'Eko Waterfront Hotel',
      stars: 4,
      reviewScore: 8.6,
      reviewCount: 336,
      latitude: 6.4281,
      longitude: 3.4219,
      cityName: 'Lagos',
      countryCode: 'NG',
      amenities: ['wifi', 'pool', '24h_front_desk'],
    });
    expect(hotel?.rates).toEqual([
      {
        supplierRateId: 'cheapest:srr_1',
        roomName: 'Cheapest available room',
        board: 'room_only',
        refundable: false,
        freeCancellationUntil: null,
        price: { base: money(33_000n, 'USD'), taxes: money(6_000n, 'USD') },
        payAtProperty: null,
        expiresAt: '2099-01-01T00:30:00.000Z',
      },
    ]);
  });

  it('uses rates a search result carries and leaves out the ones we cannot sell', async () => {
    const rooms = [
      {
        name: 'Deluxe King',
        rates: [
          duffelRate('rat_paid'),
          duffelRate('rat_at_hotel', { payment_type: 'guarantee' }),
          duffelRate('rat_deposit', { payment_type: 'deposit' }),
          duffelRate('rat_card_only', { available_payment_methods: ['card'] }),
          duffelRate('rat_members', { loyalty_programme_required: true }),
          duffelRate('rat_odd_board', { board_type: 'space_food' }),
          { id: 'rat_broken' },
        ],
      },
    ];
    const { fn } = fakeFetch(
      json(200, {
        data: { results: [searchResult('srr_2', { accommodation: accommodation({ rooms }) })] },
      }),
    );
    const [hotel] = await supplierWith(fn).search(query, signal);
    expect(hotel?.rates.map((rate) => rate.supplierRateId)).toEqual(['rat_paid']);
  });

  it('refuses a city without coordinates instead of searching blind', async () => {
    const { fn, calls } = fakeFetch();
    await expect(
      supplierWith(fn).search({ ...query, city: { ...query.city, latitude: null } }, signal),
    ).rejects.toBeInstanceOf(SupplierRequestError);
    expect(calls).toEqual([]);
  });

  it('loads every rate of a hotel, with boards, free cancellation and fees mapped', async () => {
    const rooms = [
      {
        name: 'Deluxe King',
        rates: [
          duffelRate('rat_free'),
          duffelRate('rat_partial', {
            board_type: 'all_inclusive',
            total_amount: '380.00',
            cancellation_timeline: [{ refund_amount: '190.00', before: FUTURE, currency: 'USD' }],
            due_at_accommodation_amount: null,
          }),
        ],
      },
      {
        name: 'Twin Room',
        rates: [
          duffelRate('rat_past_deadline', {
            board_type: 'room_only',
            cancellation_timeline: [
              { refund_amount: '420.00', before: '2020-01-01T00:00:00Z', currency: 'USD' },
            ],
          }),
        ],
      },
    ];
    const { fn, calls } = fakeFetch(
      json(200, { data: searchResult('srr_3', { accommodation: accommodation({ rooms }) }) }),
    );
    const hotel = { supplierResultId: 'srr_3', rates: [] } as unknown as SupplierHotel;
    const rates = await supplierWith(fn).rates(hotel, query, signal);

    expect(calls[0]).toMatchObject({
      url: 'https://api.duffel.test/stays/search_results/srr_3/actions/fetch_all_rates',
      method: 'POST',
    });
    expect(rates).toEqual([
      {
        supplierRateId: 'rat_free',
        roomName: 'Deluxe King',
        board: 'breakfast_included',
        refundable: true,
        freeCancellationUntil: '2099-01-01T00:00:00.000Z',
        price: { base: money(36_000n, 'USD'), taxes: money(6_000n, 'USD') },
        payAtProperty: money(1_250n, 'USD'),
        expiresAt: '2099-01-01T00:30:00.000Z',
      },
      expect.objectContaining({
        supplierRateId: 'rat_partial',
        board: 'full_board',
        refundable: false,
        freeCancellationUntil: null,
        payAtProperty: null,
      }),
      expect.objectContaining({
        supplierRateId: 'rat_past_deadline',
        roomName: 'Twin Room',
        board: 'room_only',
        refundable: false,
      }),
    ]);

    const free = fakeFetch(
      json(200, { data: searchResult('srr_3', { accommodation: accommodation({ rooms }) }) }),
    );
    const onlyFree = await supplierWith(free.fn).rates(
      hotel,
      { ...query, freeCancellationOnly: true },
      signal,
    );
    expect(onlyFree.map((rate) => rate.supplierRateId)).toEqual(['rat_free']);
  });

  it('confirms a rate with a quote and takes the quoted price', async () => {
    const { fn, calls } = fakeFetch(
      json(201, {
        data: {
          id: 'quo_1',
          total_amount: '430.00',
          total_currency: 'USD',
          tax_amount: '47.00',
          tax_currency: 'USD',
          fee_amount: '15.00',
          fee_currency: 'USD',
          due_at_accommodation_amount: null,
          due_at_accommodation_currency: 'USD',
        },
      }),
    );
    const supplier = supplierWith(fn);
    const hotelFetch = fakeFetch(
      json(200, {
        data: searchResult('srr_4', {
          accommodation: accommodation({
            rooms: [{ name: 'Deluxe King', rates: [duffelRate('rat_1')] }],
          }),
        }),
      }),
    );
    const [known] = await supplierWith(hotelFetch.fn).rates(
      { supplierResultId: 'srr_4' } as SupplierHotel,
      query,
      signal,
    );
    const fresh = await supplier.reprice({} as SupplierHotel, known!, query, signal);

    expect(calls[0]).toMatchObject({ url: 'https://api.duffel.test/stays/quotes', method: 'POST' });
    expect(calls[0]?.body).toEqual({ data: { rate_id: 'rat_1' } });
    expect(fresh).toMatchObject({
      supplierRateId: 'rat_1',
      roomName: 'Deluxe King',
      price: { base: money(36_800n, 'USD'), taxes: money(6_200n, 'USD') },
      payAtProperty: null,
    });
  });

  it('turns the cheapest stand-in into the cheapest real rate before quoting it', async () => {
    const rooms = [
      { name: 'Suite', rates: [duffelRate('rat_dear', { total_amount: '900.00' })] },
      { name: 'Standard', rates: [duffelRate('rat_cheap', { total_amount: '395.00' })] },
    ];
    const { fn, calls } = fakeFetch(
      json(200, { data: searchResult('srr_5', { accommodation: accommodation({ rooms }) }) }),
      json(201, { data: { id: 'quo_2', total_amount: '395.00', total_currency: 'USD' } }),
    );
    const supplier = supplierWith(fn);
    const search = fakeFetch(json(200, { data: { results: [searchResult('srr_5')] } }));
    const [hotel] = await supplierWith(search.fn).search(query, signal);

    const fresh = await supplier.reprice(hotel!, hotel!.rates[0]!, query, signal);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.duffel.test/stays/search_results/srr_5/actions/fetch_all_rates',
      'https://api.duffel.test/stays/quotes',
    ]);
    expect(calls[1]?.body).toEqual({ data: { rate_id: 'rat_cheap' } });
    expect(fresh).toMatchObject({ supplierRateId: 'rat_cheap', roomName: 'Standard' });
    expect(fresh.price).toEqual({ base: money(39_500n, 'USD'), taxes: money(0n, 'USD') });
  });

  it('answers "sold out" when no bookable rate is left behind the stand-in', async () => {
    const { fn } = fakeFetch(
      json(200, {
        data: searchResult('srr_6', {
          accommodation: accommodation({
            rooms: [
              { name: 'Suite', rates: [duffelRate('rat_hotel', { payment_type: 'guarantee' })] },
            ],
          }),
        }),
      }),
    );
    const search = fakeFetch(json(200, { data: { results: [searchResult('srr_6')] } }));
    const [hotel] = await supplierWith(search.fn).search(query, signal);
    await expect(
      supplierWith(fn).reprice(hotel!, hotel!.rates[0]!, query, signal),
    ).rejects.toBeInstanceOf(OfferUnavailableError);
  });

  describe('book', () => {
    const paidRate = {
      supplierRateId: 'rat_1',
      roomName: 'Deluxe King',
      board: 'breakfast_included' as const,
      refundable: true,
      freeCancellationUntil: FUTURE,
      price: { base: money(36_000n, 'USD'), taxes: money(6_000n, 'USD') },
      payAtProperty: null,
      expiresAt: FUTURE,
    };
    const request: HotelBookingRequest = {
      hotel: {} as SupplierHotel,
      rate: paidRate,
      query,
      guests: [{ givenNames: 'Adaeze', surname: 'Okafor' }],
      contact: { email: 'adaeze@example.test', phone: '+2348030000000' },
      idempotencyKey: 'bki_0192d3a0',
    };
    const quote = (total: string) =>
      json(201, { data: { id: 'quo_9', total_amount: total, total_currency: 'USD' } });

    it('quotes again, then books from the Duffel balance and returns the reference', async () => {
      const { fn, calls } = fakeFetch(
        quote('420.00'),
        json(201, {
          data: { id: 'bok_1', reference: 'HJK2P4QX', status: 'confirmed', confirmed_at: FUTURE },
        }),
      );
      await expect(supplierWith(fn).book(request, signal)).resolves.toEqual({
        confirmationNumber: 'HJK2P4QX',
      });
      expect(calls[1]).toMatchObject({
        url: 'https://api.duffel.test/stays/bookings',
        method: 'POST',
      });
      expect(calls[1]?.body).toEqual({
        data: {
          quote_id: 'quo_9',
          guests: [{ given_name: 'Adaeze', family_name: 'Okafor' }],
          email: 'adaeze@example.test',
          phone_number: '+2348030000000',
          metadata: { suskii_booking_item: 'bki_0192d3a0' },
        },
      });
    });

    it('refuses to book when the price moved after payment', async () => {
      const { fn, calls } = fakeFetch(quote('455.00'));
      await expect(supplierWith(fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierRequestError,
      );
      expect(calls).toHaveLength(1);
    });

    it('treats a booking that is not confirmed as unclear, for review', async () => {
      const { fn } = fakeFetch(
        quote('420.00'),
        json(201, { data: { id: 'bok_2', reference: null, status: 'requested' } }),
      );
      await expect(supplierWith(fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierAmbiguousError,
      );
    });

    it('treats a failed booking call as unclear, and a failed quote as safe to retry', async () => {
      const failed = fakeFetch(quote('420.00'), json(503, { errors: [] }));
      await expect(supplierWith(failed.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierAmbiguousError,
      );
      const early = fakeFetch(json(503, { errors: [] }));
      await expect(supplierWith(early.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierUnavailableError,
      );
    });

    it('never books the stand-in rate without a quote', async () => {
      const { fn, calls } = fakeFetch();
      await expect(
        supplierWith(fn).book(
          { ...request, rate: { ...paidRate, supplierRateId: 'cheapest:srr_1' } },
          signal,
        ),
      ).rejects.toBeInstanceOf(SupplierRequestError);
      expect(calls).toEqual([]);
    });
  });
});
