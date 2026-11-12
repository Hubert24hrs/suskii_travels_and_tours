import { createHash } from 'node:crypto';

import { money } from '@suskii/shared';

import {
  OfferUnavailableError,
  SupplierAmbiguousError,
  SupplierRequestError,
  SupplierTimeoutError,
  SupplierUnavailableError,
} from '../supplier.errors';
import type { HotelBookingRequest, HotelSearchQuery, SupplierHotel } from '../supplier.types';

import {
  HotelbedsHotelSupplier,
  hotelbedsClientReference,
  hotelbedsStars,
} from './hotelbeds-hotel-supplier';
import { HotelbedsClient, hotelbedsSignature } from './hotelbeds.client';

// Shaped after the Hotelbeds APItude types in `hotelbeds.ts` (generated from the Hotelbeds
// OpenAPI) and `@otaip/adapter-hotelbeds` (written against the sandbox). Not captured live.
const FUTURE_PENALTY = '2099-11-18T23:59:00+01:00';
const NOW_SECONDS = 1_793_102_400;

const hbRate = (rateKey: string, overrides: Record<string, unknown> = {}) => ({
  rateKey,
  rateClass: 'NOR',
  rateType: 'BOOKABLE',
  net: '312.40',
  allotment: 5,
  paymentType: 'AT_WEB',
  packaging: false,
  boardCode: 'BB',
  boardName: 'BED AND BREAKFAST',
  cancellationPolicies: [{ amount: '104.13', from: FUTURE_PENALTY }],
  taxes: {
    allIncluded: false,
    taxes: [
      { included: true, amount: '22.40', currency: 'EUR' },
      {
        included: false,
        amount: '6.00',
        currency: 'EUR',
        clientAmount: '6.50',
        clientCurrency: 'USD',
      },
    ],
  },
  rooms: 1,
  adults: 2,
  children: 1,
  childrenAges: '7',
  ...overrides,
});

const hbHotel = (code: number, overrides: Record<string, unknown> = {}) => ({
  code,
  name: 'Eko Waterfront Hotel',
  categoryCode: '4EST',
  categoryName: '4 STARS',
  destinationCode: 'LOS',
  destinationName: 'Lagos',
  zoneCode: 1,
  zoneName: 'Victoria Island',
  latitude: '6.4281',
  longitude: '3.4219',
  currency: 'EUR',
  minRate: '312.40',
  maxRate: '480.00',
  rooms: [{ code: 'DBL.ST', name: 'DOUBLE STANDARD', rates: [hbRate('rk_bookable')] }],
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
  checkIn: '2099-11-20',
  checkOut: '2099-11-23',
  rooms: [{ adults: 2, childAges: [7] }],
  freeCancellationOnly: false,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: url instanceof Request ? url.url : url.toString(),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = responses.shift();
    if (next instanceof Error) return Promise.reject(next);
    return next ? Promise.resolve(next) : Promise.reject(new Error('unexpected call'));
  }) as typeof fetch;
  return { fn, calls };
}

const supplierWith = (fetchImpl: typeof fetch) =>
  new HotelbedsHotelSupplier(
    new HotelbedsClient({
      baseUrl: 'https://api.hotelbeds.test',
      apiKey: 'hb_key',
      secret: 'hb_secret',
      fetch: fetchImpl,
      now: () => NOW_SECONDS,
    }),
    20,
  );

const signal = new AbortController().signal;

describe('HotelbedsHotelSupplier', () => {
  it('signs each request and searches a circle around the city for pay-now rates', async () => {
    const { fn, calls } = fakeFetch(json(200, { hotels: { hotels: [hbHotel(1001)], total: 1 } }));
    const supplier = supplierWith(fn);
    const hotels = await supplier.search(query, signal);

    expect(supplier.idempotentBooking).toBe(false);
    const call = calls[0];
    expect(call).toMatchObject({
      url: 'https://api.hotelbeds.test/hotel-api/1.0/hotels',
      method: 'POST',
    });
    expect(call?.headers.get('Api-key')).toBe('hb_key');
    expect(call?.headers.get('X-Signature')).toBe(
      createHash('sha256').update(`hb_keyhb_secret${NOW_SECONDS}`).digest('hex'),
    );
    expect(call?.headers.get('X-Signature')).toBe(
      hotelbedsSignature('hb_key', 'hb_secret', NOW_SECONDS),
    );
    expect(call?.headers.get('Accept')).toBe('application/json');
    expect(call?.body).toEqual({
      stay: { checkIn: '2099-11-20', checkOut: '2099-11-23' },
      occupancies: [{ rooms: 1, adults: 2, children: 1, paxes: [{ type: 'CH', age: 7 }] }],
      geolocation: { latitude: 6.5244, longitude: 3.3792, radius: 20, unit: 'km' },
      filter: { paymentType: 'AT_WEB' },
    });
    expect(hotels).toHaveLength(1);
    expect(hotels[0]).toMatchObject({
      supplier: 'hotelbeds',
      supplierHotelId: '1001',
      name: 'Eko Waterfront Hotel',
      stars: 4,
      reviewScore: null,
      reviewCount: 0,
      latitude: 6.4281,
      longitude: 3.4219,
      area: 'Victoria Island',
      cityName: 'Lagos',
      countryCode: 'NG',
      amenities: [],
    });
    expect(hotels[0]?.ratesComplete).toBeUndefined();
    const [rate] = hotels[0]?.rates ?? [];
    expect(rate).toMatchObject({
      supplierRateId: 'rk_bookable',
      roomName: 'DOUBLE STANDARD (bed and breakfast)',
      board: 'breakfast_included',
      refundable: true,
      // A minute before the first penalty.
      freeCancellationUntil: '2099-11-18T22:58:00.000Z',
      // Net 312.40 EUR: 22.40 of included taxes, the rest base.
      price: { base: money(29_000n, 'EUR'), taxes: money(2_240n, 'EUR') },
      // Taxes not included are paid at the property, in the client currency when given.
      payAtProperty: money(650n, 'USD'),
    });
    expect(Date.parse(rate?.expiresAt ?? '')).toBeGreaterThan(Date.now());
  });

  it('accepts numeric amounts and leaves out rates and hotels it cannot sell', async () => {
    const rooms = [
      {
        code: 'DBL.ST',
        name: 'DOUBLE STANDARD',
        rates: [
          hbRate('rk_numeric', { net: 280.5, taxes: undefined, cancellationPolicies: [] }),
          hbRate('rk_at_hotel', { paymentType: 'AT_HOTEL' }),
          hbRate('rk_odd_board', { boardCode: 'XX' }),
          hbRate('rk_two_rooms', { rooms: 2 }),
          hbRate('rk_nrf', { rateClass: 'NRF', boardCode: 'RO' }),
          { rateKey: 'rk_broken' },
        ],
      },
    ];
    const { fn } = fakeFetch(
      json(200, {
        hotels: {
          hotels: [
            hbHotel(1002, { rooms }),
            { code: 'not-a-code' },
            hbHotel(1003, { currency: undefined }),
            hbHotel(1004, {
              rooms: [{ code: 'X', rates: [hbRate('rk_x', { paymentType: 'AT_HOTEL' })] }],
            }),
          ],
        },
      }),
    );
    const hotels = await supplierWith(fn).search(query, signal);

    expect(hotels.map((hotel) => hotel.supplierHotelId)).toEqual(['1002']);
    expect(hotels[0]?.rates.map((rate) => rate.supplierRateId)).toEqual(['rk_numeric', 'rk_nrf']);
    expect(hotels[0]?.rates[0]).toMatchObject({
      price: { base: money(28_050n, 'EUR'), taxes: money(0n, 'EUR') },
      payAtProperty: null,
      // No penalty schedule: not sold as free cancellation.
      refundable: false,
      freeCancellationUntil: null,
    });
    expect(hotels[0]?.rates[1]).toMatchObject({ board: 'room_only', refundable: false });
  });

  it('keeps only free-cancellation rates when asked', async () => {
    const rooms = [
      {
        code: 'DBL',
        name: 'DOUBLE',
        rates: [hbRate('rk_free'), hbRate('rk_nrf', { rateClass: 'NRF' })],
      },
    ];
    const { fn } = fakeFetch(
      json(200, {
        hotels: {
          hotels: [
            hbHotel(1005, { rooms }),
            hbHotel(1006, {
              rooms: [{ code: 'D', rates: [hbRate('rk_only_nrf', { rateClass: 'NRF' })] }],
            }),
          ],
        },
      }),
    );
    const hotels = await supplierWith(fn).search({ ...query, freeCancellationOnly: true }, signal);

    expect(hotels.map((hotel) => hotel.supplierHotelId)).toEqual(['1005']);
    expect(hotels[0]?.rates.map((rate) => rate.supplierRateId)).toEqual(['rk_free']);
  });

  it('searches nothing without coordinates or for rooms Hotelbeds cannot price as one', async () => {
    const { fn, calls } = fakeFetch();
    const supplier = supplierWith(fn);

    await expect(
      supplier.search(
        { ...query, city: { ...query.city, latitude: null, longitude: null } },
        signal,
      ),
    ).resolves.toEqual([]);
    await expect(
      supplier.search(
        {
          ...query,
          rooms: [
            { adults: 2, childAges: [] },
            { adults: 1, childAges: [] },
          ],
        },
        signal,
      ),
    ).resolves.toEqual([]);
    await expect(
      supplier.search(
        {
          ...query,
          rooms: [
            { adults: 2, childAges: [5] },
            { adults: 2, childAges: [5] },
          ],
        },
        signal,
      ),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('prices alike rooms as one occupancy', async () => {
    const { fn, calls } = fakeFetch(
      json(200, {
        hotels: {
          hotels: [
            hbHotel(1007, {
              rooms: [{ code: 'D', name: 'DOUBLE', rates: [hbRate('rk_2', { rooms: 2 })] }],
            }),
          ],
        },
      }),
    );
    const hotels = await supplierWith(fn).search(
      {
        ...query,
        rooms: [
          { adults: 2, childAges: [] },
          { adults: 2, childAges: [] },
        ],
      },
      signal,
    );

    expect(calls[0]?.body).toMatchObject({ occupancies: [{ rooms: 2, adults: 2, children: 0 }] });
    expect((calls[0]?.body as { occupancies: object[] }).occupancies[0]).not.toHaveProperty(
      'paxes',
    );
    expect(hotels[0]?.rates.map((rate) => rate.supplierRateId)).toEqual(['rk_2']);
  });

  describe('reprice', () => {
    const hotel = { supplier: 'hotelbeds', supplierHotelId: '1001' } as SupplierHotel;
    const searched = {
      supplierRateId: 'rk_recheck',
      roomName: 'DOUBLE STANDARD',
    } as SupplierHotel['rates'][number];

    it('confirms the rate with checkrates and returns its current price and key', async () => {
      const { fn, calls } = fakeFetch(
        json(200, {
          hotel: {
            code: 1001,
            currency: 'EUR',
            rooms: [
              {
                code: 'DBL.ST',
                name: 'DOUBLE STANDARD',
                rates: [
                  hbRate('rk_checked', { net: '330.00', rateType: 'BOOKABLE', taxes: undefined }),
                ],
              },
            ],
          },
        }),
      );
      const fresh = await supplierWith(fn).reprice(hotel, searched, query, signal);

      expect(calls[0]).toMatchObject({
        url: 'https://api.hotelbeds.test/hotel-api/1.0/checkrates',
        method: 'POST',
        body: { rooms: [{ rateKey: 'rk_recheck' }] },
      });
      expect(fresh).toMatchObject({
        supplierRateId: 'rk_checked',
        price: { base: money(33_000n, 'EUR'), taxes: money(0n, 'EUR') },
      });
    });

    it('says the offer is gone when the check returns no sellable rate', async () => {
      const { fn } = fakeFetch(json(200, { hotel: { code: 1001, currency: 'EUR', rooms: [] } }));
      await expect(supplierWith(fn).reprice(hotel, searched, query, signal)).rejects.toBeInstanceOf(
        OfferUnavailableError,
      );
    });
  });

  describe('book', () => {
    const request = {
      hotel: { supplier: 'hotelbeds', supplierHotelId: '1001' },
      rate: { supplierRateId: 'rk_checked' },
      query,
      guests: [{ givenNames: 'ADA', surname: 'OKAFOR' }],
      contact: { email: 'ada@example.com', phone: '+2348012345678' },
      idempotencyKey: '0192d3a0-7c1e-7b2a-9f00-00000000b001',
    } as unknown as HotelBookingRequest;

    it('books with the lead guest, a client reference and no price tolerance', async () => {
      const { fn, calls } = fakeFetch(
        json(200, {
          booking: {
            reference: '102-3087550',
            status: 'CONFIRMED',
            totalNet: '330.00',
            currency: 'EUR',
          },
        }),
      );
      const result = await supplierWith(fn).book(request, signal);

      expect(result).toEqual({ confirmationNumber: '102-3087550' });
      expect(calls[0]).toMatchObject({
        url: 'https://api.hotelbeds.test/hotel-api/1.0/bookings',
        method: 'POST',
        body: {
          holder: { name: 'ADA', surname: 'OKAFOR' },
          rooms: [
            {
              rateKey: 'rk_checked',
              paxes: [{ roomId: 1, type: 'AD', name: 'ADA', surname: 'OKAFOR' }],
            },
          ],
          clientReference: '0192d3a07c1e7b2a9f00',
          tolerance: 0,
        },
      });
      // Contact details stay with Suskii.
      expect(JSON.stringify(calls[0]?.body)).not.toContain('ada@example.com');
    });

    it('sends anything but a confirmed booking to review', async () => {
      const { fn } = fakeFetch(
        json(200, { booking: { reference: '102-3087551', status: 'PRECONFIRMED' } }),
      );
      await expect(supplierWith(fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierAmbiguousError,
      );
    });

    it('treats a failed booking call as unclear, but keeps a refusal a refusal', async () => {
      const failed = fakeFetch(new Response('<html>bad gateway</html>', { status: 502 }));
      await expect(supplierWith(failed.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierAmbiguousError,
      );
      const lost = fakeFetch(new TypeError('fetch failed'));
      await expect(supplierWith(lost.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierAmbiguousError,
      );
      const refused = fakeFetch(json(400, { error: { code: 'INVALID_DATA', message: 'Bad' } }));
      await expect(supplierWith(refused.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierRequestError,
      );
    });
  });

  describe('errors', () => {
    const run = (response: Response | Error) =>
      supplierWith(fakeFetch(response).fn).search(query, signal);

    it('maps statuses and error bodies to supplier errors', async () => {
      await expect(
        run(json(401, { error: { code: 'AUTH', message: 'Invalid key' } })),
      ).rejects.toBeInstanceOf(SupplierRequestError);
      await expect(run(json(503, {}))).rejects.toBeInstanceOf(SupplierUnavailableError);
      await expect(run(json(429, { error: { code: 'QUOTA' } }))).rejects.toBeInstanceOf(
        SupplierUnavailableError,
      );
      await expect(
        run(json(400, { error: { code: 'INVALID_DATA', message: 'Bad stay' } })),
      ).rejects.toBeInstanceOf(SupplierRequestError);
      // An error body on a 200 is still an error.
      await expect(
        run(json(200, { error: { code: 'PRODUCT_ERROR', message: 'Insufficient allotment' } })),
      ).rejects.toBeInstanceOf(OfferUnavailableError);
      await expect(
        run(new Response('<html>bad gateway</html>', { status: 200 })),
      ).rejects.toBeInstanceOf(SupplierUnavailableError);
      await expect(run(new Response('<html>down</html>', { status: 502 }))).rejects.toBeInstanceOf(
        SupplierUnavailableError,
      );
    });

    it('maps network failures and aborts', async () => {
      await expect(run(new TypeError('fetch failed'))).rejects.toBeInstanceOf(
        SupplierUnavailableError,
      );
      const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
      await expect(run(aborted)).rejects.toBeInstanceOf(SupplierTimeoutError);
    });

    it('never puts the key or secret in an error', async () => {
      const error = await run(json(401, { error: { code: 'AUTH' } })).catch(
        (caught: unknown) => caught,
      );
      expect(String((error as Error).message)).not.toMatch(/hb_key|hb_secret/);
    });
  });
});

describe('Hotelbeds helpers', () => {
  it('reads stars from category codes', () => {
    expect(hotelbedsStars('4EST')).toBe(4);
    expect(hotelbedsStars('5LUJ')).toBe(5);
    expect(hotelbedsStars('HS3')).toBe(0);
    expect(hotelbedsStars(undefined)).toBe(0);
  });

  it('makes a 20-character client reference from the booking item id', () => {
    expect(hotelbedsClientReference('0192d3a0-7c1e-7b2a-9f00-00000000b001')).toBe(
      '0192d3a07c1e7b2a9f00',
    );
    expect(hotelbedsClientReference('short-id')).toBe('shortid');
  });
});
