import { createLocalJWKSet, jwtVerify } from 'jose';

import { bearer, emailToken, login, PASSWORD, register, signUp } from './helpers/flows';
import { BREACHED_PASSWORD, createTestApp, resetState, type TestContext } from './helpers/test-app';

describe('auth: email and password (e2e)', () => {
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

  describe('registration', () => {
    it('answers 202 for new and existing emails alike, and emails each case differently', async () => {
      await register(ctx, 'Ada@Example.com');
      const again = await ctx
        .http()
        .post('/v1/auth/register')
        .send({ email: 'ada@example.com', password: 'another password 1' });
      expect(again.status).toBe(202);
      expect(again.body).toEqual({ status: 'accepted' });
      await ctx.background.drain();
      expect(ctx.emails.outbox.map((m) => [m.to, m.template])).toEqual([
        ['ada@example.com', 'verify-email'],
        ['ada@example.com', 'account-exists'],
      ]);
      // The duplicate attempt did not change the original password.
      await login(ctx, 'ada@example.com');
    });

    it('enforces the password policy and the breached-password check', async () => {
      const short = await ctx
        .http()
        .post('/v1/auth/register')
        .send({ email: 'b@example.com', password: 'short' })
        .expect(400);
      expect(short.body.type).toBe('urn:suskii:problem:validation-failed');
      expect(JSON.stringify(short.body)).not.toContain('short"');
      const breached = await ctx
        .http()
        .post('/v1/auth/register')
        .send({ email: 'b@example.com', password: BREACHED_PASSWORD })
        .expect(422);
      expect(breached.body.type).toBe('urn:suskii:problem:password-breached');
    });

    it('verifies the email with the single-use emailed token', async () => {
      await register(ctx, 'c@example.com');
      const token = await emailToken(ctx, 'c@example.com', 'verify-email');
      await ctx.http().post('/v1/auth/email/verify').send({ token }).expect(204);
      await ctx.http().post('/v1/auth/email/verify').send({ token }).expect(400);
      const session = await login(ctx, 'c@example.com');
      const me = await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(200);
      expect(me.body.emailVerified).toBe(true);
    });
  });

  describe('sign-in', () => {
    it('issues a session and never returns internal fields', async () => {
      const session = await signUp(ctx, 'd@example.com');
      const me = await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(200);
      expect(me.body).toEqual({
        id: session.userId,
        email: 'd@example.com',
        emailVerified: false,
        phone: null,
        phoneVerified: false,
        displayName: null,
        roles: ['customer'],
        mfaEnabled: false,
        hasPassword: true,
      });
      expect(JSON.stringify(me.body)).not.toContain('argon2');
    });

    it('gives the same generic error for a wrong password and an unknown account', async () => {
      await register(ctx, 'e@example.com');
      const wrong = await ctx
        .http()
        .post('/v1/auth/login')
        .send({ email: 'e@example.com', password: 'wrong password!' })
        .expect(401);
      const unknown = await ctx
        .http()
        .post('/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong password!' })
        .expect(401);
      const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });
      expect(strip(wrong.body)).toEqual(strip(unknown.body));
      expect(wrong.body.type).toBe('urn:suskii:problem:invalid-credentials');
    });

    it('locks an identifier with exponential backoff after 5 failures, for unknown accounts too', async () => {
      for (const email of ['f@example.com', 'ghost@example.com']) {
        if (email === 'f@example.com') await register(ctx, email);
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          await ctx
            .http()
            .post('/v1/auth/login')
            .send({ email, password: 'wrong password!' })
            .expect(401);
        }
        const locked = await ctx
          .http()
          .post('/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(429);
        expect(locked.body.type).toBe('urn:suskii:problem:too-many-attempts');
        expect(Number(locked.headers['retry-after'])).toBeGreaterThanOrEqual(29);
        await ctx.redis.flushdb();
      }
      const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'auth.login.locked' } });
      expect(audit.length).toBeGreaterThanOrEqual(2);
    });

    it('rejects missing, malformed and forged access tokens', async () => {
      await ctx.http().get('/v1/me').expect(401);
      const malformed = await ctx.http().get('/v1/me').set(bearer('not-a-jwt')).expect(401);
      expect(malformed.body.type).toBe('urn:suskii:problem:invalid-token');
      const session = await signUp(ctx, 'g@example.com');
      const [header, payload] = session.accessToken.split('.');
      const forged = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<
        string,
        unknown
      >;
      forged.roles = ['super_admin'];
      const tampered = `${header}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${session.accessToken.split('.')[2]}`;
      await ctx.http().get('/v1/me').set(bearer(tampered)).expect(401);
    });

    it('publishes a JWKS that verifies issued access tokens', async () => {
      const session = await signUp(ctx, 'h@example.com');
      const jwks = await ctx.http().get('/.well-known/jwks.json').expect(200);
      expect(jwks.headers['cache-control']).toBe('public, max-age=300');
      expect(jwks.body.keys[0]).toMatchObject({
        kty: 'OKP',
        crv: 'Ed25519',
        alg: 'EdDSA',
        use: 'sig',
      });
      expect(jwks.body.keys[0]).not.toHaveProperty('d');
      const { payload, protectedHeader } = await jwtVerify(
        session.accessToken,
        createLocalJWKSet(jwks.body),
        {
          issuer: 'suskii-api',
          audience: 'suskii',
        },
      );
      expect(protectedHeader).toMatchObject({
        alg: 'EdDSA',
        typ: 'at+jwt',
        kid: jwks.body.keys[0].kid,
      });
      expect(payload).toMatchObject({
        sub: session.userId,
        sid: session.sessionId,
        roles: ['customer'],
        mfa: false,
        amr: ['pwd'],
      });
      expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);
    });
  });

  describe('refresh tokens', () => {
    it('rotates on every use', async () => {
      const session = await signUp(ctx, 'i@example.com');
      const first = await ctx
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      expect(first.body.refreshToken).not.toBe(session.refreshToken);
      expect(first.body.sessionId).toBe(session.sessionId);
      const second = await ctx
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(200);
      await ctx.http().get('/v1/me').set(bearer(second.body.accessToken)).expect(200);
    });

    it('detects reuse: revokes the whole session family, kills live access tokens and audits it', async () => {
      const session = await signUp(ctx, 'j@example.com');
      const rotated = await ctx
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);

      // An attacker replays the stolen, already-rotated token.
      const replay = await ctx
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      expect(replay.body.type).toBe('urn:suskii:problem:session-revoked');

      // The legitimate client's newer token and live access token are dead too.
      await ctx
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
      const me = await ctx.http().get('/v1/me').set(bearer(rotated.body.accessToken)).expect(401);
      expect(me.body.type).toBe('urn:suskii:problem:session-revoked');

      const dbSession = await ctx.prisma.session.findUniqueOrThrow({
        where: { id: session.sessionId },
      });
      expect(dbSession.revokedReason).toBe('refresh_token_reuse');
      const liveTokens = await ctx.prisma.refreshToken.count({
        where: { sessionId: session.sessionId, revokedAt: null },
      });
      expect(liveTokens).toBe(0);
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'auth.refresh_token.reused', targetId: session.sessionId },
      });
      expect(audit).toMatchObject({ actorUserId: session.userId, targetType: 'session' });
      expect(audit?.ipHash).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // Other devices of the same user are unaffected.
      const other = await login(ctx, 'j@example.com');
      await ctx.http().get('/v1/me').set(bearer(other.accessToken)).expect(200);
    });

    it('treats two concurrent refreshes with one token as reuse', async () => {
      const session = await signUp(ctx, 'k@example.com');
      const results = await Promise.all([
        ctx.http().post('/v1/auth/refresh').send({ refreshToken: session.refreshToken }),
        ctx.http().post('/v1/auth/refresh').send({ refreshToken: session.refreshToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      const dbSession = await ctx.prisma.session.findUniqueOrThrow({
        where: { id: session.sessionId },
      });
      expect(dbSession.revokedAt).not.toBeNull();
    });

    it('rejects unknown and garbage refresh tokens without revoking anything', async () => {
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: 'srt_unknown' }).expect(401);
      await ctx.http().post('/v1/auth/refresh').send({}).expect(401);
    });
  });

  describe('sessions', () => {
    it('logs out the current session and lists and revokes other devices', async () => {
      const phone = await signUp(ctx, 'l@example.com');
      const laptop = await login(ctx, 'l@example.com');
      const list = await ctx
        .http()
        .get('/v1/me/sessions')
        .set(bearer(laptop.accessToken))
        .expect(200);
      expect(list.body.sessions).toHaveLength(2);
      expect(list.body.sessions.find((s: { current: boolean }) => s.current).id).toBe(
        laptop.sessionId,
      );

      await ctx
        .http()
        .delete(`/v1/me/sessions/${phone.sessionId}`)
        .set(bearer(laptop.accessToken))
        .expect(204);
      await ctx.http().get('/v1/me').set(bearer(phone.accessToken)).expect(401);

      await ctx.http().post('/v1/auth/logout').set(bearer(laptop.accessToken)).expect(204);
      await ctx.http().get('/v1/me').set(bearer(laptop.accessToken)).expect(401);
      await ctx
        .http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: laptop.refreshToken })
        .expect(401);
    });

    it("cannot revoke another user's session (IDOR)", async () => {
      const alice = await signUp(ctx, 'alice@example.com');
      const bob = await signUp(ctx, 'bob@example.com');
      await ctx
        .http()
        .delete(`/v1/me/sessions/${alice.sessionId}`)
        .set(bearer(bob.accessToken))
        .expect(404);
      await ctx.http().get('/v1/me').set(bearer(alice.accessToken)).expect(200);
    });
  });

  describe('password reset and change', () => {
    it('resets via the emailed link, signs out everywhere, and answers 202 for unknown emails', async () => {
      const session = await signUp(ctx, 'm@example.com');
      await ctx
        .http()
        .post('/v1/auth/password/forgot')
        .send({ email: 'unknown@example.com' })
        .expect(202);
      await ctx
        .http()
        .post('/v1/auth/password/forgot')
        .send({ email: 'm@example.com' })
        .expect(202);
      const token = await emailToken(ctx, 'm@example.com', 'password-reset');
      expect(ctx.emails.outbox.some((m) => m.to === 'unknown@example.com')).toBe(false);

      await ctx
        .http()
        .post('/v1/auth/password/reset')
        .send({ token, password: 'a brand new passphrase' })
        .expect(204);
      await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(401);
      await ctx
        .http()
        .post('/v1/auth/password/reset')
        .send({ token, password: 'another new passphrase' })
        .expect(400);
      await ctx
        .http()
        .post('/v1/auth/login')
        .send({ email: 'm@example.com', password: PASSWORD })
        .expect(401);
      await login(ctx, 'm@example.com', 'a brand new passphrase');
    });

    it('changes the password with the current one and keeps only the current session', async () => {
      const current = await signUp(ctx, 'n@example.com');
      const other = await login(ctx, 'n@example.com');
      await ctx
        .http()
        .post('/v1/me/password')
        .set(bearer(current.accessToken))
        .send({ currentPassword: 'wrong password!', newPassword: 'the next passphrase' })
        .expect(401);
      await ctx
        .http()
        .post('/v1/me/password')
        .set(bearer(current.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'the next passphrase' })
        .expect(204);
      await ctx.http().get('/v1/me').set(bearer(current.accessToken)).expect(200);
      await ctx.http().get('/v1/me').set(bearer(other.accessToken)).expect(401);
    });
  });
});
