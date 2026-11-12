import { PricingService } from '../src/pricing/pricing.service';

import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * SEO pages from fare history (ADR-080): every deal refresh records its fares per departure date;
 * route facts, city hubs and airline pages read them, priced with today's rules.
 */
const DAY = 86_400_000;

interface Money {
  amountMinor: number;
  currency: string;
}

describe('route facts, city hubs and airline pages (e2e)', () => {
  let ctx: TestContext;

  const internal = (method: 'get' | 'post', path: string) =>
    ctx.http()[method](path).set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`);

  const routeId = async (slug: string): Promise<string> =>
    (await ctx.prisma.dealRoute.findUniqueOrThrow({ where: { slug } })).id;

  const refresh = async (slug: string) =>
    internal('post', `/v1/internal/deals/routes/${await routeId(slug)}/refresh`).expect(200);

  /** Copies today's fares to earlier days, as if refreshes had run then. */
  const backfill = async (
    slug: string,
    daysAgo: number[],
    shift: (day: number, row: number) => object = () => ({}),
  ) => {
    const rows = await ctx.prisma.routeFare.findMany({ where: { routeId: await routeId(slug) } });
    const today = rows[0]?.observedOn ?? new Date();
    let index = 0;
    for (const days of daysAgo) {
      for (const [rowIndex, row] of rows.entries()) {
        const { id: _id, updatedAt: _updatedAt, ...copy } = row;
        await ctx.prisma.routeFare.create({
          data: {
            ...copy,
            observedOn: new Date(today.getTime() - days * DAY),
            ...shift(index, rowIndex),
          },
        });
      }
      index += 1;
    }
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('records each departure date a refresh searched, keeping the cheaper find of the day', async () => {
    await refresh('lagos-to-london');
    const rows = await ctx.prisma.routeFare.findMany({
      where: { routeId: await routeId('lagos-to-london') },
      orderBy: { departureDate: 'asc' },
    });
    // One row per configured departure offset (21 and 45 days by default).
    expect(rows).toHaveLength(ctx.config.DEALS_DEPARTURE_OFFSETS_DAYS.length);
    const [first] = rows;
    if (!first) throw new Error('no fare recorded');

    // A dearer find later the same day never replaces a cheaper one.
    await ctx.prisma.routeFare.update({ where: { id: first.id }, data: { usdMinor: 1n } });
    await refresh('lagos-to-london');
    expect(
      (await ctx.prisma.routeFare.findUniqueOrThrow({ where: { id: first.id } })).usdMinor,
    ).toBe(1n);
    // A cheaper one does.
    await ctx.prisma.routeFare.update({
      where: { id: first.id },
      data: { usdMinor: 10_000_000_000n },
    });
    await refresh('lagos-to-london');
    const replaced = await ctx.prisma.routeFare.findUniqueOrThrow({ where: { id: first.id } });
    expect(replaced.usdMinor).toBeLessThan(10_000_000_000n);
    expect(await ctx.prisma.routeFare.count()).toBe(rows.length);
  });

  it('shows facts only once enough days exist, priced with the current rules', async () => {
    await refresh('lagos-to-london');
    const thin = await ctx.http().get('/v1/deals/routes/lagos-to-london').expect(200);
    expect(thin.body.facts).toBeNull();

    await backfill('lagos-to-london', [1, 2]);
    const { body } = await ctx
      .http()
      .get('/v1/deals/routes/lagos-to-london?currency=USD')
      .expect(200);
    expect(body.facts).toMatchObject({
      typical: { currency: 'USD' },
      cheapest: { price: { currency: 'USD' } },
      direct: expect.any(Boolean),
      fastestMinutes: expect.any(Number),
      cheapestMonth: null,
      observedDays: 3,
      sample: true,
    });
    expect(body.facts.airlines.length).toBeGreaterThan(0);
    expect((body.facts.typical as Money).amountMinor).toBeGreaterThan(0);
    // Supplier cost stays inside the API.
    expect(JSON.stringify(body)).not.toMatch(/baseMinor|taxesMinor|usdMinor|base_minor/);

    // A markup changes every fact price at once: they are priced on read, not stored priced.
    const before = body.facts.typical as Money;
    await ctx.prisma.markupRule.create({
      data: { name: 'e2e', vertical: 'flights', type: 'percentage', value: 1000n },
    });
    ctx.app.get(PricingService).invalidate();
    const after = (
      await ctx.http().get('/v1/deals/routes/lagos-to-london?currency=USD').expect(200)
    ).body.facts.typical as Money;
    expect(after.amountMinor).toBeGreaterThan(before.amountMinor);
  });

  it('names the cheapest month once three departure months were seen', async () => {
    await refresh('lagos-to-london');
    const month = (offset: number) => {
      const date = new Date();
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 15));
    };
    // Days 1 and 2 ago depart in two other months; day 2's fares are much cheaper.
    await backfill('lagos-to-london', [40, 80], (index, row) => ({
      departureDate: new Date(month(index === 0 ? 3 : 4).getTime() + row * DAY),
      usdMinor: index === 1 ? 1_000n : 9_000_000n,
    }));
    const { body } = await ctx.http().get('/v1/deals/routes/lagos-to-london').expect(200);
    expect(body.facts.cheapestMonth).toBe(month(4).getUTCMonth() + 1);
  });

  it('serves city hubs with routes from and to the city', async () => {
    await refresh('lagos-to-london');
    await backfill('lagos-to-london', [1, 2]);

    const { body: cities } = await ctx.http().get('/v1/deals/cities').expect(200);
    const lagos = (cities.cities as { slug: string; departures: number; arrivals: number }[]).find(
      (city) => city.slug === 'lagos',
    );
    expect(lagos?.departures).toBeGreaterThan(0);
    expect(lagos?.arrivals).toBeGreaterThan(0);

    const { body } = await ctx.http().get('/v1/deals/cities/lagos?currency=USD').expect(200);
    expect(body.city).toMatchObject({ slug: 'lagos', name: 'Lagos', countryCode: 'NG' });
    const london = (body.departures as { slug: string; typical: Money | null }[]).find(
      (route) => route.slug === 'lagos-to-london',
    );
    expect(london?.typical?.currency).toBe('USD');
    expect((body.arrivals as { slug: string }[]).map((route) => route.slug)).toContain(
      'abuja-to-lagos',
    );
    await ctx.http().get('/v1/deals/cities/atlantis').expect(404);
    await ctx.http().get('/v1/deals/cities/Not_A_Slug').expect(400);
  });

  it('serves airline pages for airlines seen on routes in the last 90 days', async () => {
    await refresh('lagos-to-london');
    const [fare] = await ctx.prisma.routeFare.findMany({ take: 1 });
    if (!fare) throw new Error('no fare recorded');

    const { body: list } = await ctx.http().get('/v1/deals/airlines').expect(200);
    expect(list.airlines).toContainEqual(
      expect.objectContaining({ code: fare.carrierCode, routes: 1 }),
    );

    const { body } = await ctx.http().get(`/v1/deals/airlines/${fare.carrierCode}`).expect(200);
    expect(body.airline.code).toBe(fare.carrierCode);
    expect(body.routes).toEqual([
      expect.objectContaining({
        slug: 'lagos-to-london',
        cheapest: {
          price: expect.objectContaining({ currency: 'NGN' }),
          departureDate: expect.any(String),
        },
        sample: true,
      }),
    ]);
    await ctx.http().get('/v1/deals/airlines/ZZ').expect(404);
    await ctx.http().get('/v1/deals/airlines/kq').expect(400);

    // Older than 90 days: the airline drops off.
    await ctx.prisma.routeFare.updateMany({
      data: { observedOn: new Date(Date.now() - 100 * DAY) },
    });
    await ctx.http().get(`/v1/deals/airlines/${fare.carrierCode}`).expect(404);
  });

  it('prunes fare history past ROUTE_FARE_RETENTION_DAYS', async () => {
    await refresh('lagos-to-london');
    const count = await ctx.prisma.routeFare.count();
    await ctx.prisma.routeFare.updateMany({
      data: { observedOn: new Date(Date.now() - (ctx.config.ROUTE_FARE_RETENTION_DAYS + 1) * DAY) },
    });
    const { body } = await internal('post', '/v1/internal/snapshots/prune').expect(200);
    expect(body.deletedFares).toBe(count);
    expect(await ctx.prisma.routeFare.count()).toBe(0);
  });
});
