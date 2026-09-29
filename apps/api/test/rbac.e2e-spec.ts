import {
  bearer,
  enrolTotp,
  grantRoles,
  login,
  PASSWORD,
  signUp,
  totp,
  type TokenSession,
} from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

describe('RBAC, admin MFA and audit (e2e)', () => {
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

  /** A staff member who completed MFA at sign-in. */
  async function staffWithMfa(
    email: string,
    roles: Parameters<typeof grantRoles>[2],
  ): Promise<TokenSession> {
    const initial = await signUp(ctx, email);
    await grantRoles(ctx, initial.userId, roles);
    const { secret } = await enrolTotp(ctx, initial.accessToken);
    const pending = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const verified = await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, code: totp(secret, 1) })
      .expect(200);
    return {
      userId: initial.userId,
      sessionId: verified.body.sessionId,
      accessToken: verified.body.accessToken,
      refreshToken: verified.body.refreshToken,
    };
  }

  it('denies customers on admin routes and audits the attempt', async () => {
    const customer = await signUp(ctx, 'customer@example.com');
    const denied = await ctx
      .http()
      .get(`/v1/admin/users/${customer.userId}`)
      .set(bearer(customer.accessToken))
      .expect(403);
    expect(denied.body.type).toBe('urn:suskii:problem:forbidden');
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'rbac.access_denied', actorUserId: customer.userId },
    });
    expect(audit?.metadata).toMatchObject({ reason: 'not_staff', required: ['users:read'] });
  });

  it('requires an MFA-verified session for staff, even with the right permission', async () => {
    const staff = await signUp(ctx, 'support@example.com');
    await grantRoles(ctx, staff.userId, ['support']);
    const refreshed = await ctx
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: staff.refreshToken })
      .expect(200);
    const response = await ctx
      .http()
      .get(`/v1/admin/users/${staff.userId}`)
      .set(bearer(refreshed.body.accessToken))
      .expect(403);
    expect(response.body.type).toBe('urn:suskii:problem:mfa-required');
  });

  it('enforces permissions per role', async () => {
    const support = await staffWithMfa('support2@example.com', ['support']);
    const target = await signUp(ctx, 'target@example.com');
    const user = await ctx
      .http()
      .get(`/v1/admin/users/${target.userId}`)
      .set(bearer(support.accessToken))
      .expect(200);
    expect(user.body).toMatchObject({
      email: 'target@example.com',
      roles: ['customer'],
      status: 'active',
    });
    // support has users:read but not roles:manage or audit:read.
    await ctx
      .http()
      .put(`/v1/admin/users/${target.userId}/roles`)
      .set(bearer(support.accessToken))
      .send({ roles: ['support'] })
      .expect(403);
    await ctx.http().get('/v1/admin/audit-logs').set(bearer(support.accessToken)).expect(403);
    await ctx
      .http()
      .get('/v1/admin/users/0192f0e0-0000-7000-8000-000000000000')
      .set(bearer(support.accessToken))
      .expect(404);
  });

  it('lets a super admin change roles: audited, applied immediately by signing the user out', async () => {
    const admin = await staffWithMfa('admin@example.com', ['super_admin']);
    const target = await signUp(ctx, 'promoted@example.com');
    const updated = await ctx
      .http()
      .put(`/v1/admin/users/${target.userId}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: ['customer', 'operations'] })
      .expect(200);
    expect(updated.body.roles).toEqual(['customer', 'operations']);
    await ctx.http().get('/v1/me').set(bearer(target.accessToken)).expect(401);
    const fresh = await login(ctx, 'promoted@example.com');
    const me = await ctx.http().get('/v1/me').set(bearer(fresh.accessToken)).expect(200);
    expect(me.body.roles).toEqual(['customer', 'operations']);

    const audit = await ctx
      .http()
      .get('/v1/admin/audit-logs?action=rbac.roles.changed')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      action: 'rbac.roles.changed',
      actorUserId: admin.userId,
      targetType: 'user',
      targetId: target.userId,
      metadata: { before: ['customer'], after: ['customer', 'operations'] },
    });
    expect(audit.body.items[0]).not.toHaveProperty('ipHash');
  });

  it('forbids changing your own roles', async () => {
    const admin = await staffWithMfa('self@example.com', ['super_admin']);
    const response = await ctx
      .http()
      .put(`/v1/admin/users/${admin.userId}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: ['customer'] })
      .expect(409);
    expect(response.body.type).toBe('urn:suskii:problem:cannot-change-own-roles');
  });

  it('pages through the audit log with a keyset cursor', async () => {
    const admin = await staffWithMfa('pager@example.com', ['super_admin']);
    const first = await ctx
      .http()
      .get('/v1/admin/audit-logs?limit=2')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBe(first.body.items[1].id);
    const second = await ctx
      .http()
      .get(`/v1/admin/audit-logs?limit=2&cursor=${first.body.nextCursor as string}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(second.body.items[0].id < first.body.items[1].id).toBe(true);
    await ctx
      .http()
      .get('/v1/admin/audit-logs?limit=500')
      .set(bearer(admin.accessToken))
      .expect(400);
  });

  it('keeps the audit log append-only at the database level', async () => {
    await signUp(ctx, 'immutable@example.com');
    await expect(
      ctx.prisma.auditLog.updateMany({ data: { action: 'tampered' } }),
    ).rejects.toThrow();
    await expect(ctx.prisma.auditLog.deleteMany({})).rejects.toThrow();
    await expect(ctx.prisma.$executeRawUnsafe('TRUNCATE audit_log')).rejects.toThrow(/append-only/);
  });

  it('applies the admin IP allowlist when configured', async () => {
    const restricted = await createTestApp({
      ADMIN_IP_ALLOWLIST: ['203.0.113.10'],
      TRUST_PROXY_HOPS: 1,
    });
    try {
      const original = ctx;
      ctx = restricted;
      const admin = await staffWithMfa('ip@example.com', ['super_admin']);
      const blocked = await restricted
        .http()
        .get('/v1/admin/audit-logs')
        .set(bearer(admin.accessToken))
        .set('X-Forwarded-For', '198.51.100.7')
        .expect(403);
      expect(blocked.body.type).toBe('urn:suskii:problem:forbidden');
      await restricted
        .http()
        .get('/v1/admin/audit-logs')
        .set(bearer(admin.accessToken))
        .set('X-Forwarded-For', '203.0.113.10')
        .expect(200);
      ctx = original;
    } finally {
      await restricted.close();
    }
  });
});
