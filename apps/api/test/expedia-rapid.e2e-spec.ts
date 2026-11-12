import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { RetentionService } from '../src/privacy/retention.service';

import { createTestApp, resetState, type TestContext } from './helpers/test-app';

// Expedia Rapid end to end against a local stand-in (ADR-086): search, quote, booking, payment
// and the supplier booking with the traveller's IP. Shapes follow Expedia's Rapid SDK models;
// nothing here reaches Expedia.

const API_KEY = 'e2e-rapid-key';
const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const later = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();
let keySequence = 0;
const idempotencyKey = (): string => `e2e-expedia-${Date.now()}-${(keySequence += 1)}`;
const contact = { email: 'ada@example.com', phone: '+2348012345678' };
const PRICE_CHECK = '/v3/properties/19248/rooms/38661/rates/200127420';

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

const totals = (inclusive: string, exclusive: string) => ({
  totals: {
    inclusive: { billable_currency: { value: inclusive, currency: 'USD' } },
    exclusive: { billable_currency: { value: exclusive, currency: 'USD' } },
  },
});

/** A tiny stand-in for Rapid: geography, availability, content, price check and booking. */
class FakeRapid {
  server: Server = createServer((request, response) => void this.handle(request, response));
  requests: Recorded[] = [];
  /** Test hooks: what the price check answers, and the stay's total in USD. */
  priceStatus = 'available';
  total = '312.40';
  private occupancies: string[] = [];

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  reset(): void {
    this.requests = [];
    this.priceStatus = 'available';
    this.total = '312.40';
  }

  calls(method: string, path: string): Recorded[] {
    return this.requests.filter((r) => r.method === method && r.path === path);
  }

  private pricing() {
    // The stand-in splits the total evenly between rooms; taxes are 10% of each room.
    const share = Number(this.total) / Math.max(this.occupancies.length, 1);
    return Object.fromEntries(
      this.occupancies.map((occupancy) => [
        occupancy,
        totals(share.toFixed(2), (share / 1.1).toFixed(2)),
      ]),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!request.headers.authorization?.startsWith(`EAN APIKey=${API_KEY},Signature=`))
      return this.send(response, 401, { type: 'request_unauthenticated' });
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
      : {};
    const url = new URL(request.url ?? '/', 'http://fake');
    const method = request.method ?? 'GET';
    this.requests.push({
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers,
      body,
    });

    if (method === 'POST' && url.pathname === '/v3/properties/geography') {
      return this.send(response, 200, { '19248': {}, '30001': {} });
    }
    if (method === 'GET' && url.pathname === '/v3/properties/availability') {
      this.occupancies = url.searchParams.getAll('occupancy');
      return this.send(response, 200, [
        {
          property_id: '19248',
          status: 'available',
          rooms: [
            {
              id: '38661',
              room_name: 'Deluxe King',
              rates: [
                {
                  id: '200127420',
                  status: 'available',
                  refundable: true,
                  merchant_of_record: 'expedia',
                  amenities: { '2104': { id: '2104', name: 'Free breakfast' } },
                  bed_groups: {
                    '37321': {
                      id: '37321',
                      description: '1 King Bed',
                      links: {
                        price_check: { method: 'GET', href: `${PRICE_CHECK}?token=pc_e2e` },
                      },
                    },
                  },
                  cancel_penalties: [{ start: later(20), amount: '100.00', currency: 'USD' }],
                  occupancy_pricing: this.pricing(),
                },
              ],
            },
          ],
        },
      ]);
    }
    if (method === 'GET' && url.pathname === '/v3/properties/content') {
      return this.send(response, 200, {
        '19248': {
          property_id: '19248',
          name: 'Eko Waterfront Hotel',
          address: { line_1: '1 Adetokunbo Ademola St', city: 'Lagos', country_code: 'NG' },
          ratings: { property: { rating: '4.0' }, guest: { overall: '4.3', count: 980 } },
          location: { coordinates: { latitude: 6.4281, longitude: 3.4219 } },
        },
      });
    }
    if (method === 'GET' && url.pathname === PRICE_CHECK) {
      if (this.priceStatus === 'sold_out') return this.send(response, 200, { status: 'sold_out' });
      return this.send(response, 200, {
        status: this.priceStatus,
        occupancy_pricing: this.pricing(),
        links: { book: { method: 'POST', href: '/v3/itineraries?token=book_e2e' } },
      });
    }
    if (method === 'POST' && url.pathname === '/v3/itineraries') {
      return this.send(response, 201, { itinerary_id: '8955599932111' });
    }
    return this.send(response, 404, { type: 'resource.not_found' });
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }
}

describe('bookings (e2e): Expedia Rapid hotels', () => {
  let ctx: TestContext;
  const rapid = new FakeRapid();

  beforeAll(async () => {
    const baseUrl = await rapid.start();
    ctx = await createTestApp({
      HOTEL_SUPPLIERS: ['expedia'],
      EXPEDIA_RAPID_API_URL: baseUrl,
      EXPEDIA_RAPID_API_KEY: API_KEY,
      EXPEDIA_RAPID_SHARED_SECRET: 'e2e-rapid-secret',
    });
  });
  beforeEach(async () => {
    await resetState(ctx);
    rapid.reset();
  });
  afterAll(async () => {
    await ctx.close();
    await new Promise<void>((resolve) => rapid.server.close(() => resolve()));
  });

  async function quote(rooms = [{ adults: 2, childAges: [] as number[] }]): Promise<string> {
    const cityId =
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LOS' } })).cityId ?? '';
    const search = await ctx
      .http()
      .post('/v1/hotels/searches')
      .send({
        destination: { type: 'city', cityId },
        checkIn: inDays(30),
        checkOut: inDays(32),
        rooms,
      })
      .expect(200);
    expect(search.body.hotels).toEqual([
      expect.objectContaining({ name: 'Eko Waterfront Hotel', stars: 4 }),
    ]);
    const rateId = search.body.hotels[0].cheapestRate.id as string;
    const quoted = await ctx.http().post(`/v1/hotels/rates/${rateId}/quote`).expect(201);
    return quoted.body.quoteId as string;
  }

  async function book(quoteId: string, guests: { givenNames: string; surname: string }[]) {
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId,
        guests,
        contact,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    return {
      id: created.body.booking.id as string,
      token: { 'X-Booking-Token': created.body.accessToken as string },
    };
  }

  async function pay(id: string, token: Record<string, string>, beforeWebhook?: () => void) {
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${id}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(token)
      .expect(201);
    beforeWebhook?.();
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    return ctx.http().get(`/v1/bookings/${id}`).set(token);
  }

  it('books after payment with the traveller IP, then forgets the IP', async () => {
    const quoteId = await quote();
    // Searches and quotes never send the traveller's IP.
    for (const call of rapid.requests) expect(call.headers['customer-ip']).toBeUndefined();
    const [availability] = rapid.calls('GET', '/v3/properties/availability');
    expect(availability?.query.getAll('filter')).toEqual(['expedia_collect']);
    expect(availability?.headers.authorization).toMatch(
      new RegExp(`^EAN APIKey=${API_KEY},Signature=[0-9a-f]{128},timestamp=\\d+$`),
    );

    const { id, token } = await book(quoteId, [{ givenNames: 'Ada', surname: 'Okafor' }]);
    const stored = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId: id } });
    expect(stored.customerIpEncrypted).toBeTruthy();
    expect(stored.customerIpEncrypted).not.toContain('127.0.0.1');

    const confirmed = await pay(id, token);
    expect(confirmed.body).toMatchObject({
      status: 'CONFIRMED',
      hotel: { confirmationNumber: '8955599932111' },
    });

    const [itinerary] = rapid.calls('POST', '/v3/itineraries');
    expect(itinerary?.headers['customer-ip']).toBe('127.0.0.1');
    expect(itinerary?.body).toMatchObject({
      affiliate_reference_id: stored.id.replaceAll('-', '').slice(0, 28),
      hold: false,
      email: 'ada@example.com',
      phone: { country_code: '234', number: '8012345678' },
      rooms: [{ given_name: 'ADA', family_name: 'OKAFOR', smoking: false }],
      payments: [{ type: 'affiliate_collect' }],
    });
    // Booked: the IP has served its purpose.
    const after = await ctx.prisma.bookingItem.findUniqueOrThrow({ where: { id: stored.id } });
    expect(after.customerIpEncrypted).toBeNull();
  });

  it('refunds rather than books when the price moved after payment', async () => {
    const quoteId = await quote();
    const { id, token } = await book(quoteId, [{ givenNames: 'Ada', surname: 'Okafor' }]);
    const settled = await pay(id, token, () => {
      rapid.total = '340.00';
      rapid.priceStatus = 'price_changed';
    });

    expect(['REFUND_PENDING', 'REFUNDED']).toContain(settled.body.status);
    expect(rapid.calls('POST', '/v3/itineraries')).toHaveLength(0);
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId: id } });
    expect(item.customerIpEncrypted).toBeNull();
  });

  it('clears an IP that was never used once retention catches up', async () => {
    const quoteId = await quote();
    const { id } = await book(quoteId, [{ givenNames: 'Ada', surname: 'Okafor' }]);
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId: id } });
    await ctx.prisma.bookingItem.update({
      where: { id: item.id },
      data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });

    const run = await ctx.app.get(RetentionService).run(new Date());
    expect(run['supplier-customer-ip']).toBe(1);
    const after = await ctx.prisma.bookingItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.customerIpEncrypted).toBeNull();
  });
});
