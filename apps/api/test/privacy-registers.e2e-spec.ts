import { staffSession } from './helpers/admin';
import { PASSWORD, bearer, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The data rights request and breach registers (ADR-089): due times from the jurisdiction,
 * self-service exports and deletions recorded as they happen, refusals with reasons, breach
 * notices per regulator, closing rules, encryption at rest, audit entries and permissions.
 */

interface RequestView {
  id: string;
  kind: string;
  jurisdiction: string;
  channel: string;
  status: string;
  userId: string | null;
  subjectEmail: string | null;
  receivedAt: string;
  dueAt: string;
  statutory: boolean;
  overdue: boolean;
  refusalReason: string | null;
}

interface BreachView {
  id: string;
  status: string;
  details?: string;
  notices: {
    jurisdiction: string;
    regulatorDueAt: string;
    decision: string;
    statutory: boolean;
    overdue: boolean;
  }[];
}

describe('privacy registers (e2e)', () => {
  let ctx: TestContext;
  let officer: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, CLIENT_COUNTRY_HEADER: 'cf-ipcountry' });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    officer = await staffSession(ctx, 'privacy-officer@suskii.test', ['privacy_officer']);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const listRequests = async (status?: 'open' | 'closed'): Promise<RequestView[]> =>
    (
      (
        await ctx
          .http()
          .get(`/v1/admin/privacy/requests${status ? `?status=${status}` : ''}`)
          .set(bearer(officer.accessToken))
          .expect(200)
      ).body as { items: RequestView[] }
    ).items;

  // The audit log is append-only and shared by every suite: look up this test's own entries.
  const audits = (action: string, targetId: string) =>
    ctx.prisma.auditLog.findMany({
      where: { action, targetId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });

  it('records a Kenyan access request due in 7 days, the email sealed and shown masked', async () => {
    const receivedAt = new Date(Date.now() - 2 * 86_400_000);
    const created = await ctx
      .http()
      .post('/v1/admin/privacy/requests')
      .set(bearer(officer.accessToken))
      .send({
        kind: 'access',
        jurisdiction: 'KE',
        channel: 'email',
        receivedAt: receivedAt.toISOString(),
        subjectEmail: 'wanjiru@example.com',
      })
      .expect(201);
    const request = created.body as RequestView;
    expect(request).toMatchObject({
      status: 'open',
      subjectEmail: 'w***@example.com',
      statutory: true,
      overdue: false,
    });
    expect(Date.parse(request.dueAt) - receivedAt.getTime()).toBe(7 * 86_400_000);

    const row = await ctx.prisma.privacyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.subjectEmailCiphertext).not.toContain('wanjiru');
    const [audit] = await audits('privacy.request_opened', request.id);
    expect(audit?.metadata).toEqual({ kind: 'access', jurisdiction: 'KE', channel: 'email' });
    expect(JSON.stringify(audit?.metadata)).not.toContain('wanjiru');
  });

  it('lists open requests by due time and flags the overdue ones', async () => {
    const open = (jurisdiction: string, daysAgo: number) =>
      ctx
        .http()
        .post('/v1/admin/privacy/requests')
        .set(bearer(officer.accessToken))
        .send({
          kind: 'erasure',
          jurisdiction,
          channel: 'support',
          receivedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
          subjectEmail: `${jurisdiction.toLowerCase()}@example.com`,
        })
        .expect(201);
    await open('NG', 1); // due in 29 days
    await open('KE', 20); // due 14 days after: 6 days late
    const items = await listRequests('open');
    expect(items.map((item) => [item.jurisdiction, item.overdue])).toEqual([
      ['KE', true],
      ['NG', false],
    ]);
  });

  it('closes a request once, refusing needs a reason, and late closes are audited as late', async () => {
    const created = await ctx
      .http()
      .post('/v1/admin/privacy/requests')
      .set(bearer(officer.accessToken))
      .send({
        kind: 'rectification',
        jurisdiction: 'KE',
        channel: 'phone',
        receivedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        subjectEmail: 'late@example.com',
      })
      .expect(201);
    const id = (created.body as RequestView).id;
    await ctx
      .http()
      .post(`/v1/admin/privacy/requests/${id}/close`)
      .set(bearer(officer.accessToken))
      .send({ outcome: 'refused' })
      .expect(400);
    const closed = await ctx
      .http()
      .post(`/v1/admin/privacy/requests/${id}/close`)
      .set(bearer(officer.accessToken))
      .send({ outcome: 'refused', reason: 'identity_not_verified' })
      .expect(201);
    expect(closed.body).toMatchObject({
      status: 'refused',
      refusalReason: 'identity_not_verified',
    });
    const again = await ctx
      .http()
      .post(`/v1/admin/privacy/requests/${id}/close`)
      .set(bearer(officer.accessToken))
      .send({ outcome: 'completed' })
      .expect(409);
    expect((again.body as { type: string }).type).toBe('urn:suskii:problem:request-closed');
    const [audit] = await audits('privacy.request_closed', id);
    expect(audit?.metadata).toEqual({
      outcome: 'refused',
      reason: 'identity_not_verified',
      late: true,
    });
  });

  it("records the traveller's own export and deletion, under their country's law", async () => {
    const traveller = await signUp(ctx, 'amina@example.com');
    await ctx
      .http()
      .post('/v1/me/data-export')
      .set(bearer(traveller.accessToken))
      .set('cf-ipcountry', 'KE')
      .send({ password: PASSWORD })
      .expect(200);
    await ctx
      .http()
      .post('/v1/me/deletion')
      .set(bearer(traveller.accessToken))
      .set('cf-ipcountry', 'ZA')
      .send({ password: PASSWORD, confirm: 'DELETE' })
      .expect(200);

    const closed = await listRequests('closed');
    expect(closed.map((item) => [item.kind, item.jurisdiction, item.channel, item.status])).toEqual(
      [
        ['erasure', 'ZA', 'self_service', 'completed'],
        ['access', 'KE', 'self_service', 'completed'],
      ],
    );
    expect(closed.every((item) => item.userId === traveller.userId)).toBe(true);
  });

  it('opens a breach with a notice per regulator due 72 hours after awareness, details sealed', async () => {
    const awareAt = new Date(Date.now() - 3_600_000);
    const opened = await ctx
      .http()
      .post('/v1/admin/privacy/breaches')
      .set(bearer(officer.accessToken))
      .send({
        title: 'Booking export emailed to the wrong address',
        details: 'One export for booking SK-12345 went to a mistyped address.',
        awareAt: awareAt.toISOString(),
        highRisk: false,
        categories: ['contact', 'booking'],
        jurisdictions: ['NG', 'ZA'],
        subjectsAffected: 1,
      })
      .expect(201);
    const breach = opened.body as BreachView;
    expect(breach.details).toContain('mistyped');
    expect(breach.notices.map((notice) => [notice.jurisdiction, notice.statutory])).toEqual([
      ['NG', true],
      ['ZA', false],
    ]);
    for (const notice of breach.notices) {
      expect(Date.parse(notice.regulatorDueAt) - awareAt.getTime()).toBe(72 * 3_600_000);
    }
    const row = await ctx.prisma.privacyBreach.findUniqueOrThrow({ where: { id: breach.id } });
    expect(row.detailsCiphertext).not.toContain('mistyped');

    // The list carries no details; the breach itself does.
    const list = await ctx
      .http()
      .get('/v1/admin/privacy/breaches')
      .set(bearer(officer.accessToken))
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('mistyped');
    const [audit] = await audits('privacy.breach_opened', breach.id);
    expect(JSON.stringify(audit?.metadata)).not.toContain('mistyped');
  });

  it('closes a breach only when every regulator was notified or found not to need it', async () => {
    const opened = await ctx
      .http()
      .post('/v1/admin/privacy/breaches')
      .set(bearer(officer.accessToken))
      .send({
        title: 'Lost staff laptop',
        details: 'Encrypted disk; no data copied as far as we know.',
        awareAt: new Date(Date.now() - 80 * 3_600_000).toISOString(),
        highRisk: true,
        categories: ['booking'],
        jurisdictions: ['NG', 'KE'],
      })
      .expect(201);
    const breach = opened.body as BreachView;
    expect(breach.notices.every((notice) => notice.overdue)).toBe(true);

    const early = await ctx
      .http()
      .post(`/v1/admin/privacy/breaches/${breach.id}/close`)
      .set(bearer(officer.accessToken))
      .expect(409);
    expect((early.body as { type: string }).type).toBe('urn:suskii:problem:notices-pending');

    await ctx
      .http()
      .post(`/v1/admin/privacy/breaches/${breach.id}/notices`)
      .set(bearer(officer.accessToken))
      .send({ decision: 'not_required', jurisdiction: 'ZA' })
      .expect(404);
    await ctx
      .http()
      .post(`/v1/admin/privacy/breaches/${breach.id}/notices`)
      .set(bearer(officer.accessToken))
      .send({
        decision: 'notified',
        jurisdiction: 'NG',
        regulatorNotifiedAt: new Date().toISOString(),
        regulatorReference: 'NDPC-2026-0042',
      })
      .expect(201);
    await ctx
      .http()
      .post(`/v1/admin/privacy/breaches/${breach.id}/notices`)
      .set(bearer(officer.accessToken))
      .send({ decision: 'not_required', jurisdiction: 'KE' })
      .expect(201);
    const closed = await ctx
      .http()
      .post(`/v1/admin/privacy/breaches/${breach.id}/close`)
      .set(bearer(officer.accessToken))
      .expect(201);
    expect(closed.body).toMatchObject({ status: 'closed' });
    const [notice] = await audits('privacy.breach_notice_recorded', breach.id);
    expect(notice?.metadata).toEqual({ jurisdiction: 'NG', decision: 'notified', late: true });
    await ctx
      .http()
      .post(`/v1/admin/privacy/breaches/${breach.id}/notices`)
      .set(bearer(officer.accessToken))
      .send({ decision: 'not_required', jurisdiction: 'NG' })
      .expect(409);
  });

  it('is only for privacy:manage', async () => {
    const support = await staffSession(ctx, 'support@suskii.test', ['support']);
    await ctx.http().get('/v1/admin/privacy/requests').set(bearer(support.accessToken)).expect(403);
    await ctx.http().get('/v1/admin/privacy/breaches').set(bearer(support.accessToken)).expect(403);
  });
});
