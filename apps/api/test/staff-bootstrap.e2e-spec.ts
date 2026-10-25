import { grantFirstSuperAdmin, parseBootstrapArgs } from '../src/admin/first-super-admin';
import { AuditService } from '../src/audit/audit.service';

import { bearer, emailToken, signUp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/** ADR-060: the first super admin of a new environment, where SEED_ADMIN_* is refused. */
describe('staff:bootstrap (e2e)', () => {
  let ctx: TestContext;
  const deps = () => ({
    prisma: ctx.prisma,
    redis: ctx.redis,
    audit: ctx.app.get(AuditService),
    accessTokenTtlSeconds: ctx.config.ACCESS_TOKEN_TTL_SECONDS,
  });
  const verify = async (email: string) => {
    const token = await emailToken(ctx, email, 'verify-email');
    await ctx.http().post('/v1/auth/email/verify').send({ token }).expect(204);
  };

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('parses the command line strictly', () => {
    expect(parseBootstrapArgs(['--email', ' Owner@Example.com '])).toEqual({
      email: 'owner@example.com',
      confirm: false,
    });
    expect(parseBootstrapArgs(['--email', 'owner@example.com', '--yes']).confirm).toBe(true);
    expect(() => parseBootstrapArgs([])).toThrow(/--email must be an email address/);
    expect(() => parseBootstrapArgs(['--email', 'owner@example.com', '--role', 'x'])).toThrow();
  });

  it('refuses unknown and unverified accounts without echoing the address', async () => {
    const unknown = parseBootstrapArgs(['--email', 'nobody@example.com', '--yes']);
    await expect(grantFirstSuperAdmin(deps(), unknown)).rejects.toThrow(
      /^No account uses that email/,
    );
    await signUp(ctx, 'unverified@example.com');
    const unverified = parseBootstrapArgs(['--email', 'unverified@example.com', '--yes']);
    await expect(grantFirstSuperAdmin(deps(), unverified)).rejects.toThrow(
      'The account has not verified its email yet.',
    );
    expect(await ctx.prisma.userRole.count({ where: { roleKey: 'super_admin' } })).toBe(0);
  });

  it('checks, grants once with an audit entry and signs the account out, then refuses', async () => {
    const owner = await signUp(ctx, 'owner@example.com');
    await verify('owner@example.com');

    const check = await grantFirstSuperAdmin(
      deps(),
      parseBootstrapArgs(['--email', 'owner@example.com']),
    );
    expect(check).toEqual({ userId: owner.userId, granted: false });
    expect(await ctx.prisma.userRole.count({ where: { roleKey: 'super_admin' } })).toBe(0);
    await ctx.http().get('/v1/me').set(bearer(owner.accessToken)).expect(200);

    const granted = await grantFirstSuperAdmin(
      deps(),
      parseBootstrapArgs(['--email', 'owner@example.com', '--yes']),
    );
    expect(granted).toEqual({ userId: owner.userId, granted: true });
    const roles = await ctx.prisma.userRole.findMany({ where: { userId: owner.userId } });
    expect(roles.map((role) => role.roleKey).sort()).toEqual(['customer', 'super_admin']);
    await ctx.http().get('/v1/me').set(bearer(owner.accessToken)).expect(401);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'rbac.roles.changed', targetId: owner.userId },
    });
    expect(audit).toMatchObject({ actorType: 'system', actorUserId: null, targetId: owner.userId });
    expect(audit?.metadata).toEqual({
      before: ['customer'],
      after: ['customer', 'super_admin'],
      reason: 'bootstrap',
    });

    await signUp(ctx, 'second@example.com');
    await verify('second@example.com');
    await expect(
      grantFirstSuperAdmin(deps(), parseBootstrapArgs(['--email', 'second@example.com', '--yes'])),
    ).rejects.toThrow(/A super admin already exists/);
  });

  it('lets only one of two concurrent runs win', async () => {
    for (const email of ['a@example.com', 'b@example.com']) {
      await signUp(ctx, email);
      await verify(email);
    }
    const results = await Promise.allSettled(
      ['a@example.com', 'b@example.com'].map((email) =>
        grantFirstSuperAdmin(deps(), parseBootstrapArgs(['--email', email, '--yes'])),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await ctx.prisma.userRole.count({ where: { roleKey: 'super_admin' } })).toBe(1);
  });
});
