import { createTestApp, resetState, type TestContext } from './helpers/test-app';

interface Suggestion {
  type: 'airport' | 'city';
  code?: string;
  name: string;
  countryCode: string;
  airports?: { code: string }[];
}

describe('catalog (e2e, seeded reference data)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const suggest = async (q: string, extra: Record<string, string> = {}): Promise<Suggestion[]> => {
    const response = await ctx
      .http()
      .get('/v1/catalog/places')
      .query({ q, ...extra })
      .expect(200);
    return response.body.items as Suggestion[];
  };
  const label = (item: Suggestion | undefined): string =>
    item ? (item.type === 'airport' ? `airport:${item.code ?? ''}` : `city:${item.name}`) : 'none';

  it('puts an exact IATA code first', async () => {
    expect(label((await suggest('LOS'))[0])).toBe('airport:LOS');
    expect(label((await suggest('jfk'))[0])).toBe('airport:JFK');
  });

  it('matches name prefixes, favouring the primary market and grouping airports under cities', async () => {
    const lag = await suggest('lag');
    expect(label(lag[0])).toBe('city:Lagos');
    expect(lag[0]?.airports?.map((a) => a.code)).toEqual(['LOS']);
    const london = (await suggest('london'))[0];
    expect(label(london)).toBe('city:London');
    expect(london?.airports?.map((a) => a.code)).toEqual(expect.arrayContaining(['LHR', 'LGW']));
    expect(label((await suggest('par'))[0])).toBe('city:Paris');
  });

  it('ignores accents and tolerates typos', async () => {
    expect(label((await suggest('sao paulo'))[0])).toBe('city:São Paulo');
    expect(label((await suggest('São Paulo'))[0])).toBe('city:São Paulo');
    expect(label((await suggest('lagso'))[0])).toBe('city:Lagos');
    expect(label((await suggest('nairobbi'))[0])).toBe('city:Nairobi');
  });

  it('filters by type, limits results and validates input', async () => {
    const airportsOnly = await suggest('abuja', { types: 'airport', limit: '3' });
    expect(airportsOnly.every((item) => item.type === 'airport')).toBe(true);
    expect(airportsOnly.length).toBeLessThanOrEqual(3);
    expect(await suggest('zzqx')).toEqual([]);
    await ctx.http().get('/v1/catalog/places').query({ q: 'a' }).expect(400);
    await ctx.http().get('/v1/catalog/places').query({ q: 'lagos', types: 'train' }).expect(400);
    await ctx.http().get('/v1/catalog/places').query({ q: 'lagos', limit: '50' }).expect(400);
  });

  it('serves an edge-cacheable popular index with every Nigerian airport', async () => {
    const response = await ctx.http().get('/v1/catalog/places/popular').expect(200);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=86400, stale-while-revalidate=604800',
    );
    expect(response.headers.etag).toBeDefined();
    expect(response.body.fields).toEqual(['code', 'name', 'city', 'countryCode']);
    const codes = (response.body.airports as string[][]).map(([code]) => code);
    expect(codes).toEqual(
      expect.arrayContaining(['LOS', 'ABV', 'PHC', 'KAN', 'LHR', 'JFK', 'DXB']),
    );
    expect(codes.length).toBeGreaterThan(1000);
    const etag = String(response.headers.etag);
    const notModified = await ctx
      .http()
      .get('/v1/catalog/places/popular')
      .set('If-None-Match', etag);
    expect(notModified.status).toBe(304);
  });

  it('looks up airports case-insensitively and lists countries', async () => {
    const airport = await ctx.http().get('/v1/catalog/airports/abv').expect(200);
    expect(airport.body).toMatchObject({
      code: 'ABV',
      countryCode: 'NG',
      countryName: 'Nigeria',
      timeZone: 'Africa/Lagos',
      type: 'large_airport',
    });
    await ctx.http().get('/v1/catalog/airports/zzz').expect(404);
    await ctx.http().get('/v1/catalog/airports/toolong').expect(400);
    const countries = await ctx.http().get('/v1/catalog/countries').expect(200);
    expect(countries.body.items).toContainEqual({ code: 'NG', name: 'Nigeria', continent: 'AF' });
    expect(countries.body.items.length).toBe(249);
  });

  it('looks up a city by id for shared search links', async () => {
    const { cityId } = await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LOS' } });
    const city = await ctx.http().get(`/v1/catalog/cities/${cityId}`).expect(200);
    expect(city.body).toEqual({
      id: cityId,
      name: 'Lagos',
      countryCode: 'NG',
      countryName: 'Nigeria',
      timeZone: 'Africa/Lagos',
    });
    await ctx.http().get('/v1/catalog/cities/0192f0e0-0000-7000-8000-000000000000').expect(404);
    await ctx.http().get('/v1/catalog/cities/lagos').expect(400);
  });
});
