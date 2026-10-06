import { AuditService } from '../src/audit/audit.service';
import { parseIncidentArgs, revokeForIncident } from '../src/auth/incident-revocation';

import { committedOpenApi, staffSession } from './helpers/admin';
import { bearer, login, signUp, totp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * ADR-037 (phase 11): the concurrent-session cap, staff session lifetimes, step-up for the
 * riskiest admin actions, staff signing an account out everywhere and the incident command.
 */
const MINUTE = 60_000;
const problem = (slug: string) => `urn:suskii:problem:${slug}`;

describe('sessions: limits, staff lifetimes and step-up (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, MAX_ACTIVE_SESSIONS: 2 });
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('ends the least recently used session beyond the cap, never the new one', async () => {
    const first = await signUp(ctx, 'cap@example.com');
    const second = await login(ctx, 'cap@example.com');
    // Refreshing makes the first session the more recently used of the two.
    const refreshed = await ctx
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    const third = await login(ctx, 'cap@example.com');

    const me = (token: string) => ctx.http().get('/v1/me').set(bearer(token));
    expect((await me(second.accessToken)).body.type).toBe(problem('session-revoked'));
    await me(refreshed.body.accessToken as string).expect(200);
    await me(third.accessToken).expect(200);
    const sessions = await ctx
      .http()
      .get('/v1/me/sessions')
      .set(bearer(third.accessToken))
      .expect(200);
    expect(sessions.body.sessions.map((session: { id: string }) => session.id).sort()).toEqual(
      [first.sessionId, third.sessionId].sort(),
    );

    const evicted = await ctx.prisma.auditLog.findMany({
      where: { action: 'auth.session.evicted', actorUserId: first.userId },
    });
    expect(evicted).toHaveLength(1);
    expect(evicted[0]?.targetId).toBe(second.sessionId);
    expect(evicted[0]?.metadata).toEqual({ reason: 'session_limit', limit: 2, staff: false });
  });

  it('gives staff short sessions with an idle timeout and re-checks the lifetime on refresh', async () => {
    const staff = await staffSession(ctx, 'lifetime-staff@example.com', ['support']);
    const session = await ctx.prisma.session.findUniqueOrThrow({
      where: { id: staff.sessionId },
      include: { refreshTokens: true },
    });
    const created = session.createdAt.getTime();
    expect(session.expiresAt.getTime() - created).toBeCloseTo(12 * 60 * MINUTE, -4);
    expect((session.refreshTokens[0]?.expiresAt.getTime() ?? 0) - created).toBeCloseTo(
      30 * MINUTE,
      -4,
    );

    const customer = await signUp(ctx, 'lifetime-customer@example.com');
    const customerSession = await ctx.prisma.session.findUniqueOrThrow({
      where: { id: customer.sessionId },
      include: { refreshTokens: true },
    });
    expect(
      (customerSession.refreshTokens[0]?.expiresAt.getTime() ?? 0) -
        customerSession.createdAt.getTime(),
    ).toBeCloseTo(30 * 24 * 60 * MINUTE, -4);

    // A session started before the account became staff ends once it is older than the staff
    // lifetime, even though its own expiry is still 90 days out.
    await ctx.prisma.session.update({
      where: { id: staff.sessionId },
      data: { createdAt: new Date(Date.now() - 13 * 60 * MINUTE) },
    });
    const refused = await ctx
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: staff.refreshToken })
      .expect(401);
    expect(refused.body.type).toBe(problem('invalid-token'));
  });

  it('asks for a fresh authenticator code before the riskiest admin actions', async () => {
    const admin = await staffSession(ctx, 'step-up-admin@example.com', ['super_admin']);
    const target = await signUp(ctx, 'step-up-target@example.com');
    const setRoles = (roles: string[]) =>
      ctx
        .http()
        .put(`/v1/admin/users/${target.userId}/roles`)
        .set(bearer(admin.accessToken))
        .send({ roles });

    // The MFA sign-in counts for the window.
    await setRoles(['customer', 'support']).expect(200);

    await ctx.prisma.session.update({
      where: { id: admin.sessionId },
      data: { mfaVerifiedAt: new Date(Date.now() - 11 * MINUTE) },
    });
    const refused = await setRoles(['customer']).expect(403);
    expect(refused.body.type).toBe(problem('step-up-required'));
    // Reads and other admin routes are unaffected.
    await ctx
      .http()
      .get(`/v1/admin/users/${target.userId}`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const stepUp = (code: string) =>
      ctx.http().post('/v1/me/mfa/step-up').set(bearer(admin.accessToken)).send({ code });
    // The sign-in used the newest step; a later step stands in for "a minute later".
    await ctx.prisma.mfaFactor.update({
      where: { userId_type: { userId: admin.userId, type: 'totp' } },
      data: { lastUsedStep: null },
    });
    const current = totp(admin.secret);
    const wrong = current === '000000' ? '111111' : '000000';
    expect((await stepUp(wrong).expect(401)).body.type).toBe(problem('invalid-code'));
    const confirmed = await stepUp(current).expect(200);
    const until = Date.parse(confirmed.body.until as string);
    expect(until - Date.now()).toBeGreaterThan(9 * MINUTE);
    expect(until - Date.now()).toBeLessThanOrEqual(10 * MINUTE);
    // The same code cannot step up again (replay protection).
    await stepUp(current).expect(401);

    await setRoles(['customer']).expect(200);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'auth.step_up.succeeded', actorUserId: admin.userId },
    });
    expect(audit).toMatchObject({ targetType: 'session', targetId: admin.sessionId });
    expect(audit?.metadata).toEqual({ method: 'totp' });
  });

  it('publishes step-up on exactly the riskiest admin operations', () => {
    const document = committedOpenApi();
    const stepUp = Object.values(document.paths)
      .flatMap((item) => Object.values(item))
      .filter((operation) => operation?.['x-step-up'] === true)
      .map((operation) => operation?.operationId)
      .sort();
    expect(stepUp).toEqual(
      [
        'adminApprovePaymentReview',
        'adminApproveRefund',
        'adminCreateFeeRule',
        'adminCreateMarkupRule',
        'adminCreatePrimePlan',
        'adminDisableUser',
        'adminRejectPaymentReview',
        'adminResetUserMfa',
        'adminResolveRefund',
        'adminSetUserRoles',
        'adminUpdateFeeRule',
        'adminUpdateMarkupRule',
        'adminUpdatePrimePlan',
        'adminVerifyTrustSignal',
      ].sort(),
    );
  });

  it('lets staff sign an account out everywhere without disabling it', async () => {
    const admin = await staffSession(ctx, 'revoke-admin@example.com', ['super_admin']);
    const user = await signUp(ctx, 'revoke-user@example.com');
    const revoke = (id: string) =>
      ctx.http().post(`/v1/admin/users/${id}/sessions/revoke`).set(bearer(admin.accessToken));

    const response = await revoke(user.userId).expect(200);
    expect(response.body).toEqual({ revoked: 1 });
    const me = await ctx.http().get('/v1/me').set(bearer(user.accessToken)).expect(401);
    expect(me.body.type).toBe(problem('session-revoked'));
    await login(ctx, 'revoke-user@example.com');

    expect((await revoke(admin.userId).expect(409)).body.type).toBe(
      problem('cannot-change-own-account'),
    );
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'user.sessions_revoked', targetId: user.userId },
    });
    expect(audit).toMatchObject({ actorUserId: admin.userId, targetType: 'user' });
    expect(audit?.metadata).toEqual({ revoked: 1 });
  });

  it('ends staff sessions in an incident and leaves customers signed in', async () => {
    await resetState(ctx);
    const staff = await staffSession(ctx, 'incident-staff@example.com', ['finance']);
    const customer = await signUp(ctx, 'incident-customer@example.com');
    const deps = {
      prisma: ctx.prisma,
      redis: ctx.redis,
      audit: ctx.app.get(AuditService),
      accessTokenTtlSeconds: ctx.config.ACCESS_TOKEN_TTL_SECONDS,
    };

    // The staff member has two sessions: one from before the role was granted, one with MFA.
    const dryRun = parseIncidentArgs(['--staff', '--reason', 'incident-e2e']);
    expect(await revokeForIncident(deps, dryRun)).toEqual({ matched: 2, revoked: 0 });
    await ctx.http().get('/v1/me').set(bearer(staff.accessToken)).expect(200);

    const confirmed = parseIncidentArgs(['--staff', '--reason', 'incident-e2e', '--yes']);
    expect(await revokeForIncident(deps, confirmed)).toEqual({ matched: 2, revoked: 2 });
    await ctx.http().get('/v1/me').set(bearer(staff.accessToken)).expect(401);
    await ctx
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: staff.refreshToken })
      .expect(401);
    await ctx.http().get('/v1/me').set(bearer(customer.accessToken)).expect(200);

    const sessions = await ctx.prisma.session.findMany({ where: { userId: staff.userId } });
    expect(sessions.every((session) => session.revokedReason === 'incident-e2e')).toBe(true);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'auth.sessions.revoked_incident' },
    });
    expect(audit).toMatchObject({ actorType: 'system', actorUserId: null });
    expect(audit?.metadata).toEqual({ scope: 'staff', reason: 'incident-e2e', revoked: 2 });
  });
});
