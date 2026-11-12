import { breakerMarkKey } from '../src/suppliers/breaker-marks';

import { staffSession } from './helpers/admin';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The public status page (ADR-087): measured component states, incidents staff open, update and
 * resolve, the shared cache and the edge headers; only `status:manage` may write.
 */

interface StatusPage {
  state: string;
  components: { id: string; state: string }[];
  incidents: {
    id: string;
    title: string;
    status: string;
    resolvedAt: string | null;
    updates: { status: string; message: string }[];
  }[];
}

describe('status page (e2e)', () => {
  let ctx: TestContext;
  let agent: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    agent = await staffSession(ctx, 'status-agent@suskii.test', ['support']);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const status = async (): Promise<StatusPage> =>
    (await ctx.http().get('/v1/status').expect(200)).body as StatusPage;
  const stateOf = (page: StatusPage, id: string) =>
    page.components.find((component) => component.id === id)?.state;

  it('answers publicly, cacheable at the edge, with every component operational', async () => {
    const response = await ctx.http().get('/v1/status').set('Accept-Encoding', 'gzip').expect(200);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=30, stale-while-revalidate=30, stale-if-error=86400',
    );
    const page = response.body as StatusPage;
    expect(page.state).toBe('operational');
    expect(page.components.map((component) => component.id)).toEqual([
      'search',
      'bookings',
      'payments',
      'accounts',
      'support',
    ]);
    expect(page.incidents).toEqual([]);
  });

  it('shows an open breaker from any instance as degraded search', async () => {
    await ctx.redis.set(breakerMarkKey('flights:mock'), '1', 'PX', 60_000);
    const page = await status();
    // The e2e app enables the mock for flights and hotels; only flights is failing.
    expect(stateOf(page, 'search')).toBe('degraded');
    expect(page.state).toBe('degraded');
  });

  it('lets support open, update and resolve an incident, shown at once and audited', async () => {
    await status(); // cached before the incident: the change must clear it
    const opened = await ctx
      .http()
      .post('/v1/admin/status/incidents')
      .set(bearer(agent.accessToken))
      .send({
        title: 'Card payments failing',
        impact: 'major',
        components: ['payments'],
        status: 'investigating',
        message: 'Some card payments fail. Bank transfers still work.',
      })
      .expect(201);
    const id = (opened.body as { id: string }).id;

    let page = await status();
    expect(stateOf(page, 'payments')).toBe('outage');
    expect(page.incidents).toEqual([
      expect.objectContaining({ id, title: 'Card payments failing', resolvedAt: null }),
    ]);

    await ctx
      .http()
      .post(`/v1/admin/status/incidents/${id}/updates`)
      .set(bearer(agent.accessToken))
      .send({ status: 'monitoring', impact: 'minor', message: 'A fix is out; we are watching.' })
      .expect(201);
    expect(stateOf(await status(), 'payments')).toBe('degraded');

    const resolved = await ctx
      .http()
      .post(`/v1/admin/status/incidents/${id}/updates`)
      .set(bearer(agent.accessToken))
      .send({ status: 'resolved', message: 'Card payments work again.' })
      .expect(201);
    expect((resolved.body as { resolvedAt: string | null }).resolvedAt).not.toBeNull();

    page = await status();
    expect(page.state).toBe('operational');
    expect(page.incidents[0]?.updates.map((update) => update.status)).toEqual([
      'resolved',
      'monitoring',
      'investigating',
    ]);

    await ctx
      .http()
      .post(`/v1/admin/status/incidents/${id}/updates`)
      .set(bearer(agent.accessToken))
      .send({ status: 'monitoring', message: 'Too late.' })
      .expect(409)
      .expect((response) => {
        expect((response.body as { type: string }).type).toMatch(/incident-resolved$/);
      });

    const actions = await ctx.prisma.auditLog.findMany({
      where: { targetType: 'status_incident', targetId: id },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { action: true, actorUserId: true, metadata: true },
    });
    expect(actions.map((entry) => entry.action)).toEqual([
      'status.incident_opened',
      'status.incident_updated',
      'status.incident_resolved',
    ]);
    expect(actions.every((entry) => entry.actorUserId === agent.userId)).toBe(true);
    expect(JSON.stringify(actions)).not.toContain('Card payments');
  });

  it('refuses invalid incidents and anyone without status:manage', async () => {
    const valid = {
      title: 'Slow search',
      impact: 'minor',
      components: ['search'],
      status: 'investigating',
      message: 'Searches are slow.',
    };
    await ctx
      .http()
      .post('/v1/admin/status/incidents')
      .set(bearer(agent.accessToken))
      .send({ ...valid, status: 'resolved' })
      .expect(400);
    await ctx
      .http()
      .post('/v1/admin/status/incidents')
      .set(bearer(agent.accessToken))
      .send({ ...valid, components: ['duffel'] })
      .expect(400);

    const finance = await staffSession(ctx, 'status-finance@suskii.test', ['finance']);
    await ctx
      .http()
      .post('/v1/admin/status/incidents')
      .set(bearer(finance.accessToken))
      .send(valid)
      .expect(403);
    const traveller = await signUp(ctx, 'status-traveller@example.com');
    await ctx
      .http()
      .get('/v1/admin/status/incidents')
      .set(bearer(traveller.accessToken))
      .expect(403);
    await ctx
      .http()
      .post('/v1/admin/status/incidents/0190f6a2-0000-7000-8000-000000000001/updates')
      .set(bearer(agent.accessToken))
      .send({ status: 'monitoring', message: 'Nothing here.' })
      .expect(404);
  });

  it('lists incidents for the console, open ones by filter', async () => {
    for (const title of ['First', 'Second']) {
      await ctx
        .http()
        .post('/v1/admin/status/incidents')
        .set(bearer(agent.accessToken))
        .send({
          title,
          impact: 'minor',
          components: ['support'],
          status: 'identified',
          message: 'Replies are slower than usual.',
        })
        .expect(201);
    }
    const list = await ctx
      .http()
      .get('/v1/admin/status/incidents')
      .query({ state: 'open', limit: 1 })
      .set(bearer(agent.accessToken))
      .expect(200);
    const body = list.body as { items: { title: string }[]; nextCursor: string | null };
    expect(body.items.map((item) => item.title)).toEqual(['Second']);
    expect(body.nextCursor).not.toBeNull();
  });

  it('still answers when the measurement cannot read the database', async () => {
    await ctx.redis.set(
      'status:incidents',
      JSON.stringify([
        {
          id: '0190f6a2-0000-7000-8000-00000000000a',
          title: 'Database maintenance',
          impact: 'major',
          status: 'identified',
          components: ['bookings'],
          startedAt: '2026-10-28T10:00:00.000Z',
          resolvedAt: null,
          updates: [],
        },
      ]),
    );
    const spy = jest
      .spyOn(ctx.prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('connection refused'));
    try {
      const page = await status();
      expect(stateOf(page, 'bookings')).toBe('outage');
      expect(stateOf(page, 'accounts')).toBe('outage');
      expect(page.incidents.map((incident) => incident.title)).toEqual(['Database maintenance']);
    } finally {
      spy.mockRestore();
    }
  });
});
