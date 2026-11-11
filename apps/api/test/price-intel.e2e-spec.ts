import { addDays, localDate } from '@suskii/shared';

import { ObjectStorage } from '../src/documents/object-storage';
import { DomainThrottle } from '../src/price-intel/domain-throttle';
import { DRIFT_MIN_FAILURES } from '../src/price-intel/price-intel-drift';
import { MockScrapeProvider } from '../src/price-intel/providers/mock-scrape-provider';
import { PUBLIC_ITEM_FIELDS } from '../src/price-intel/recipes';

import { staffSession } from './helpers/admin';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * Price intelligence (ADR-102) end to end, with the mock vendor and real PostgreSQL and Redis:
 * a site starts closed, is approved only with a basis its own robots file and terms allow, and
 * is never read while blocked or switched off; a read fails over, is bounded and is recorded; a
 * price becomes an observation with public facts only; budgets, breakers and the throttle hold
 * across the Redis every replica shares; and parser drift moves a site to its next method.
 */

const today = localDate(new Date(), 'UTC');
const day = (offset: number): string => addDays(today, offset);
const UNREADABLE = `<html><body>${'<p>Welcome to our hotels page.</p>'.repeat(120)}</body></html>`;

interface Source {
  id: string;
  domain: string;
  status: string;
  readable: string;
  basis: string | null;
  basisReference: string | null;
  maxProxyClass: string;
  drift: { since: string; parserVersion: string } | null;
}
interface Observation {
  id: string;
  price: { amountMinor: number; currency: string };
  taxesIncluded: boolean | null;
  item: Record<string, string | number>;
  status: string;
  confidence: number;
  stale: boolean;
  indicative: boolean;
  availability: string;
}
interface ReadResult {
  state: string;
  failure: string | null;
  reason: string | null;
  jobId: string | null;
  observations: Observation[];
}

const STRUCTURED = { method: 'structured_data', types: ['Hotel'] };
const SELECTORS = {
  method: 'selectors',
  item: 'article.result',
  fields: { title: '.name', price: '.price', stars: '.stars', availability: '.stock' },
};

describe('price intelligence (e2e)', () => {
  let ctx: TestContext;
  let mock: MockScrapeProvider;
  let admin: TokenSession;
  let support: TokenSession;
  let sequence = 0;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    mock = ctx.app.get(MockScrapeProvider);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    mock.reset();
    admin = await staffSession(ctx, 'intel-admin@suskii.test', ['super_admin']);
    support = await staffSession(ctx, 'intel-support@suskii.test', ['support']);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const input = (over: Record<string, unknown> = {}) => {
    sequence += 1;
    const domain = `hotels${sequence}.example.com`;
    return {
      domain,
      name: `Sample Hotels ${sequence}`,
      products: ['hotel'],
      country: 'NG',
      currency: 'NGN',
      locale: 'en-NG',
      urlTemplates: {
        hotel: `https://${domain}/search?city={place}&in={from}&out={to}&adults={adults}`,
      },
      recipes: { hotel: { version: 'hotel-v1', methods: [STRUCTURED, SELECTORS] } },
      vendors: ['mock'],
      requestsPerMinute: 600,
      maxConcurrency: 5,
      timeZone: 'Africa/Lagos',
      ...over,
    };
  };
  const as = (session: TokenSession) => bearer(session.accessToken);
  const create = async (over: Record<string, unknown> = {}): Promise<Source> => {
    const response = await ctx
      .http()
      .post('/v1/admin/data-sources')
      .set(as(admin))
      .send(input(over));
    expect(response.status).toBe(201);
    return response.body as Source;
  };
  const patch = (id: string, body: Record<string, unknown>, session = admin) =>
    ctx.http().patch(`/v1/admin/data-sources/${id}`).set(as(session)).send(body);
  const approve = (id: string, body: Record<string, unknown>, session = admin) =>
    ctx.http().post(`/v1/admin/data-sources/${id}/approve`).set(as(session)).send(body);
  /** A site whose robots file and terms were read, approved on an assessment. */
  const approved = async (over: Record<string, unknown> = {}): Promise<Source> => {
    const source = await create({ robots: 'allowed', terms: 'silent', ...over });
    const response = await approve(source.id, {
      basis: 'public_data_assessment',
      basisReference: 'Legal file PI-2026-014',
    });
    expect(response.status).toBe(200);
    return response.body as Source;
  };
  const query = (over: Record<string, unknown> = {}) => ({
    place: 'Lagos',
    from: day(30),
    to: day(32),
    adults: 2,
    ...over,
  });
  const read = async (id: string, over: Record<string, unknown> = {}): Promise<ReadResult> => {
    const response = await ctx
      .http()
      .post(`/v1/admin/data-sources/${id}/read`)
      .set(as(admin))
      .send({ product: 'hotel', query: query(over) });
    expect(response.status).toBe(200);
    return response.body as ReadResult;
  };
  const attemptsOf = async (jobId: string | null) =>
    (
      await ctx.prisma.scrapeAttempt.findMany({
        where: { jobId: jobId ?? '' },
        orderBy: { id: 'asc' },
      })
    ).map((attempt) => [attempt.vendor, attempt.proxyClass, attempt.outcome]);

  it('lets only staff with the permission see and change sites', async () => {
    const traveller = await signUp(ctx, 'intel-traveller@example.com');
    const list = (session: TokenSession) =>
      ctx.http().get('/v1/admin/data-sources').set(as(session));
    expect((await list(admin)).status).toBe(200);
    // Support reads; only a data-sources manager writes.
    expect((await list(support)).status).toBe(200);
    expect((await list(traveller)).status).toBe(403);
    expect(
      (await ctx.http().post('/v1/admin/data-sources').set(as(support)).send(input())).status,
    ).toBe(403);
    const source = await create();
    expect((await patch(source.id, { name: 'Renamed' }, support)).status).toBe(403);
    expect(
      (await approve(source.id, { basis: 'licence', basisReference: 'X-1234' }, support)).status,
    ).toBe(403);
    expect(
      (
        await ctx
          .http()
          .post(`/v1/admin/data-sources/${source.id}/read`)
          .set(as(support))
          .send({ product: 'hotel', query: query() })
      ).status,
    ).toBe(403);
    expect((await ctx.http().get('/v1/admin/data-sources')).status).toBe(401);
  });

  it('lists a site closed, and refuses one that could read another host or hold a key', async () => {
    const source = await create();
    expect(source).toMatchObject({
      status: 'review',
      readable: 'review_mock_only',
      basis: null,
      maxProxyClass: 'none',
      drift: null,
    });
    expect(source.domain).toMatch(/^hotels\d+\.example\.com$/);
    // The same site twice, however its address is written.
    const again = await ctx
      .http()
      .post('/v1/admin/data-sources')
      .set(as(admin))
      .send({
        ...input(),
        domain: `https://WWW.${source.domain}/rooms`,
        urlTemplates: { hotel: `https://${source.domain}/search?city={place}` },
      });
    expect(again.status).toBe(409);

    const refused = async (over: Record<string, unknown>): Promise<string[]> => {
      const response = await ctx
        .http()
        .post('/v1/admin/data-sources')
        .set(as(admin))
        .send(input(over));
      expect(response.status).toBe(400);
      return (response.body as { errors: { path: string }[] }).errors.map((error) => error.path);
    };
    expect(
      await refused({ urlTemplates: { hotel: 'https://internal.example.net/search?q={place}' } }),
    ).toEqual(['urlTemplates.hotel']);
    expect(await refused({ urlTemplates: { hotel: 'https://169.254.169.254/{place}' } })).toEqual([
      'urlTemplates.hotel',
    ]);
    expect(await refused({ recipes: {} })).toEqual(['recipes.hotel']);
    expect(await refused({ domain: 'localhost' })).toEqual(['domain']);
    expect(await refused({ vendors: ['mock', 'mock'] })).toEqual(['vendors']);
    expect(await refused({ vendorSettings: { mock: { apiKey: 'never-stored-here' } } })).toEqual([
      'vendorSettings.mock.apiKey',
    ]);
    expect(await refused({ vendors: ['mock', 'apify'] })).toEqual(['vendorSettings.apify']);
    expect(await refused({ timeZone: 'Mars/Olympus' })).toEqual(['timeZone']);
    expect(await ctx.prisma.priceSource.count()).toBe(1);
  });

  it('approves only with a basis the site itself allows, and records who and why', async () => {
    const source = await create();
    const reference = { basisReference: 'Legal file PI-2026-014' };
    // Nobody read the robots file or the terms yet.
    const unread = await approve(source.id, { basis: 'licence', ...reference });
    expect(unread.status).toBe(422);
    expect((unread.body as { type: string }).type).toContain('price-source-findings-unknown');

    // The terms disallow automated access: an assessment cannot overrule the site.
    expect((await patch(source.id, { robots: 'allowed', terms: 'disallowed' })).status).toBe(200);
    for (const basis of ['public_data_assessment', 'counsel_note']) {
      const denied = await approve(source.id, { basis, ...reference });
      expect([basis, denied.status]).toEqual([basis, 422]);
      expect((denied.body as { type: string }).type).toContain('price-source-needs-permission');
    }
    // A reference names a document, never a person.
    const personal = await approve(source.id, {
      basis: 'permission',
      basisReference: 'Email from ada@example.com',
    });
    expect(personal.status).toBe(422);
    expect(await ctx.prisma.sourcePolicy.count({ where: { status: 'approved' } })).toBe(0);

    const ok = await approve(source.id, {
      basis: 'permission',
      basisReference: 'Agreement SA-77, clause 4',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      status: 'approved',
      readable: 'yes',
      basis: 'permission',
      basisReference: 'Agreement SA-77, clause 4',
    });
    expect((await approve(source.id, { basis: 'permission', ...reference })).status).toBe(409);
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'price_intel.source_approved', targetId: source.id },
    });
    expect(entry.actorUserId).toBe(admin.userId);
    expect(entry.metadata).toMatchObject({
      domain: source.domain,
      from: 'review',
      to: 'approved',
      basis: 'permission',
      robots: 'allowed',
      terms: 'disallowed',
      vendors: ['mock'],
      maxProxyClass: 'none',
    });
  });

  it('sends an approved site back to review when what was approved changes', async () => {
    const source = await approved({
      maxProxyClass: 'datacenter',
      requestsPerMinute: 30,
      maxConcurrency: 2,
      nightStartHour: 2,
      nightEndHour: 4,
    });
    // A new name changes nothing that was approved, and resets nothing to a default.
    const renamed = await patch(source.id, { name: 'Sample Hotels Ltd' });
    expect(renamed.body).toMatchObject({
      name: 'Sample Hotels Ltd',
      status: 'approved',
      basis: 'public_data_assessment',
      robots: 'allowed',
      terms: 'silent',
      maxProxyClass: 'datacenter',
      requestsPerMinute: 30,
      maxConcurrency: 2,
      nightStartHour: 2,
      nightEndHour: 4,
    });
    // Neither does a recipe: it can only read the public fields, whoever writes it.
    const recipe = await patch(source.id, {
      recipes: { hotel: { version: 'hotel-v2', methods: [SELECTORS] } },
    });
    expect(recipe.body).toMatchObject({ status: 'approved', maxProxyClass: 'datacenter' });
    expect((await patch(source.id, {})).status).toBe(400);

    const widened = await patch(source.id, { maxProxyClass: 'residential' });
    expect(widened.body).toMatchObject({
      status: 'review',
      basis: null,
      basisReference: null,
      maxProxyClass: 'residential',
      requestsPerMinute: 30,
      readable: 'review_mock_only',
    });
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'price_intel.source_updated', targetId: source.id },
      orderBy: { id: 'desc' },
    });
    expect(entry.metadata).toMatchObject({
      backToReview: true,
      changes: { maxProxyClass: { from: 'datacenter', to: 'residential' } },
    });
  });

  it('reads prices into observations with public facts only, and answers again from them', async () => {
    const source = await approved();
    const first = await read(source.id);
    expect(first).toMatchObject({ state: 'read', failure: null });
    expect(first.observations).toHaveLength(3);
    for (const observation of first.observations) {
      expect(observation).toMatchObject({
        indicative: true,
        stale: false,
        availability: 'available',
        price: { currency: 'NGN' },
      });
      expect(Number.isInteger(observation.price.amountMinor)).toBe(true);
      expect(observation.price.amountMinor).toBeGreaterThan(0);
      for (const key of Object.keys(observation.item)) {
        expect(PUBLIC_ITEM_FIELDS).toContain(key);
      }
    }
    // Cheapest first, as stored.
    const amounts = first.observations.map((observation) => observation.price.amountMinor);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({
      url: `https://${source.domain}/search?city=Lagos&in=${day(30)}&out=${day(32)}&adults=2`,
      domain: source.domain,
      country: 'NG',
      proxyClass: 'none',
    });

    // The page held a reviewer's name, a phone number and an email address. None is stored.
    const stored = JSON.stringify(
      await ctx.prisma.priceObservation.findMany(),
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    );
    for (const personal of ['Adaeze', 'Okafor', '555 01', 'bookings@', 'review']) {
      expect(stored).not.toContain(personal);
    }

    // The same question again is answered without another fetch, whatever order its fields have.
    const again = await read(source.id, {
      adults: 2,
      to: day(32),
      from: day(30),
      place: ' lagos ',
    });
    expect(again.state).toBe('fresh');
    expect(again.observations.map((observation) => observation.id)).toEqual(
      first.observations.map((observation) => observation.id),
    );
    expect(mock.calls).toHaveLength(1);
    // Another question is another read.
    expect((await read(source.id, { place: 'Abuja' })).state).toBe('read');
    expect(mock.calls).toHaveLength(2);

    const job = await ctx.prisma.scrapeJob.findUniqueOrThrow({ where: { id: first.jobId ?? '' } });
    expect(job).toMatchObject({
      status: 'succeeded',
      trigger: 'staff',
      attemptCount: 1,
      observationCount: 3,
    });
    expect(job.query).toEqual({
      place: 'Lagos',
      from: day(30),
      to: day(32),
      adults: 2,
      children: 0,
      rooms: 1,
    });
  });

  it('keeps nothing about a person from a question either', async () => {
    const source = await approved();
    const response = await ctx
      .http()
      .post(`/v1/admin/data-sources/${source.id}/read`)
      .set(as(admin))
      .send({
        product: 'hotel',
        query: { ...query(), guestName: 'Ada Obi', email: 'ada@example.com', userId: admin.userId },
      });
    expect(response.status).toBe(200);
    const job = await ctx.prisma.scrapeJob.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect(Object.keys(job.query as object).sort()).toEqual(
      ['adults', 'children', 'from', 'place', 'rooms', 'to'].sort(),
    );
    expect(mock.calls[0]?.url).not.toContain('ada');
    // A place that is not a place name does not reach a page address.
    const odd = await ctx
      .http()
      .post(`/v1/admin/data-sources/${source.id}/read`)
      .set(as(admin))
      .send({ product: 'hotel', query: query({ place: 'x&redirect=https://evil.example.net' }) });
    expect(odd.status).toBe(400);
    expect(mock.calls).toHaveLength(1);
  });

  it('never reads a blocked site, and gives none of its old prices', async () => {
    const source = await approved();
    expect((await read(source.id)).state).toBe('read');
    const blocked = await ctx
      .http()
      .post(`/v1/admin/data-sources/${source.id}/block`)
      .set(as(admin));
    expect(blocked.body).toMatchObject({ status: 'blocked', readable: 'blocked', basis: null });

    const result = await read(source.id);
    expect(result).toMatchObject({
      state: 'denied',
      failure: 'policy_denied',
      reason: 'blocked',
      observations: [],
    });
    const fresh = await read(source.id, { place: 'Abuja' });
    expect(fresh.state).toBe('denied');
    expect(mock.calls).toHaveLength(1);
    const job = await ctx.prisma.scrapeJob.findUniqueOrThrow({ where: { id: result.jobId ?? '' } });
    expect(job).toMatchObject({ status: 'denied', failureClass: 'policy_denied', attemptCount: 0 });

    // A blocked site is not approved in one step, whatever the basis: review comes first.
    const straight = await approve(source.id, {
      basis: 'permission',
      basisReference: 'Letter of 2026-11-02, file PI-2026-031',
    });
    expect(straight.status).toBe(409);
    expect((straight.body as { type: string }).type).toContain('price-source-blocked');
    expect(
      await ctx.prisma.sourcePolicy.findUniqueOrThrow({ where: { sourceId: source.id } }),
    ).toMatchObject({ status: 'blocked', basis: null });

    // Inactive is the same; review answers again, from the mock only.
    await ctx.http().post(`/v1/admin/data-sources/${source.id}/review`).set(as(admin)).expect(200);
    expect((await patch(source.id, { active: false })).body).toMatchObject({
      readable: 'inactive',
    });
    expect((await read(source.id, { place: 'Kano' })).reason).toBe('inactive');
    expect(mock.calls).toHaveLength(1);
  });

  it('answers a site in review from the mock only, whatever vendors it names', async () => {
    // A real vendor in the chain, which this environment has not enabled.
    const source = await create({ vendors: ['firecrawl', 'mock'] });
    const result = await read(source.id);
    expect(result.state).toBe('read');
    expect(await attemptsOf(result.jobId)).toEqual([['mock', 'none', 'ok']]);
  });

  it('fails over one proxy class at a time and never above the policy', async () => {
    const source = await approved({ maxProxyClass: 'datacenter' });
    mock.script(source.domain, [
      { fail: 'blocked', httpStatus: 403 },
      { fail: 'blocked', httpStatus: 429, retryAfterMs: 90_000 },
    ]);
    const result = await read(source.id);
    expect(result).toMatchObject({ state: 'exhausted', failure: 'blocked', reason: 'chain_spent' });
    // One escalation to the allowed class, and no further.
    expect(await attemptsOf(result.jobId)).toEqual([
      ['mock', 'none', 'blocked'],
      ['mock', 'datacenter', 'blocked'],
    ]);
    expect(mock.calls.map((call) => call.proxyClass)).toEqual(['none', 'datacenter']);
    // The site is approached at half speed or less afterwards, and left alone for as long as
    // it asked (`Retry-After`), which every replica reads from Redis.
    expect(await ctx.app.get(DomainThrottle).penalty(source.domain)).toBeGreaterThanOrEqual(2);
    const pause = await ctx.redis.pttl(`pi:pause:${source.domain}`);
    expect(pause).toBeGreaterThan(60_000);
    expect(pause).toBeLessThanOrEqual(90_000);
  });

  it('retries a timeout once, reads with rendering after an empty page, and records each try', async () => {
    const source = await approved();
    mock.script(source.domain, [
      { fail: 'timeout' },
      { page: { html: '<html><body><div id="app"></div></body></html>' } },
    ]);
    const result = await read(source.id);
    expect(result.state).toBe('read');
    expect(await attemptsOf(result.jobId)).toEqual([
      ['mock', 'none', 'timeout'],
      ['mock', 'none', 'empty_or_unrendered'],
      ['mock', 'none', 'ok'],
    ]);
    expect(mock.calls.map((call) => call.render)).toEqual([false, false, true]);
    const job = await ctx.prisma.scrapeJob.findUniqueOrThrow({ where: { id: result.jobId ?? '' } });
    expect(job).toMatchObject({ status: 'succeeded', attemptCount: 3 });
    // The timeout and the two fetched pages were paid for (100 micro-dollars each at this class).
    expect(Number(job.costMicroUsd)).toBe(300);
  });

  it("opens the vendor's breaker for every replica when its quota is spent", async () => {
    const source = await approved();
    mock.script(source.domain, [{ fail: 'quota_exhausted', retryAfterMs: 30_000 }]);
    expect(await read(source.id)).toMatchObject({ state: 'exhausted', failure: 'quota_exhausted' });
    expect(await ctx.redis.pttl('pi:breaker:open:mock')).toBeGreaterThan(20_000);
    // Until it resets the vendor is not called at all, for any site.
    const other = await approved();
    const skipped = await read(other.id);
    expect(skipped).toMatchObject({ state: 'denied', reason: 'breaker_open' });
    expect(mock.calls).toHaveLength(1);
  });

  it('gives old observations marked stale when a read fails, never as fresh', async () => {
    const source = await approved();
    const first = await read(source.id);
    await ctx.prisma.priceObservation.updateMany({
      where: { sourceId: source.id },
      data: { freshUntil: new Date(Date.now() - 60_000) },
    });
    mock.script(source.domain, [{ fail: 'provider_error' }, { fail: 'provider_error' }]);
    const stale = await read(source.id);
    expect(stale).toMatchObject({ state: 'stale', failure: 'provider_error' });
    expect(stale.observations.map((observation) => observation.id)).toEqual(
      first.observations.map((observation) => observation.id),
    );
    expect(stale.observations.every((observation) => observation.stale)).toBe(true);
    // With the vendor back, the same question is read again.
    const fresh = await read(source.id);
    expect(fresh.state).toBe('read');
    expect(fresh.observations.every((observation) => !observation.stale)).toBe(true);
  });

  it('reads one question once when it is asked twice at the same time', async () => {
    const source = await approved();
    const [a, b] = await Promise.all([read(source.id), read(source.id)]);
    expect([a.state, b.state].sort()).toEqual(['fresh', 'read']);
    expect(mock.calls).toHaveLength(1);
    expect(await ctx.redis.keys('pi:flight:*')).toEqual([]);
  });

  it('stops everything, a vendor or a site within one request, and needs ai rights to do it', async () => {
    const source = await approved();
    const other = await approved();
    const flip = (path: 'stop' | 'release', body: Record<string, unknown>, session = admin) =>
      ctx.http().post(`/v1/admin/data-sources/switches/${path}`).set(as(session)).send(body);
    expect((await flip('stop', { scope: 'global' }, support)).status).toBe(403);
    expect((await flip('stop', { scope: 'vendor', subject: 'scrapy' })).status).toBe(422);
    expect((await flip('stop', { scope: 'global', subject: 'x' })).status).toBe(400);

    // One site.
    expect(
      (await flip('stop', { scope: 'domain', subject: `https://www.${source.domain}/x` })).status,
    ).toBe(200);
    expect(await read(source.id)).toMatchObject({ state: 'denied', reason: 'switched_off' });
    expect((await read(other.id)).state).toBe('read');
    const listed = (await ctx.http().get('/v1/admin/data-sources').set(as(admin))).body as {
      items: Source[];
    };
    expect(listed.items.find((item) => item.id === source.id)?.readable).toBe('switched_off');
    expect((await flip('stop', { scope: 'domain', subject: source.domain })).status).toBe(409);
    expect((await flip('release', { scope: 'domain', subject: source.domain })).status).toBe(200);
    expect((await read(source.id)).state).toBe('read');

    // One vendor: the only one this site has.
    await flip('stop', { scope: 'vendor', subject: 'mock' }).expect(200);
    expect(await read(source.id, { place: 'Abuja' })).toMatchObject({
      state: 'denied',
      reason: 'switched_off',
    });
    await flip('release', { scope: 'vendor', subject: 'mock' }).expect(200);

    // Everything.
    const stopped = await flip('stop', { scope: 'global' });
    expect(stopped.body).toEqual({ items: [{ scope: 'global', subject: null }] });
    expect((await read(source.id, { place: 'Kano' })).reason).toBe('switched_off');
    expect((await read(other.id, { place: 'Kano' })).reason).toBe('switched_off');
    expect((await flip('release', { scope: 'global' })).body).toEqual({ items: [] });
    expect((await flip('release', { scope: 'global' })).status).toBe(409);
    expect((await read(source.id, { place: 'Kano' })).state).toBe('read');

    const audit = await ctx.prisma.auditLog.findMany({
      where: {
        action: { in: ['price_intel.switched_off', 'price_intel.switched_on'] },
        actorUserId: admin.userId,
      },
      orderBy: { id: 'asc' },
    });
    expect(
      audit.map((entry) => [entry.action, (entry.metadata as { scope: string }).scope]),
    ).toEqual([
      ['price_intel.switched_off', 'domain'],
      ['price_intel.switched_on', 'domain'],
      ['price_intel.switched_off', 'vendor'],
      ['price_intel.switched_on', 'vendor'],
      ['price_intel.switched_off', 'global'],
      ['price_intel.switched_on', 'global'],
    ]);
    // A switch nobody can read stops everything.
    await ctx.redis.set('pi:kill', 'not-a-set');
    expect((await read(source.id, { place: 'Jos' })).reason).toBe('switched_off');
  });

  it('stops reading at a budget, and tells staff once as it fills', async () => {
    // The audit log is never emptied: only what this test adds counts.
    const since = new Date();
    const source = await approved();
    const setBudget = (body: Record<string, unknown>, session = admin) =>
      ctx.http().put('/v1/admin/data-sources/budgets').set(as(session)).send(body);
    expect(
      (
        await setBudget(
          { scope: 'domain', subject: source.domain, dailyCapMicroUsd: 1, monthlyCapMicroUsd: 1 },
          support,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await setBudget({
          scope: 'domain',
          subject: source.domain,
          dailyCapMicroUsd: 500,
          monthlyCapMicroUsd: 100,
        })
      ).status,
    ).toBe(422);
    // A read costs 100 micro-dollars here: the site may spend 250 a day.
    const set = await setBudget({
      scope: 'domain',
      subject: source.domain,
      dailyCapMicroUsd: 250,
      monthlyCapMicroUsd: 100_000,
    });
    expect(set.body).toMatchObject({ dailyCapMicroUsd: 250, spentTodayMicroUsd: 0, set: true });

    expect((await read(source.id, { place: 'Lagos' })).state).toBe('read');
    expect((await read(source.id, { place: 'Abuja' })).state).toBe('read');
    const third = await read(source.id, { place: 'Kano' });
    expect(third).toMatchObject({
      state: 'denied',
      failure: 'policy_denied',
      reason: 'budget_domain_day',
    });
    expect(mock.calls).toHaveLength(2);

    const overview = (await ctx.http().get('/v1/admin/data-sources/overview').set(as(admin)))
      .body as {
      enabled: boolean;
      vendors: { vendor: string; ok: boolean }[];
      budgets: {
        scope: string;
        subject: string;
        spentTodayMicroUsd: number;
        dailyCapMicroUsd: number;
      }[];
      sources: { approved: number };
    };
    expect(overview.enabled).toBe(true);
    expect(overview.vendors).toEqual([expect.objectContaining({ vendor: 'mock', ok: true })]);
    expect(overview.sources.approved).toBe(1);
    expect(overview.budgets.find((line) => line.subject === source.domain)).toMatchObject({
      spentTodayMicroUsd: 200,
      dailyCapMicroUsd: 250,
    });
    // 100 of 250 is under half; 200 of 250 is 80%: told once at 80, not again at 50.
    const alerts = await ctx.prisma.auditLog.findMany({
      where: { action: 'price_intel.budget_alert', occurredAt: { gte: since } },
      orderBy: { id: 'asc' },
    });
    expect(
      alerts
        .map(
          (entry) =>
            entry.metadata as { scope: string; subject: string; period: string; level: string },
        )
        .filter(
          (alert) =>
            alert.scope === 'domain' && alert.subject === source.domain && alert.period === 'day',
        )
        .map((alert) => alert.level),
    ).toEqual(['80%']);
    // Raising the cap lets it read again.
    await setBudget({
      scope: 'domain',
      subject: source.domain,
      dailyCapMicroUsd: 1000,
      monthlyCapMicroUsd: 100_000,
    }).expect(200);
    expect((await read(source.id, { place: 'Kano' })).state).toBe('read');
    const change = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'price_intel.budget_changed' },
      orderBy: { id: 'desc' },
    });
    expect(change.metadata).toMatchObject({
      scope: 'domain',
      subject: source.domain,
      from: { dailyCapMicroUsd: 250 },
      to: { dailyCapMicroUsd: 1000 },
    });
  });

  it('keeps a page it could not read for diagnosis, and opens a drift incident after enough of them', async () => {
    const source = await approved();
    const storage = ctx.app.get(ObjectStorage);
    let last: ReadResult | null = null;
    for (let attempt = 0; attempt < DRIFT_MIN_FAILURES; attempt += 1) {
      // Rendering is tried once, so each read is two unreadable pages.
      mock.script(source.domain, [{ page: { html: UNREADABLE } }, { page: { html: UNREADABLE } }]);
      last = await read(source.id, { place: `Town ${String.fromCharCode(65 + attempt)}` });
      expect(last).toMatchObject({ state: 'exhausted', failure: 'parse_failed' });
    }
    const attempts = await ctx.prisma.scrapeAttempt.findMany({
      where: { jobId: last?.jobId ?? '' },
      orderBy: { id: 'asc' },
    });
    expect(
      attempts.map((attempt) => [attempt.outcome, attempt.rendered, attempt.snapshotKey !== null]),
    ).toEqual([
      ['parse_failed', false, false],
      ['parse_failed', true, true],
    ]);
    const kept = await storage.get(attempts[1]?.snapshotKey ?? '');
    expect(kept?.toString('utf8')).toBe(UNREADABLE);

    // The incident is open: staff are told once, and the site reads with its next method.
    const drifted = (
      (await ctx.http().get('/v1/admin/data-sources').set(as(admin))).body as { items: Source[] }
    ).items[0];
    expect(drifted?.drift).toMatchObject({ parserVersion: 'hotel-v1' });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'price_intel.drift_detected', targetId: source.id },
      }),
    ).toBe(1);
    const next = await read(source.id, { place: 'Ibadan' });
    expect(next.state).toBe('read');
    const methods = await ctx.prisma.priceObservation.findMany({
      where: { jobId: next.jobId ?? '' },
      select: { method: true, parserVersion: true },
    });
    expect(new Set(methods.map((row) => row.method))).toEqual(new Set(['selectors']));

    // A person changes the recipe: the incident closes and the first method is tried again.
    const fixed = await patch(source.id, {
      recipes: { hotel: { version: 'hotel-v2', methods: [STRUCTURED, SELECTORS] } },
    });
    expect(fixed.body).toMatchObject({ drift: null, status: 'approved' });
    const after = await read(source.id, { place: 'Enugu' });
    const versions = await ctx.prisma.priceObservation.findMany({
      where: { jobId: after.jobId ?? '' },
      select: { method: true, parserVersion: true },
    });
    expect(versions[0]).toEqual({ method: 'structured_data', parserVersion: 'hotel-v2' });

    // The retention sweep removes the page after a week and leaves the attempt.
    await ctx.prisma.scrapeAttempt.updateMany({
      where: { snapshotKey: { not: null } },
      data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    const sweep = await ctx
      .http()
      .post('/v1/internal/retention/run')
      .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`)
      .expect(200);
    expect((sweep.body as Record<string, number>)['price-snapshots']).toBe(DRIFT_MIN_FAILURES);
    expect(await storage.get(attempts[1]?.snapshotKey ?? '')).toBeNull();
    expect(await ctx.prisma.scrapeAttempt.count({ where: { snapshotKey: { not: null } } })).toBe(0);
  });

  it('scores a price against its history and rejects one far below it', async () => {
    // This site's pages say their prices include taxes and fees, and its recipe records that.
    const source = await approved({
      recipes: {
        hotel: { version: 'hotel-v1', methods: [STRUCTURED, SELECTORS], taxesIncluded: true },
      },
    });
    // Six reads of the same hotels on other nights give each hotel a history.
    for (let night = 0; night < 6; night += 1) {
      mock.script(source.domain, [{ page: { html: hotelPage(source.domain, 100_000) } }]);
      await read(source.id, { from: day(40 + night), to: day(41 + night) });
    }
    const typical = await ctx.prisma.priceObservation.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect(typical).toMatchObject({ status: 'verified', flags: [], taxesIncluded: true });
    expect(typical.confidence).toBeGreaterThanOrEqual(85);
    // A site that does not say is read all the same, and says so on every price.
    const silent = await approved();
    mock.script(silent.domain, [{ page: { html: hotelPage(silent.domain, 100_000) } }]);
    const unknown = await read(silent.id);
    expect(unknown.observations[0]).toMatchObject({ taxesIncluded: null });
    expect(
      (
        await ctx.prisma.priceObservation.findFirstOrThrow({
          where: { jobId: unknown.jobId ?? '' },
        })
      ).flags,
    ).toContain('taxes_unknown');

    // A tenth of the usual price is more likely a wrong field than a bargain.
    mock.script(source.domain, [{ page: { html: hotelPage(source.domain, 10_000) } }]);
    const low = await read(source.id, { from: day(60), to: day(61) });
    // A rejected observation is stored for staff and shown to nobody.
    expect(low).toMatchObject({ state: 'read', observations: [] });
    const rejected = await ctx.prisma.priceObservation.findFirstOrThrow({
      where: { jobId: low.jobId ?? '' },
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.flags).toContain('outlier_low');

    // A price in another currency than the market's is never verified.
    mock.script(source.domain, [{ page: { html: hotelPage(source.domain, 100_000, 'USD') } }]);
    const foreign = await read(source.id, { from: day(62), to: day(63) });
    const odd = await ctx.prisma.priceObservation.findFirstOrThrow({
      where: { jobId: foreign.jobId ?? '' },
    });
    expect(odd.flags).toContain('currency_mismatch');
    expect(odd.status).not.toBe('verified');
  });

  it("re-reads stale answers only inside a site's night, through the worker's route", async () => {
    const hour = new Date().getUTCHours();
    // Lagos is an hour ahead of UTC: one site is in its night now, the other is not.
    const local = (hour + 1) % 24;
    const night = await approved({ nightStartHour: local, nightEndHour: (local + 2) % 24 });
    const awake = await approved({
      nightStartHour: (local + 6) % 24,
      nightEndHour: (local + 8) % 24,
    });
    const review = await create({ nightStartHour: local, nightEndHour: (local + 2) % 24 });
    for (const source of [night, awake, review]) await read(source.id);
    // A question about a day that has passed is nobody's question any more.
    await ctx.prisma.scrapeJob.create({
      data: {
        sourceId: night.id,
        product: 'hotel',
        canonicalKey: 'past'.padEnd(64, '0'),
        query: { place: 'Lagos', from: day(-3), to: day(-1), adults: 1, children: 0, rooms: 1 },
        trigger: 'staff',
        status: 'succeeded',
      },
    });
    await ctx.prisma.priceObservation.updateMany({
      data: { freshUntil: new Date(Date.now() - 1000) },
    });
    mock.reset();

    const sweep = () =>
      ctx
        .http()
        .post('/v1/internal/price-intel/sweep')
        .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`);
    expect((await ctx.http().post('/v1/internal/price-intel/sweep')).status).toBe(401);
    const first = await sweep().expect(200);
    expect(first.body).toEqual({ sources: 1, read: 1, failed: 0 });
    expect(mock.calls.map((call) => call.domain)).toEqual([night.domain]);
    const job = await ctx.prisma.scrapeJob.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect(job).toMatchObject({ sourceId: night.id, trigger: 'schedule', status: 'succeeded' });
    // Fresh again: a second sweep reads nothing.
    expect((await sweep().expect(200)).body).toEqual({ sources: 1, read: 0, failed: 0 });
  });

  it('holds the rate, the concurrency and a pause across replicas', async () => {
    const throttle = ctx.app.get(DomainThrottle);
    const policy = { requestsPerMinute: 120, maxConcurrency: 1 };
    const signal = new AbortController().signal;
    const acquire = (deadlineMs: number) =>
      throttle.acquire(
        'mock',
        'slow.example.com',
        policy,
        Date.now() + deadlineMs,
        signal,
        () => 0,
      );

    const started = Date.now();
    const lease = await acquire(200);
    // The one slot is taken: a second read cannot start before its deadline.
    await expect(acquire(300)).rejects.toMatchObject({ failure: 'timeout' });
    await lease.release();
    await lease.release();
    // The slot is free, but 120 a minute is one every half second: the next read starts no
    // sooner than that after the first, however long the wait for the slot took.
    const second = await acquire(2000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    await second.release();

    // A refusal halves the speed; a Retry-After pauses the site for that long.
    await throttle.penalise('slow.example.com');
    expect(await throttle.penalty('slow.example.com')).toBe(2);
    await throttle.penalise('slow.example.com', 60_000);
    expect(await throttle.penalty('slow.example.com')).toBe(4);
    await expect(acquire(400)).rejects.toMatchObject({ failure: 'timeout' });
    // The penalty halves back with time.
    expect(await throttle.penalty('slow.example.com', Date.now() + 10 * 60_000)).toBe(2);
    expect(await throttle.penalty('slow.example.com', Date.now() + 30 * 60_000)).toBe(1);
  });

  it('says how reading has gone: each vendor and site, breakers and what a price cost', async () => {
    const good = await approved();
    const refused = await approved({ maxProxyClass: 'datacenter' });
    await read(good.id);
    mock.script(refused.domain, [
      { fail: 'blocked', httpStatus: 403 },
      { fail: 'blocked', httpStatus: 403 },
    ]);
    await read(refused.id);
    const spent = async (domain: string) =>
      Number(
        (
          await ctx.prisma.scrapeJob.aggregate({
            where: { source: { domain } },
            _sum: { costMicroUsd: true },
          })
        )._sum.costMicroUsd ?? 0n,
      );
    const kept = await ctx.prisma.priceObservation.count({ where: { sourceId: good.id } });
    expect(kept).toBeGreaterThan(0);

    const response = await ctx.http().get('/v1/admin/data-sources/health').set(as(support));
    expect(response.status).toBe(200);
    const health = response.body as {
      from: string;
      to: string;
      vendors: Record<string, unknown>[];
      sites: Record<string, unknown>[];
      drift: unknown[];
    };
    expect(Date.parse(health.to) - Date.parse(health.from)).toBe(24 * 3_600_000);
    const goodCost = await spent(good.domain);
    const refusedCost = await spent(refused.domain);
    // Three attempts through the one vendor: one usable page, two refusals.
    expect(health.vendors).toEqual([
      {
        vendor: 'mock',
        attempts: 3,
        ok: 1,
        blocked: 2,
        successRateBps: 3333,
        blockRateBps: 6667,
        medianMs: expect.any(Number) as unknown,
        costMicroUsd: goodCost + refusedCost,
        costPerSuccessMicroUsd: goodCost + refusedCost,
        breakerOpen: false,
      },
    ]);
    // The busier site first; what a kept price cost only where one was kept.
    expect(health.sites).toEqual([
      {
        domain: refused.domain,
        attempts: 2,
        ok: 0,
        blocked: 2,
        successRateBps: 0,
        blockRateBps: 10_000,
        medianMs: expect.any(Number) as unknown,
        costMicroUsd: refusedCost,
        observations: 0,
        costPerObservationMicroUsd: null,
      },
      {
        domain: good.domain,
        attempts: 1,
        ok: 1,
        blocked: 0,
        successRateBps: 10_000,
        blockRateBps: 0,
        medianMs: expect.any(Number) as unknown,
        costMicroUsd: goodCost,
        observations: kept,
        costPerObservationMicroUsd: Math.round(goodCost / kept),
      },
    ]);
    expect(health.drift).toEqual([]);

    // A vendor whose quota is spent is shown as skipped, and an old window holds nothing.
    const third = await approved();
    mock.script(third.domain, [{ fail: 'quota_exhausted', retryAfterMs: 30_000 }]);
    await read(third.id);
    const after = (await ctx.http().get('/v1/admin/data-sources/health?hours=1').set(as(support)))
      .body as { vendors: { breakerOpen: boolean; attempts: number }[] };
    expect(after.vendors[0]).toMatchObject({ breakerOpen: true, attempts: 4 });
    expect(
      (await ctx.http().get('/v1/admin/data-sources/health?hours=0').set(as(support))).status,
    ).toBe(400);
    // Nobody without the assistant's read permission.
    const outsider = await staffSession(ctx, 'intel-content@suskii.test', ['content_manager']);
    expect((await ctx.http().get('/v1/admin/data-sources/health').set(as(outsider))).status).toBe(
      403,
    );
  });

  it('gives the register of sites and the reads with their attempts', async () => {
    const open = await approved();
    const closed = await create();
    await ctx.http().post(`/v1/admin/data-sources/${closed.id}/block`).set(as(admin)).expect(200);
    await read(open.id);

    const register = (await ctx.http().get('/v1/admin/data-sources/register').set(as(support)))
      .body as {
      rows: Record<string, unknown>[];
    };
    expect(register.rows).toEqual([
      expect.objectContaining({
        domain: open.domain,
        status: 'approved',
        basis: 'public_data_assessment',
        basisReference: 'Legal file PI-2026-014',
        robots: 'allowed',
        terms: 'silent',
        vendors: ['mock'],
        maxProxyClass: 'none',
      }),
      expect.objectContaining({
        domain: closed.domain,
        status: 'blocked',
        basis: null,
        decidedAt: expect.any(String) as unknown,
      }),
    ]);

    const jobs = (
      await ctx.http().get(`/v1/admin/data-sources/jobs?sourceId=${open.id}`).set(as(support))
    ).body as {
      items: { status: string; domain: string; attempts: Record<string, unknown>[] }[];
    };
    expect(jobs.items).toHaveLength(1);
    expect(jobs.items[0]).toMatchObject({ status: 'succeeded', domain: open.domain });
    expect(jobs.items[0]?.attempts).toEqual([
      expect.objectContaining({
        vendor: 'mock',
        proxyClass: 'none',
        outcome: 'ok',
        hasSnapshot: false,
      }),
    ]);
    const observations = (
      await ctx
        .http()
        .get(`/v1/admin/data-sources/${open.id}/observations?limit=2`)
        .set(as(support))
    ).body as { items: Observation[] };
    expect(observations.items).toHaveLength(2);
    expect(
      (
        await ctx
          .http()
          .get('/v1/admin/data-sources/00000000-0000-7000-8000-000000000000/observations')
          .set(as(admin))
      ).status,
    ).toBe(404);
  });
});

/** A page with one hotel at a chosen price, to give it a history. */
function hotelPage(domain: string, price: number, currency = 'NGN'): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Hotel',
    name: 'Harbour View Hotel',
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: currency,
      url: `https://${domain}/harbour-view`,
    },
  };
  return `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body><h1>Harbour View Hotel</h1></body></html>`;
}

describe('price intelligence switched off (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, PRICE_INTEL_ENABLED: false });
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('reads nothing and sweeps nothing, while sites can still be listed and reviewed', async () => {
    const admin = await staffSession(ctx, 'intel-off@suskii.test', ['super_admin']);
    const created = await ctx
      .http()
      .post('/v1/admin/data-sources')
      .set(bearer(admin.accessToken))
      .send({
        domain: 'off.example.com',
        name: 'Off',
        products: ['hotel'],
        country: 'NG',
        currency: 'NGN',
        locale: 'en-NG',
        urlTemplates: { hotel: 'https://off.example.com/search?city={place}' },
        recipes: { hotel: { version: 'v1', methods: [STRUCTURED] } },
        vendors: ['mock'],
        timeZone: 'Africa/Lagos',
      });
    expect(created.status).toBe(201);
    const read = await ctx
      .http()
      .post(`/v1/admin/data-sources/${(created.body as Source).id}/read`)
      .set(bearer(admin.accessToken))
      .send({ product: 'hotel', query: { place: 'Lagos', from: day(10) } });
    expect(read.status).toBe(404);
    expect(ctx.app.get(MockScrapeProvider).calls).toHaveLength(0);
    const sweep = await ctx
      .http()
      .post('/v1/internal/price-intel/sweep')
      .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`);
    expect(sweep.body).toEqual({ sources: 0, read: 0, failed: 0 });
    const overview = await ctx
      .http()
      .get('/v1/admin/data-sources/overview')
      .set(bearer(admin.accessToken));
    expect((overview.body as { enabled: boolean }).enabled).toBe(false);
  });
});
