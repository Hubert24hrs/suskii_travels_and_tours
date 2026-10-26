import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { addDays, localDate } from '@suskii/shared';

import { createTestApp, resetState, type TestContext } from './helpers/test-app';

// Duffel Stays end to end against a local stand-in: search, the hotel page's full rate list, and
// quotes. The payloads follow the types in Duffel's SDK (`@duffel/api`); nothing here reaches
// Duffel itself.

const DUFFEL_TOKEN = 'e2e-duffel-token';
const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const later = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

interface Recorded {
  path: string;
  body: Record<string, unknown>;
}

const rate = (id: string, total: string, extra: Record<string, unknown> = {}) => ({
  id,
  total_amount: total,
  total_currency: 'NGN',
  tax_amount: '15000.00',
  tax_currency: 'NGN',
  fee_amount: null,
  fee_currency: null,
  due_at_accommodation_amount: null,
  due_at_accommodation_currency: null,
  board_type: 'room_only',
  cancellation_timeline: [],
  payment_type: 'pay_now',
  available_payment_methods: ['balance', 'card'],
  loyalty_programme_required: false,
  expires_at: later(1),
  ...extra,
});

const accommodation = (id: string, name: string, rating: number) => ({
  id,
  name,
  rating,
  review_score: 8.4,
  review_count: 210,
  amenities: [{ type: 'wifi' }, { type: 'pool' }, { type: 'casino' }],
  location: {
    address: { city_name: 'Lagos', country_code: 'NG' },
    geographic_coordinates: { latitude: 6.43, longitude: 3.42 },
  },
});

/** A tiny stand-in for Duffel Stays: search, fetch_all_rates and quotes. */
class FakeDuffelStays {
  server: Server = createServer((request, response) => void this.handle(request, response));
  requests: Recorded[] = [];
  /** Test hooks. */
  failRates = false;
  soldOut = false;

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  reset(): void {
    this.requests = [];
    this.failRates = false;
    this.soldOut = false;
  }

  calls(path: string | RegExp): Recorded[] {
    return this.requests.filter((r) =>
      typeof path === 'string' ? r.path === path : path.test(r.path),
    );
  }

  /** Every rate of a result: two we can sell, one paid at the hotel and one for members only. */
  private rooms(resultId: string) {
    if (this.soldOut) {
      return [
        {
          name: 'Deluxe King',
          rates: [rate(`${resultId}-hotel`, '160000.00', { payment_type: 'pay_at_accommodation' })],
        },
      ];
    }
    return [
      {
        name: 'Deluxe King',
        rates: [
          rate(`${resultId}-flex`, '180000.00', {
            board_type: 'breakfast',
            cancellation_timeline: [
              { refund_amount: '180000.00', currency: 'NGN', before: later(20) },
            ],
          }),
          rate(`${resultId}-hotel`, '140000.00', { payment_type: 'pay_at_accommodation' }),
        ],
      },
      {
        name: 'Standard Twin',
        rates: [
          rate(`${resultId}-saver`, '150000.00'),
          rate(`${resultId}-members`, '120000.00', { loyalty_programme_required: true }),
        ],
      },
    ];
  }

  private allRates(): Map<string, ReturnType<typeof rate>> {
    const rates = new Map<string, ReturnType<typeof rate>>();
    for (const resultId of ['srr_eko', 'srr_ikoyi']) {
      for (const room of this.rooms(resultId)) for (const r of room.rates) rates.set(r.id, r);
    }
    return rates;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${DUFFEL_TOKEN}`)
      return this.send(response, 401, { errors: [{ code: 'unauthorized' }] });
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
      : {};
    const path = new URL(request.url ?? '/', 'http://fake').pathname;
    this.requests.push({ path, body });
    const data = (body.data ?? {}) as Record<string, unknown>;

    if (request.method === 'POST' && path === '/stays/search') {
      return this.send(response, 200, {
        data: {
          results: [
            {
              id: 'srr_eko',
              accommodation: accommodation('acc_eko', 'Eko Bay Hotel', 4),
              cheapest_rate_total_amount: '150000.00',
              cheapest_rate_currency: 'NGN',
              cheapest_rate_base_amount: '135000.00',
              cheapest_rate_base_currency: 'NGN',
              expires_at: later(1),
            },
            {
              id: 'srr_ikoyi',
              accommodation: accommodation('acc_ikoyi', 'Ikoyi Gardens', 5),
              cheapest_rate_total_amount: '210000.00',
              cheapest_rate_currency: 'NGN',
              expires_at: later(1),
            },
            // Missing its price: skipped on its own.
            { id: 'srr_broken', accommodation: accommodation('acc_x', 'Broken', 3) },
          ],
        },
      });
    }
    const all = /^\/stays\/search_results\/([^/]+)\/actions\/fetch_all_rates$/.exec(path);
    if (request.method === 'POST' && all) {
      if (this.failRates) return this.send(response, 503, { errors: [{ code: 'internal' }] });
      return this.send(response, 200, {
        data: { id: all[1], accommodation: { rooms: this.rooms(all[1] ?? '') } },
      });
    }
    if (request.method === 'POST' && path === '/stays/quotes') {
      const quoted = this.allRates().get(String(data.rate_id));
      if (!quoted) return this.send(response, 404, { errors: [{ code: 'not_found' }] });
      return this.send(response, 201, {
        data: {
          id: `quo_${quoted.id}`,
          total_amount: quoted.total_amount,
          total_currency: quoted.total_currency,
          tax_amount: quoted.tax_amount,
          tax_currency: quoted.tax_currency,
        },
      });
    }
    return this.send(response, 404, { errors: [{ code: 'not_found' }] });
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json', 'x-request-id': 'req_e2e' });
    response.end(JSON.stringify(body));
  }
}

describe('search (e2e): Duffel Stays hotels', () => {
  let ctx: TestContext;
  const duffel = new FakeDuffelStays();

  beforeAll(async () => {
    const baseUrl = await duffel.start();
    ctx = await createTestApp({
      HOTEL_SUPPLIERS: ['duffel'],
      DUFFEL_API_TOKEN: DUFFEL_TOKEN,
      DUFFEL_API_URL: baseUrl,
    });
  });
  beforeEach(async () => {
    await resetState(ctx);
    duffel.reset();
  });
  afterAll(async () => {
    await ctx.close();
    await new Promise<void>((resolve) => duffel.server.close(() => resolve()));
  });

  const search = async (extra: Record<string, unknown> = {}) => {
    const cityId =
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LOS' } })).cityId ?? '';
    return ctx
      .http()
      .post('/v1/hotels/searches')
      .send({
        destination: { type: 'city', cityId },
        checkIn: inDays(30),
        checkOut: inDays(32),
        rooms: [{ adults: 2, childAges: [7] }],
        ...extra,
      })
      .expect(200);
  };
  interface Listed {
    id: string;
    name: string;
    cheapestRate: { id: string };
  }
  const hotelNamed = (body: { hotels: Listed[] }, name: string): Listed => {
    const hotel = body.hotels.find((candidate) => candidate.name === name);
    if (!hotel) throw new Error(`no hotel named ${name}`);
    return hotel;
  };

  it('lists cheapest prices, loads every rate once for the hotel page and quotes one', async () => {
    const results = await search();
    expect(results.body).toMatchObject({ status: 'complete', nights: 2, total: 2 });
    const [searched] = duffel.calls('/stays/search');
    expect(searched?.body.data).toMatchObject({
      rooms: 1,
      guests: [{ type: 'adult' }, { type: 'adult' }, { type: 'child', age: 7 }],
      check_in_date: inDays(30),
      check_out_date: inDays(32),
      location: { radius: 10, geographic_coordinates: { latitude: expect.any(Number) } },
    });
    const eko = hotelNamed(results.body, 'Eko Bay Hotel');
    expect(eko).toMatchObject({ stars: 4, amenities: ['wifi', 'pool'] });
    expect(eko.id).toMatch(/\.h[a-z0-9]+$/);

    const detail = await ctx.http().get(`/v1/hotels/results/${eko.id}`).expect(200);
    const rates = detail.body.rates as { id: string; roomName: string; refundable: boolean }[];
    // Paid at the hotel and members-only rates are left out.
    expect(rates.map((r) => r.roomName).sort()).toEqual(['Deluxe King', 'Standard Twin']);
    for (const r of rates) expect(r.id).toMatch(/\.f[a-z0-9]+$/);
    expect(rates.find((r) => r.roomName === 'Deluxe King')?.refundable).toBe(true);

    // The second visit reuses the stored list: same ids, no second call to Duffel.
    const again = await ctx.http().get(`/v1/hotels/results/${eko.id}`).expect(200);
    expect(again.body.rates.map((r: { id: string }) => r.id)).toEqual(rates.map((r) => r.id));
    expect(duffel.calls(/fetch_all_rates$/)).toHaveLength(1);

    const twin = rates.find((r) => r.roomName === 'Standard Twin');
    const quote = await ctx
      .http()
      .post(`/v1/hotels/rates/${twin?.id ?? ''}/quote`)
      .expect(201);
    expect(quote.body).toMatchObject({ nights: 2, priceChange: null, hotel: { id: eko.id } });
    expect(duffel.calls('/stays/quotes').map((r) => r.body.data)).toEqual([
      { rate_id: 'srr_eko-saver' },
    ]);
  });

  it('quotes the cheapest price from search through the real cheapest rate', async () => {
    const results = await search();
    const eko = hotelNamed(results.body, 'Eko Bay Hotel');
    const quote = await ctx
      .http()
      .post(`/v1/hotels/rates/${eko.cheapestRate.id}/quote`)
      .expect(201);
    expect(quote.body).toMatchObject({ priceChange: null, rate: { roomName: 'Standard Twin' } });
    expect(duffel.calls('/stays/quotes').map((r) => r.body.data)).toEqual([
      { rate_id: 'srr_eko-saver' },
    ]);
  });

  it('answers 410 when nothing is left to sell', async () => {
    const results = await search();
    duffel.soldOut = true;
    const eko = hotelNamed(results.body, 'Eko Bay Hotel');
    const detail = await ctx.http().get(`/v1/hotels/results/${eko.id}`).expect(410);
    expect(detail.body.type).toBe('urn:suskii:problem:offer-unavailable');
  });

  it('shows the price from search when Duffel cannot load the rates, then loads them later', async () => {
    const results = await search();
    const eko = hotelNamed(results.body, 'Eko Bay Hotel');
    duffel.failRates = true;
    const fallback = await ctx.http().get(`/v1/hotels/results/${eko.id}`).expect(200);
    expect(fallback.body.rates).toHaveLength(1);
    expect(fallback.body.rates[0].id).toMatch(/\.r0$/);

    duffel.failRates = false;
    const loaded = await ctx.http().get(`/v1/hotels/results/${eko.id}`).expect(200);
    expect(loaded.body.rates).toHaveLength(2);
    expect(duffel.calls(/fetch_all_rates$/)).toHaveLength(2);
  });
});
