import { createHash } from 'node:crypto';

import { money } from '@suskii/shared';

import {
  OfferUnavailableError,
  SupplierAmbiguousError,
  SupplierRequestError,
  SupplierTimeoutError,
  SupplierUnavailableError,
} from '../supplier.errors';
import type {
  HotelBookingRequest,
  HotelSearchQuery,
  SupplierHotel,
  SupplierHotelRate,
} from '../supplier.types';

import {
  ExpediaHotelSupplier,
  expediaAffiliateReference,
  expediaBoard,
  expediaFreeCancellationUntil,
  expediaOccupancy,
  expediaPhone,
  expediaSearchPolygon,
  expediaStayPrice,
} from './expedia-hotel-supplier';
import { ExpediaClient, expediaAuthorization, expediaSignature } from './expedia.client';

// Shaped after the models of Expedia's Rapid Java SDK 5.4.1 (generated from the Rapid OpenAPI
// specification; ADR-086). Not captured live: the sandbox script checks them.
const NOW_SECONDS = 1_793_102_400;
const FUTURE_PENALTY = '2099-11-18T11:00:00.000-08:00';
const PRICE_CHECK = '/v3/properties/19248/rooms/38661/rates/200127420?token=pc_token_1';
const BOOK_LINK = '/v3/itineraries?token=book_token_1';

const totals = (inclusive: string, exclusive: string, propertyFees?: string) => ({
  totals: {
    inclusive: { billable_currency: { value: inclusive, currency: 'USD' } },
    exclusive: { billable_currency: { value: exclusive, currency: 'USD' } },
    ...(propertyFees
      ? { property_fees: { billable_currency: { value: propertyFees, currency: 'USD' } } }
      : {}),
  },
});

const exRate = (overrides: Record<string, unknown> = {}) => ({
  id: '200127420',
  status: 'available',
  refundable: true,
  merchant_of_record: 'expedia',
  amenities: { '2104': { id: '2104', name: 'Free breakfast' } },
  bed_groups: {
    '37321': {
      id: '37321',
      description: '1 King Bed',
      links: { price_check: { method: 'GET', href: PRICE_CHECK, expires: '2099-11-01T00:00:00Z' } },
    },
  },
  cancel_penalties: [{ currency: 'USD', start: FUTURE_PENALTY, amount: '104.13' }],
  occupancy_pricing: { '2-7': totals('312.40', '290.00', '12.00') },
  ...overrides,
});

const exProperty = (id: string, rates: unknown[] = [exRate()]) => ({
  property_id: id,
  status: 'available',
  rooms: [{ id: '38661', room_name: 'Deluxe King', rates }],
});

const exContent = (id: string, overrides: Record<string, unknown> = {}) => ({
  property_id: id,
  name: 'Eko Waterfront Hotel',
  address: { line_1: '1 Adetokunbo Ademola St', city: 'Lagos', country_code: 'NG' },
  ratings: { property: { rating: '4.5', type: 'Star' }, guest: { overall: '4.2', count: 1200 } },
  location: { coordinates: { latitude: 6.4281, longitude: 3.4219 } },
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
  const calls: {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
    redirect: string | undefined;
  }[] = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: url instanceof Request ? url.url : url.toString(),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      redirect: init?.redirect,
    });
    const next = responses.shift();
    if (next instanceof Error) return Promise.reject(next);
    return next ? Promise.resolve(next) : Promise.reject(new Error('unexpected call'));
  }) as typeof fetch;
  return { fn, calls };
}

const clientWith = (fetchImpl: typeof fetch) =>
  new ExpediaClient({
    baseUrl: 'https://api.ean.test',
    apiKey: 'ex_key',
    sharedSecret: 'ex_secret',
    fetch: fetchImpl,
    now: () => NOW_SECONDS,
  });

const supplierWith = (fetchImpl: typeof fetch, options: { maxProperties?: number } = {}) =>
  new ExpediaHotelSupplier(clientWith(fetchImpl), {
    pointOfSale: 'NG',
    requestCurrency: 'USD',
    radiusKm: 20,
    maxProperties: options.maxProperties ?? 250,
    ratesPerProperty: 4,
  });

const signal = new AbortController().signal;

describe('ExpediaClient', () => {
  it('signs with SHA-512 of key, secret and the Unix time', () => {
    const expected = createHash('sha512').update(`ex_keyex_secret${NOW_SECONDS}`).digest('hex');
    expect(expediaSignature('ex_key', 'ex_secret', NOW_SECONDS)).toBe(expected);
    expect(expediaAuthorization('ex_key', 'ex_secret', NOW_SECONDS)).toBe(
      `EAN APIKey=ex_key,Signature=${expected},timestamp=${NOW_SECONDS}`,
    );
  });

  it("sends Rapid's headers, refuses redirects and adds the IP and test header only when given", async () => {
    const { fn, calls } = fakeFetch(json(200, {}), json(200, {}));
    const client = clientWith(fn);
    await client.request({
      method: 'GET',
      path: '/v3/properties/content',
      signal,
      sessionId: 's1',
    });
    await client.request({
      method: 'POST',
      path: BOOK_LINK,
      signal,
      sessionId: 's2',
      customerIp: '102.89.1.10',
      test: 'standard',
      body: { hold: false },
    });

    const [search, book] = calls;
    expect(search?.headers.get('authorization')).toBe(
      expediaAuthorization('ex_key', 'ex_secret', NOW_SECONDS),
    );
    expect(search?.headers.get('customer-session-id')).toBe('s1');
    expect(search?.headers.get('accept-encoding')).toBe('gzip');
    expect(search?.headers.has('customer-ip')).toBe(false);
    expect(search?.headers.has('test')).toBe(false);
    expect(search?.redirect).toBe('error');
    expect(book).toMatchObject({ url: `https://api.ean.test${BOOK_LINK}`, body: { hold: false } });
    expect(book?.headers.get('customer-ip')).toBe('102.89.1.10');
    expect(book?.headers.get('test')).toBe('standard');
    expect(book?.headers.get('content-type')).toBe('application/json');
  });

  it('follows links only on its own host and under /v3', () => {
    const client = clientWith(fakeFetch().fn);
    expect(client.url(PRICE_CHECK)).toBe(`https://api.ean.test${PRICE_CHECK}`);
    expect(() => client.url('https://evil.example/v3/itineraries?token=x')).toThrow(
      SupplierRequestError,
    );
    expect(() => client.url('//evil.example/v3/itineraries')).toThrow(SupplierRequestError);
    expect(() => client.url('/v2/itineraries')).toThrow(SupplierRequestError);
  });

  it('maps statuses, network failures and aborts to supplier errors', async () => {
    const run = (response: Response | Error) =>
      clientWith(fakeFetch(response).fn).request({
        method: 'GET',
        path: PRICE_CHECK,
        signal,
        sessionId: 's',
      });
    await expect(run(json(401, { type: 'request_unauthenticated' }))).rejects.toBeInstanceOf(
      SupplierRequestError,
    );
    await expect(run(json(403, {}))).rejects.toBeInstanceOf(SupplierRequestError);
    await expect(run(json(400, { type: 'invalid_input' }))).rejects.toBeInstanceOf(
      SupplierRequestError,
    );
    await expect(run(json(404, {}))).rejects.toBeInstanceOf(OfferUnavailableError);
    await expect(run(json(409, { type: 'price_mismatch' }))).rejects.toBeInstanceOf(
      OfferUnavailableError,
    );
    await expect(run(json(410, {}))).rejects.toBeInstanceOf(OfferUnavailableError);
    await expect(run(json(429, {}))).rejects.toBeInstanceOf(SupplierUnavailableError);
    await expect(run(json(503, { type: 'service_unavailable' }))).rejects.toBeInstanceOf(
      SupplierUnavailableError,
    );
    await expect(run(new Response('<html>ok</html>', { status: 200 }))).rejects.toBeInstanceOf(
      SupplierUnavailableError,
    );
    await expect(run(new TypeError('fetch failed'))).rejects.toBeInstanceOf(
      SupplierUnavailableError,
    );
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(run(aborted)).rejects.toBeInstanceOf(SupplierTimeoutError);
  });

  it('never puts the key, secret or link token in an error', async () => {
    const error = await clientWith(fakeFetch(json(401, { type: 'x' })).fn)
      .request({ method: 'GET', path: PRICE_CHECK, signal, sessionId: 's' })
      .catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toMatch(/ex_key|ex_secret|pc_token_1/);
  });
});

describe('ExpediaHotelSupplier', () => {
  it('finds properties around the city, shops Expedia Collect rates and names them', async () => {
    const { fn, calls } = fakeFetch(
      json(200, { '19248': {}, '29555': {} }),
      json(200, [exProperty('19248'), { property_id: '29555', status: 'available', rooms: [] }]),
      json(200, { '19248': exContent('19248') }),
    );
    const hotels = await supplierWith(fn).search(query, signal);

    const [geography, availability, content] = calls;
    expect(geography).toMatchObject({
      url: 'https://api.ean.test/v3/properties/geography?include=property_ids&supply_source=expedia',
      method: 'POST',
      body: { type: 'Polygon' },
    });
    const ring = (geography?.body as { coordinates: number[][][] }).coordinates[0];
    expect(ring).toHaveLength(17);
    expect(ring?.[0]).toEqual(ring?.[16]);

    const params = new URL(availability?.url ?? '').searchParams;
    expect(new URL(availability?.url ?? '').pathname).toBe('/v3/properties/availability');
    expect(Object.fromEntries(params)).toMatchObject({
      checkin: '2099-11-20',
      checkout: '2099-11-23',
      currency: 'USD',
      country_code: 'NG',
      language: 'en-US',
      rate_plan_count: '4',
      sales_channel: 'website',
      sales_environment: 'hotel_only',
    });
    expect(params.getAll('occupancy')).toEqual(['2-7']);
    expect(params.getAll('property_id')).toEqual(['19248', '29555']);
    expect(params.getAll('filter')).toEqual(['expedia_collect']);
    // Searches never send the traveller's IP.
    expect(availability?.headers.has('customer-ip')).toBe(false);

    // Content only for properties with rates.
    expect(new URL(content?.url ?? '').searchParams.getAll('property_id')).toEqual(['19248']);

    expect(hotels).toEqual([
      {
        supplier: 'expedia',
        supplierHotelId: '19248',
        name: 'Eko Waterfront Hotel',
        stars: 4,
        reviewScore: 8.4,
        reviewCount: 1200,
        latitude: 6.4281,
        longitude: 3.4219,
        area: '1 Adetokunbo Ademola St',
        cityName: 'Lagos',
        countryCode: 'NG',
        amenities: [],
        rates: [
          {
            supplierRateId: PRICE_CHECK,
            roomName: 'Deluxe King (1 King Bed)',
            board: 'breakfast_included',
            refundable: true,
            freeCancellationUntil: new Date(Date.parse(FUTURE_PENALTY) - 60_000).toISOString(),
            price: { base: money(29_000n, 'USD'), taxes: money(2_240n, 'USD') },
            payAtProperty: money(1_200n, 'USD'),
            expiresAt: expect.any(String) as string,
          },
        ],
      },
    ]);
  });

  it('reuses property ids and content for the same city', async () => {
    const { fn, calls } = fakeFetch(
      json(200, { '19248': {} }),
      json(200, [exProperty('19248')]),
      json(200, { '19248': exContent('19248') }),
      json(200, [exProperty('19248')]),
    );
    const supplier = supplierWith(fn);
    await supplier.search(query, signal);
    const again = await supplier.search(query, signal);

    expect(calls).toHaveLength(4);
    expect(calls[3]?.url).toContain('/v3/properties/availability');
    expect(again[0]?.name).toBe('Eko Waterfront Hotel');
  });

  it('asks for refundable rates when free cancellation is required', async () => {
    const lateRate = exRate({
      id: 'late',
      cancel_penalties: [{ start: '2000-01-01T00:00:00Z', amount: '50.00' }],
    });
    const { fn, calls } = fakeFetch(
      json(200, { '19248': {} }),
      json(200, [exProperty('19248', [exRate(), lateRate])]),
      json(200, { '19248': exContent('19248') }),
    );
    const hotels = await supplierWith(fn).search({ ...query, freeCancellationOnly: true }, signal);

    expect(new URL(calls[1]?.url ?? '').searchParams.getAll('filter')).toEqual([
      'expedia_collect',
      'refundable',
    ]);
    // A penalty that already applies means no free cancellation, whatever the flag says.
    expect(hotels[0]?.rates).toHaveLength(1);
    expect(hotels[0]?.rates[0]?.refundable).toBe(true);
  });

  it('leaves out rates it cannot sell and properties without content', async () => {
    const { fn } = fakeFetch(
      json(200, { '19248': {}, '29555': {} }),
      json(200, [
        exProperty('19248', [
          exRate({ merchant_of_record: 'property' }),
          exRate({ occupancy_pricing: { '2': totals('100.00', '90.00') } }),
          exRate({ occupancy_pricing: { '2-7': totals('not-a-number', '90.00') } }),
          exRate({ bed_groups: { '1': { id: '1', description: 'Twin' } } }),
          'not a rate',
        ]),
        exProperty('29555'),
      ]),
      json(200, { '29555': { property_id: '29555' } }),
    );
    await expect(supplierWith(fn).search(query, signal)).resolves.toEqual([]);
  });

  it('searches nothing without coordinates or for more rooms than Rapid books', async () => {
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
        { ...query, rooms: Array.from({ length: 9 }, () => ({ adults: 1, childAges: [] })) },
        signal,
      ),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('shops at most the configured number of properties', async () => {
    const ids = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`p${index}`, {}]));
    const { fn, calls } = fakeFetch(json(200, ids), json(200, []));
    await supplierWith(fn, { maxProperties: 3 }).search(query, signal);
    expect(new URL(calls[1]?.url ?? '').searchParams.getAll('property_id')).toEqual([
      'p0',
      'p1',
      'p2',
    ]);
  });

  describe('reprice', () => {
    const hotel = { supplier: 'expedia', supplierHotelId: '19248' } as SupplierHotel;
    const searched = {
      supplierRateId: PRICE_CHECK,
      roomName: 'Deluxe King (1 King Bed)',
      price: { base: money(29_000n, 'USD'), taxes: money(2_240n, 'USD') },
      payAtProperty: null,
    } as SupplierHotelRate;

    it('checks the price and returns the current one', async () => {
      const { fn, calls } = fakeFetch(
        json(200, {
          status: 'price_changed',
          occupancy_pricing: { '2-7': totals('330.00', '300.00') },
          links: { book: { method: 'POST', href: BOOK_LINK } },
        }),
      );
      const fresh = await supplierWith(fn).reprice(hotel, searched, query, signal);

      expect(calls[0]).toMatchObject({ url: `https://api.ean.test${PRICE_CHECK}`, method: 'GET' });
      expect(calls[0]?.headers.has('customer-ip')).toBe(false);
      expect(fresh).toMatchObject({
        supplierRateId: PRICE_CHECK,
        price: { base: money(30_000n, 'USD'), taxes: money(3_000n, 'USD') },
        payAtProperty: null,
      });
    });

    it('says the offer is gone when it sold out or the link expired', async () => {
      const soldOut = fakeFetch(json(200, { status: 'sold_out' }));
      await expect(
        supplierWith(soldOut.fn).reprice(hotel, searched, query, signal),
      ).rejects.toBeInstanceOf(OfferUnavailableError);
      const expired = fakeFetch(json(410, { type: 'link.expired' }));
      await expect(
        supplierWith(expired.fn).reprice(hotel, searched, query, signal),
      ).rejects.toBeInstanceOf(OfferUnavailableError);
    });

    it('never follows a rate id that points at another host', async () => {
      const { fn, calls } = fakeFetch();
      const foreign = { ...searched, supplierRateId: 'https://evil.example/v3/x?token=t' };
      await expect(supplierWith(fn).reprice(hotel, foreign, query, signal)).rejects.toBeInstanceOf(
        SupplierRequestError,
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe('book', () => {
    const request = {
      hotel: { supplier: 'expedia', supplierHotelId: '19248' },
      rate: {
        supplierRateId: PRICE_CHECK,
        price: { base: money(29_000n, 'USD'), taxes: money(2_240n, 'USD') },
      },
      query: {
        ...query,
        rooms: [
          { adults: 2, childAges: [7] },
          { adults: 1, childAges: [] },
        ],
      },
      guests: [{ givenNames: 'ADA', surname: 'OKAFOR' }],
      contact: { email: 'ada@example.com', phone: '+2348012345678' },
      idempotencyKey: '0192d3a0-7c1e-7b2a-9f00-00000000b001',
      customerIp: '102.89.1.10',
    } as unknown as HotelBookingRequest;
    const twoRooms = {
      '2-7': totals('200.00', '186.00'),
      '1': totals('112.40', '104.00'),
    };
    const available = (pricing: Record<string, unknown> = twoRooms) =>
      json(200, {
        status: 'available',
        occupancy_pricing: pricing,
        links: { book: { method: 'POST', href: BOOK_LINK } },
      });

    it('re-checks the price, then books under affiliate collect with the traveller IP', async () => {
      const { fn, calls } = fakeFetch(available(), json(201, { itinerary_id: '8955599932111' }));
      const result = await supplierWith(fn).book(request, signal);

      expect(result).toEqual({ confirmationNumber: '8955599932111' });
      expect(calls[0]?.headers.get('customer-ip')).toBe('102.89.1.10');
      expect(calls[1]).toMatchObject({
        url: `https://api.ean.test${BOOK_LINK}`,
        method: 'POST',
        body: {
          affiliate_reference_id: '0192d3a07c1e7b2a9f0000000000',
          hold: false,
          email: 'ada@example.com',
          phone: { country_code: '234', number: '8012345678' },
          // The lead guest stands in for rooms without their own.
          rooms: [
            { given_name: 'ADA', family_name: 'OKAFOR', smoking: false },
            { given_name: 'ADA', family_name: 'OKAFOR', smoking: false },
          ],
          payments: [
            {
              type: 'affiliate_collect',
              billing_contact: {
                given_name: 'ADA',
                family_name: 'OKAFOR',
                address: { country_code: 'NG' },
              },
            },
          ],
        },
      });
      expect(calls[1]?.headers.get('customer-ip')).toBe('102.89.1.10');
      expect(calls[1]?.headers.get('customer-session-id')).toBe(
        'booking-0192d3a07c1e7b2a9f0000000000',
      );
    });

    it('refuses to book without the traveller IP', async () => {
      const { fn, calls } = fakeFetch();
      await expect(
        supplierWith(fn).book({ ...request, customerIp: null }, signal),
      ).rejects.toBeInstanceOf(SupplierRequestError);
      expect(calls).toHaveLength(0);
    });

    it('refuses a total that moved since payment, before booking anything', async () => {
      const { fn, calls } = fakeFetch(
        available({ '2-7': totals('210.00', '190.00'), '1': totals('112.40', '104.00') }),
      );
      await expect(supplierWith(fn).book(request, signal)).rejects.toBeInstanceOf(
        OfferUnavailableError,
      );
      expect(calls).toHaveLength(1);
    });

    it('treats a sold-out rate as gone and an unreadable answer as ambiguous', async () => {
      const soldOut = fakeFetch(json(200, { status: 'sold_out' }));
      await expect(supplierWith(soldOut.fn).book(request, signal)).rejects.toBeInstanceOf(
        OfferUnavailableError,
      );
      const unreadable = fakeFetch(available(), json(201, { links: {} }));
      await expect(supplierWith(unreadable.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierAmbiguousError,
      );
    });

    it('sends a failed booking call to review, but retries a failed price check', async () => {
      // The itinerary may exist after a 5xx or a lost connection: never book again blindly.
      const failed = fakeFetch(available(), json(503, { type: 'service_unavailable' }));
      await expect(supplierWith(failed.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierAmbiguousError,
      );
      const lost = fakeFetch(available(), new TypeError('fetch failed'));
      await expect(supplierWith(lost.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierAmbiguousError,
      );
      // A refusal stays a refusal: the rooms went or the price moved.
      const refused = fakeFetch(available(), json(409, { type: 'rooms_unavailable' }));
      await expect(supplierWith(refused.fn).book(request, signal)).rejects.toBeInstanceOf(
        OfferUnavailableError,
      );
      // Nothing was booked when the price check failed: safe to retry.
      const early = fakeFetch(json(503, {}));
      await expect(supplierWith(early.fn).book(request, signal)).rejects.toBeInstanceOf(
        SupplierUnavailableError,
      );
    });
  });
});

describe('Expedia helpers', () => {
  it('writes occupancies as Rapid does', () => {
    expect(expediaOccupancy({ adults: 2, childAges: [] })).toBe('2');
    expect(expediaOccupancy({ adults: 2, childAges: [4, 9] })).toBe('2-4,9');
  });

  it('draws a closed ring of the radius around the point', () => {
    const ring = expediaSearchPolygon(6.5244, 3.3792, 20);
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[16]);
    // The first point lies 20 km east: longitude first, as GeoJSON wants.
    expect(ring[0]?.[1]).toBeCloseTo(6.5244, 6);
    expect(ring[0]?.[0]).toBeCloseTo(
      3.3792 + 20 / (111.32 * Math.cos((6.5244 * Math.PI) / 180)),
      5,
    );
    expect(ring[4]?.[1]).toBeCloseTo(6.5244 + 20 / 111.32, 5);
  });

  it('splits E.164 numbers into calling code and number', () => {
    expect(expediaPhone('+2348012345678')).toEqual({ country_code: '234', number: '8012345678' });
    expect(expediaPhone('+14155550100')).toEqual({ country_code: '1', number: '4155550100' });
    expect(expediaPhone('+447700900123')).toEqual({ country_code: '44', number: '7700900123' });
    expect(expediaPhone('+27821234567')).toEqual({ country_code: '27', number: '821234567' });
    expect(expediaPhone('+254712345678')).toEqual({ country_code: '254', number: '712345678' });
  });

  it('keeps affiliate references to 28 letters and digits', () => {
    expect(expediaAffiliateReference('0192d3a0-7c1e-7b2a-9f00-00000000b001')).toBe(
      '0192d3a07c1e7b2a9f0000000000',
    );
  });

  it('reads boards from amenity names', () => {
    expect(expediaBoard(undefined)).toBe('room_only');
    expect(expediaBoard({ a: { name: 'Free WiFi' } })).toBe('room_only');
    expect(expediaBoard({ a: { name: 'Breakfast buffet' } })).toBe('breakfast_included');
    expect(expediaBoard({ a: { name: 'Half board' } })).toBe('half_board');
    expect(expediaBoard({ a: { name: 'All Inclusive' } })).toBe('full_board');
  });

  it('adds up every room and keeps property fees apart', () => {
    const rooms = [
      { adults: 2, childAges: [] },
      { adults: 2, childAges: [] },
    ];
    expect(expediaStayPrice({ '2': totals('100.00', '90.00', '5.00') }, rooms)).toEqual({
      price: { base: money(18_000n, 'USD'), taxes: money(2_000n, 'USD') },
      payAtProperty: money(1_000n, 'USD'),
    });
    expect(expediaStayPrice({ '3': totals('100.00', '90.00') }, rooms)).toBeNull();
    expect(expediaStayPrice({ '2': totals('0.00', '0.00') }, rooms)).toBeNull();
    // Without a usable exclusive amount, the whole price is the base.
    expect(
      expediaStayPrice(
        {
          '2': {
            totals: { inclusive: { billable_currency: { value: '80.00', currency: 'USD' } } },
          },
        },
        [{ adults: 2, childAges: [] }],
      ),
    ).toEqual({
      price: { base: money(8_000n, 'USD'), taxes: money(0n, 'USD') },
      payAtProperty: null,
    });
  });

  it('gives free cancellation only to refundable rates with a penalty still ahead', () => {
    const now = Date.parse('2099-11-01T00:00:00Z');
    const penalty = (start: string) => ({ cancel_penalties: [{ start }] });
    expect(
      expediaFreeCancellationUntil({ id: 'r', refundable: true, ...penalty(FUTURE_PENALTY) }, now),
    ).toBe(new Date(Date.parse(FUTURE_PENALTY) - 60_000).toISOString());
    expect(
      expediaFreeCancellationUntil({ id: 'r', refundable: false, ...penalty(FUTURE_PENALTY) }, now),
    ).toBeNull();
    expect(
      expediaFreeCancellationUntil(
        { id: 'r', refundable: true, ...penalty('2099-10-01T00:00:00Z') },
        now,
      ),
    ).toBeNull();
    expect(expediaFreeCancellationUntil({ id: 'r', refundable: true }, now)).toBeNull();
  });
});
