import { bearer, enrolTotp, login, PASSWORD, signUp, totp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

describe('auth: TOTP MFA and recovery codes (e2e)', () => {
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

  const startLogin = async (email: string) =>
    ctx.http().post('/v1/auth/login').send({ email, password: PASSWORD }).expect(200);

  it('enrols with a code, stores the secret encrypted and returns 10 recovery codes', async () => {
    const session = await signUp(ctx, 'mfa@example.com');
    const setup = await ctx
      .http()
      .post('/v1/me/mfa/totp')
      .set(bearer(session.accessToken))
      .expect(201);
    expect(setup.body.otpauthUri).toMatch(
      /^otpauth:\/\/totp\/Suskii%20Travels%3Amfa%40example\.com\?secret=/,
    );
    await ctx
      .http()
      .post('/v1/me/mfa/totp/confirm')
      .set(bearer(session.accessToken))
      .send({ code: '000000' })
      .expect(401);
    const confirm = await ctx
      .http()
      .post('/v1/me/mfa/totp/confirm')
      .set(bearer(session.accessToken))
      .send({ code: totp(setup.body.secret) })
      .expect(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    expect(new Set(confirm.body.recoveryCodes).size).toBe(10);

    const factor = await ctx.prisma.mfaFactor.findFirstOrThrow({
      where: { userId: session.userId },
    });
    expect(factor.secretCiphertext.startsWith('v2.k1.')).toBe(true);
    expect(factor.secretCiphertext).not.toContain(setup.body.secret);
    const stored = await ctx.prisma.mfaRecoveryCode.findMany({ where: { userId: session.userId } });
    expect(stored.map((c) => c.codeHash)).not.toContain(confirm.body.recoveryCodes[0]);
    // 50-bit codes are stored with a salted slow hash (ASVS V6.5.2).
    expect(stored.every((c) => c.codeHash.startsWith('$argon2id$'))).toBe(true);

    await ctx.http().post('/v1/me/mfa/totp').set(bearer(session.accessToken)).expect(409);
    const me = await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(200);
    expect(me.body.mfaEnabled).toBe(true);
  });

  it('challenges sign-in, accepts the next code once, rejects replays, and accepts a recovery code once', async () => {
    const first = await signUp(ctx, 'challenge@example.com');
    const { secret, recoveryCodes } = await enrolTotp(ctx, first.accessToken);
    const [recoveryCode = ''] = recoveryCodes;

    const pending = await startLogin('challenge@example.com');
    expect(pending.body).toMatchObject({
      status: 'mfa_required',
      methods: ['totp', 'recovery_code'],
    });
    expect(pending.body).not.toHaveProperty('accessToken');

    // The enrolment consumed the current step; the next step is within the drift window.
    const nextCode = totp(secret, 1);
    const verified = await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, code: nextCode })
      .expect(200);
    expect(verified.body.user.mfaEnabled).toBe(true);
    const payload = JSON.parse(
      Buffer.from(verified.body.accessToken.split('.')[1], 'base64url').toString(),
    );
    expect(payload).toMatchObject({ mfa: true, amr: ['pwd', 'mfa'] });

    // The challenge is single-use, and the same TOTP code cannot be replayed on a new challenge.
    await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, code: nextCode })
      .expect(401);
    const second = await startLogin('challenge@example.com');
    await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: second.body.mfaToken, code: nextCode })
      .expect(401);

    const recovered = await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: second.body.mfaToken, recoveryCode: recoveryCode.toUpperCase() })
      .expect(200);
    expect(recovered.body.status).toBe('authenticated');
    const third = await startLogin('challenge@example.com');
    await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: third.body.mfaToken, recoveryCode })
      .expect(401);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'auth.mfa.recovery_code_used', actorUserId: first.userId },
    });
    expect(audit?.metadata).toEqual({ remaining: 9 });
  });

  it('locks MFA verification after 5 wrong codes', async () => {
    const session = await signUp(ctx, 'lock@example.com');
    await enrolTotp(ctx, session.accessToken);
    const pending = await startLogin('lock@example.com');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ctx
        .http()
        .post('/v1/auth/mfa/verify')
        .send({ mfaToken: pending.body.mfaToken, code: '000000' })
        .expect(401);
    }
    const locked = await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, code: '000000' })
      .expect(429);
    expect(locked.headers['retry-after']).toBeDefined();
  });

  it('disables MFA with a valid code, but never for staff', async () => {
    const customer = await signUp(ctx, 'disable@example.com');
    const { recoveryCodes } = await enrolTotp(ctx, customer.accessToken);
    await ctx
      .http()
      .post('/v1/me/mfa/totp/disable')
      .set(bearer(customer.accessToken))
      .send({ code: '000000' })
      .expect(401);
    await ctx
      .http()
      .post('/v1/me/mfa/totp/disable')
      .set(bearer(customer.accessToken))
      .send({ recoveryCode: recoveryCodes[1] })
      .expect(204);
    const next = await login(ctx, 'disable@example.com');
    expect(next.accessToken).toBeTruthy();

    const staff = await signUp(ctx, 'staff@example.com');
    await ctx.prisma.userRole.create({ data: { userId: staff.userId, roleKey: 'support' } });
    const refreshed = await ctx
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: staff.refreshToken })
      .expect(200);
    const staffMfa = await enrolTotp(ctx, refreshed.body.accessToken);
    const denied = await ctx
      .http()
      .post('/v1/me/mfa/totp/disable')
      .set(bearer(refreshed.body.accessToken))
      .send({ recoveryCode: staffMfa.recoveryCodes[0] })
      .expect(403);
    expect(denied.body.type).toBe('urn:suskii:problem:mfa-mandatory');
  });

  it('regenerates recovery codes and invalidates the old set', async () => {
    const session = await signUp(ctx, 'regen@example.com');
    const { secret, recoveryCodes } = await enrolTotp(ctx, session.accessToken);
    const regenerated = await ctx
      .http()
      .post('/v1/me/mfa/recovery-codes')
      .set(bearer(session.accessToken))
      .send({ code: totp(secret, 1) })
      .expect(200);
    expect(regenerated.body.recoveryCodes).toHaveLength(10);
    const pending = await startLogin('regen@example.com');
    await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, recoveryCode: recoveryCodes[0] })
      .expect(401);
    await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, recoveryCode: regenerated.body.recoveryCodes[0] })
      .expect(200);
  });
});
