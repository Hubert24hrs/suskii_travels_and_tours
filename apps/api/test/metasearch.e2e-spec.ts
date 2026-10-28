import { addDays, BOOKING_TERMS_VERSION, localDate, money } from '@suskii/shared';

import { MetasearchLinks } from '../src/metasearch/metasearch-links';
import { PricingService } from '../src/pricing/pricing.service';

import { staffSession } from './helpers/admin';
import { bearer, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Metasearch partners (ADR-081): keys issued in the console and stored as an HMAC, the live price
 * API with per-partner limits and the website's guest prices, sealed deep links, and landings that
 * quote the itinerary again, record whether the price held and carry the partner into bookings.
 */

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const HOUR = 3_600_000;
let keySequence = 0;
const idempotencyKey = (): string => `e2e-meta-${Date.now()}-${(keySequence += 1)}`;

interface Wire {
  amountMinor: number;
  currency: string;
}
interface Segment {
  marketingCarrier: { code: string };
  flightNumber: string;
  departureUtc: string;
}
interface Itinerary {
  slices: { segments: Segment[] }[];
  fareBrand: string | null;
  total: Wire;
  deepLink: string;
}

const flightsKey = (slices: { segments: Segment[] }[]): string =>
  slices
    .flatMap((slice) =>
      slice.segments.map((s) => `${s.marketingCarrier.code}${s.flightNumber}@${s.departureUtc}`),
    )
    .join('|');

const route = {
  origin: 'LOS',
  destination: 'ABV',
  departureDate: inDays(30),
  returnDate: inDays(37),
  adults: '1',
};

describe('metasearch partners (e2e)', () => {
  let ctx: TestContext;
  let admin: TokenSession;

  const tokenOf = (deepLink: string): string =>
    decodeURIComponent(deepLink.slice(deepLink.indexOf('/flights/go/') + '/flights/go/'.length));

  async function partner(
    code = 'skyscanner',
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; key: string }> {
    const { body } = await ctx
      .http()
      .post('/v1/admin/metasearch/partners')
      .set(bearer(admin.accessToken))
      .send({ name: `Partner ${code}`, code, ...extra })
      .expect(201);
    return { id: body.partner.id as string, key: body.key as string };
  }

  const flights = (key: string | null, query: Record<string, string> = route) => {
    const call = ctx.http().get('/v1/metasearch/flights').query(query);
    return key === null ? call : call.set('X-Api-Key', key);
  };

  const land = (token: string) =>
    ctx.http().post('/v1/metasearch/landings').set('X-Suskii-Client', 'web/1.0.0').send({ token });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetState(ctx);
    admin = await staffSession(ctx, 'meta-admin@suskii.test', ['super_admin']);
  });
  beforeEach(async () => {
    await ctx.prisma.$executeRawUnsafe(
      'TRUNCATE TABLE metasearch_landings, metasearch_partners, markup_rules RESTART IDENTITY CASCADE',
    );
    await ctx.redis.flushdb();
    ctx.app.get(PricingService).invalidate();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('issues a key once, keeps only its HMAC and refuses a duplicate code', async () => {
    const { id, key } = await partner();
    expect(key).toMatch(/^smk_[A-Za-z0-9_-]{43}$/);
    const row = await ctx.prisma.metasearchPartner.findUniqueOrThrow({ where: { id } });
    expect(row.keyHash).not.toContain(key);
    expect(row.keyPrefix).toBe(key.slice(0, 12));
    expect(JSON.stringify(row)).not.toContain(key);
    await ctx
      .http()
      .post('/v1/admin/metasearch/partners')
      .set(bearer(admin.accessToken))
      .send({ name: 'Again', code: 'skyscanner' })
      .expect(409);
    // The report shows the hint, never the key.
    const { body } = await ctx
      .http()
      .get('/v1/admin/metasearch/partners')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(JSON.stringify(body)).not.toContain(key);
    expect(body.partners[0].partner.keyHint).toBe(key.slice(0, 12));
  });

  it('answers 401 without a valid key and stops a rotated or deactivated one at once', async () => {
    const { id, key } = await partner();
    await flights(null).expect(401);
    await flights('smk_not-a-real-key').expect(401);
    await flights(`smk_${'a'.repeat(43)}`).expect(401);
    await flights(key).expect(200);

    const rotated = await ctx
      .http()
      .post(`/v1/admin/metasearch/partners/${id}/key`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await flights(key).expect(401);
    await flights(rotated.body.key as string).expect(200);

    await ctx
      .http()
      .patch(`/v1/admin/metasearch/partners/${id}`)
      .set(bearer(admin.accessToken))
      .send({ active: false })
      .expect(200);
    await flights(rotated.body.key as string).expect(401);
  });

  it('limits wrong keys per address before asking the database again', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) await flights('smk_wrong').expect(401);
    const limited = await flights('smk_wrong').expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it("caps each partner at its own requests per minute, whatever the address's budget", async () => {
    const { id, key } = await partner('kayak', { requestsPerMinute: 2 });
    const first = await flights(key).expect(200);
    expect(first.headers['ratelimit-limit']).toBe('2');
    await flights(key).expect(200);
    const limited = await flights(key).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Another partner has its own budget.
    const other = await partner('wego');
    await flights(other.key).expect(200);
    await ctx
      .http()
      .patch(`/v1/admin/metasearch/partners/${id}`)
      .set(bearer(admin.accessToken))
      .send({ requestsPerMinute: 100 })
      .expect(200);
  });

  it("prices exactly like the website's guest search, cheapest first, without analytics rows", async () => {
    await ctx.prisma.markupRule.create({
      data: { name: 'e2e 8%', vertical: 'flights', type: 'percentage', value: 800n },
    });
    ctx.app.get(PricingService).invalidate();
    const { key } = await partner('google', { maxResults: 5 });
    const logs = await ctx.prisma.searchLog.count();

    const { body } = await flights(key, { ...route, limit: '50' }).expect(200);
    expect(body.currency).toBe('NGN');
    const itineraries = body.itineraries as Itinerary[];
    expect(itineraries.length).toBeGreaterThan(0);
    expect(itineraries.length).toBeLessThanOrEqual(5);
    const totals = itineraries.map((itinerary) => itinerary.total.amountMinor);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    for (const itinerary of itineraries) {
      expect(itinerary.deepLink.startsWith(`${ctx.config.WEB_APP_URL}/flights/go/`)).toBe(true);
    }
    // No supplier, cost or margin leaves the API.
    expect(JSON.stringify(body)).not.toMatch(/supplier|markup|"fare"|mock/i);
    expect(await ctx.prisma.searchLog.count()).toBe(logs);

    const web = await ctx
      .http()
      .post('/v1/flights/searches?limit=50')
      .set('X-Suskii-Client', 'web/1.0.0')
      .send({
        slices: [
          { origin: 'LOS', destination: 'ABV', departureDate: route.departureDate },
          { origin: 'ABV', destination: 'LOS', departureDate: route.returnDate },
        ],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    // The same flights can sell under several fare brands: compare like `itineraryKey` does.
    const webTotals = new Map(
      (
        web.body.offers as {
          slices: { segments: Segment[]; fareBrand: string | null }[];
          price: { total: Wire };
        }[]
      ).map((offer) => [
        `${offer.slices[0]?.fareBrand ?? ''}:${flightsKey(offer.slices)}`,
        offer.price.total,
      ]),
    );
    let compared = 0;
    for (const itinerary of itineraries) {
      const total = webTotals.get(`${itinerary.fareBrand ?? ''}:${flightsKey(itinerary.slices)}`);
      if (!total) continue;
      expect(itinerary.total).toEqual(total);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('validates the flat query like the website form', async () => {
    const { key } = await partner();
    const before = await flights(key, { ...route, returnDate: inDays(20) }).expect(400);
    expect(before.body.errors).toContainEqual(
      expect.objectContaining({ location: 'query', path: 'returnDate' }),
    );
    const infants = await flights(key, { ...route, adults: '1', infants: '2' }).expect(400);
    expect(infants.body.errors).toContainEqual(
      expect.objectContaining({ location: 'query', path: 'infants' }),
    );
    await flights(key, { ...route, origin: 'LOSX' }).expect(400);
  });

  it('lands on the same itinerary at the same price and carries the partner into the booking', async () => {
    const { id, key } = await partner();
    const { body } = await flights(key).expect(200);
    const [first] = body.itineraries as Itinerary[];
    if (!first) throw new Error('no itinerary');

    const landing = await land(tokenOf(first.deepLink)).expect(200);
    expect(landing.body).toMatchObject({
      outcome: 'same',
      partner: { name: 'Partner skyscanner' },
      shown: first.total,
      current: first.total,
    });
    expect(flightsKey(landing.body.offer.slices)).toBe(flightsKey(first.slices));

    const row = await ctx.prisma.metasearchLanding.findFirstOrThrow({ where: { partnerId: id } });
    expect(row).toMatchObject({ outcome: 'same', currency: 'NGN' });
    const quote = await ctx.prisma.offer.findUniqueOrThrow({
      where: { id: landing.body.quoteId as string },
    });
    expect(quote.metasearchLandingId).toBe(row.id);

    const booking = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: landing.body.quoteId,
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Amaka',
            surname: 'Eze',
            dateOfBirth: '1991-03-04',
            nationality: 'NG',
          },
        ],
        contact: { email: 'amaka@example.com', phone: '+2348012345678' },
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    const stored = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: booking.body.booking.id as string },
    });
    expect(stored.metasearchLandingId).toBe(row.id);

    // The report counts committed bookings only, per currency.
    const report = async (): Promise<unknown> => {
      const { body } = await ctx
        .http()
        .get('/v1/admin/metasearch/partners')
        .set(bearer(admin.accessToken))
        .expect(200);
      return (body as { partners: unknown[] }).partners[0];
    };
    expect(await report()).toMatchObject({ landings: 1, bookings: 0, value: [] });
    await ctx.prisma.booking.update({ where: { id: stored.id }, data: { status: 'PAID' } });
    expect(await report()).toMatchObject({
      landings: 1,
      outcomes: { same: 1, lower: 0, higher: 0, unavailable: 0, expired: 0 },
      priceAccuracyBps: 10_000,
      linkSuccessBps: 10_000,
      bookings: 1,
      value: [{ amountMinor: Number(stored.totalMinor), currency: 'NGN' }],
    });
  });

  it('says when the price rose or fell since the partner showed it', async () => {
    const { key } = await partner();
    const { body } = await flights(key).expect(200);
    const [first] = body.itineraries as Itinerary[];
    if (!first) throw new Error('no itinerary');

    await ctx.prisma.markupRule.create({
      data: { name: 'e2e rise', vertical: 'flights', type: 'percentage', value: 1000n },
    });
    ctx.app.get(PricingService).invalidate();
    const higher = await land(tokenOf(first.deepLink)).expect(200);
    expect(higher.body.outcome).toBe('higher');
    expect(higher.body.current.amountMinor).toBeGreaterThan(first.total.amountMinor);
    expect(higher.body.quoteId).toEqual(expect.any(String));

    // Issued under the markup, landed without it.
    const marked = await flights(key).expect(200);
    const [dearer] = marked.body.itineraries as Itinerary[];
    if (!dearer) throw new Error('no itinerary');
    await ctx.prisma.markupRule.deleteMany({});
    ctx.app.get(PricingService).invalidate();
    const lower = await land(tokenOf(dearer.deepLink)).expect(200);
    expect(lower.body.outcome).toBe('lower');
    expect(lower.body.current.amountMinor).toBeLessThan(dearer.total.amountMinor);
  });

  it('offers the same search when the flight is gone or the link lapsed, and 404s a forged link', async () => {
    const { id } = await partner();
    const links = ctx.app.get(MetasearchLinks);
    const claims = {
      partnerId: id,
      request: {
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy' as const,
        directOnly: false,
      },
      itinerary: 'economy::ZZ1@2030-01-01T00:00:00.000Z',
      shown: money(5_000_000n, 'NGN'),
    };

    const gone = await land(links.seal(claims)).expect(200);
    expect(gone.body).toMatchObject({
      outcome: 'unavailable',
      quoteId: null,
      current: null,
      offer: null,
      request: claims.request,
    });

    const lapsed = await land(links.seal(claims, Date.now() - 25 * HOUR)).expect(200);
    expect(lapsed.body.outcome).toBe('expired');

    // A departure that has passed since the link was issued: gone, not an error.
    const past = await land(
      links.seal({
        ...claims,
        request: {
          ...claims.request,
          slices: [{ ...claims.request.slices[0]!, departureDate: '2020-01-01' }],
        },
      }),
    ).expect(200);
    expect(past.body.outcome).toBe('unavailable');

    const token = links.seal(claims);
    await land(`${token.slice(0, -3)}AAA`).expect(404);
    await land('forged').expect(404);

    const { body } = await ctx
      .http()
      .get('/v1/admin/metasearch/partners')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(body.partners[0]).toMatchObject({
      landings: 3,
      outcomes: { unavailable: 2, expired: 1 },
      priceAccuracyBps: null,
      linkSuccessBps: 0,
    });
  });
});
