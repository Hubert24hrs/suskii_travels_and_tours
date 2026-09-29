import { bearer, emailToken, lastSmsCode, register, signUp } from './helpers/flows';
import { createTestApp, GOOGLE_CLIENT_ID, resetState, type TestContext } from './helpers/test-app';

const PHONE = '+2348012345678';

describe('auth: phone OTP and social sign-in (e2e)', () => {
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

  describe('phone OTP', () => {
    it('signs up with a texted code, then signs the same account in again', async () => {
      const sent = await ctx.http().post('/v1/auth/otp/request').send({ phone: PHONE }).expect(202);
      expect(sent.body).toEqual({
        status: 'accepted',
        expiresInSeconds: 300,
        resendAfterSeconds: 60,
      });
      const first = await ctx
        .http()
        .post('/v1/auth/otp/verify')
        .send({ phone: PHONE, code: lastSmsCode(ctx, PHONE) })
        .expect(200);
      expect(first.body.user).toMatchObject({
        phone: PHONE,
        phoneVerified: true,
        email: null,
        hasPassword: false,
      });

      // Codes are single-use.
      await ctx
        .http()
        .post('/v1/auth/otp/verify')
        .send({ phone: PHONE, code: lastSmsCode(ctx, PHONE) })
        .expect(401);

      await ctx.redis.flushdb(); // skip the 60-second resend cooldown
      await ctx.http().post('/v1/auth/otp/request').send({ phone: PHONE }).expect(202);
      const second = await ctx
        .http()
        .post('/v1/auth/otp/verify')
        .send({ phone: PHONE, code: lastSmsCode(ctx, PHONE) })
        .expect(200);
      expect(second.body.user.id).toBe(first.body.user.id);
    });

    it('enforces the resend cooldown silently and never stores the code in plain text', async () => {
      await ctx.http().post('/v1/auth/otp/request').send({ phone: PHONE }).expect(202);
      await ctx.http().post('/v1/auth/otp/request').send({ phone: PHONE }).expect(202);
      expect(ctx.sms.outbox).toHaveLength(1);
      const code = lastSmsCode(ctx, PHONE);
      const keys = await ctx.redis.keys('*');
      const values = await Promise.all(
        keys.map((key) =>
          ctx.redis.type(key).then((type) => (type === 'string' ? ctx.redis.get(key) : '')),
        ),
      );
      expect(values.join('|')).not.toContain(code);
      expect(keys.join('|')).not.toContain(PHONE);
    });

    it('burns a code after 5 wrong guesses and then locks the number', async () => {
      await ctx.http().post('/v1/auth/otp/request').send({ phone: PHONE }).expect(202);
      const code = lastSmsCode(ctx, PHONE);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await ctx
          .http()
          .post('/v1/auth/otp/verify')
          .send({ phone: PHONE, code: wrong })
          .expect(401);
        expect(response.body.type).toBe('urn:suskii:problem:invalid-code');
      }
      await ctx.http().post('/v1/auth/otp/verify').send({ phone: PHONE, code }).expect(429);
    });

    it('rejects non-E.164 numbers', async () => {
      await ctx.http().post('/v1/auth/otp/request').send({ phone: '08012345678' }).expect(400);
    });

    it('adds a verified phone to an existing account, refusing numbers owned by others', async () => {
      const owner = await ctx
        .http()
        .post('/v1/auth/otp/request')
        .send({ phone: PHONE })
        .expect(202);
      expect(owner.status).toBe(202);
      await ctx
        .http()
        .post('/v1/auth/otp/verify')
        .send({ phone: PHONE, code: lastSmsCode(ctx, PHONE) })
        .expect(200);

      const session = await signUp(ctx, 'phone@example.com');
      await ctx
        .http()
        .post('/v1/me/phone')
        .set(bearer(session.accessToken))
        .send({ phone: PHONE })
        .expect(202);
      const taken = await ctx
        .http()
        .post('/v1/me/phone/verify')
        .set(bearer(session.accessToken))
        .send({ phone: PHONE, code: lastSmsCode(ctx, PHONE) })
        .expect(409);
      expect(taken.body.type).toBe('urn:suskii:problem:phone-unavailable');

      const other = '+2348098765432';
      await ctx
        .http()
        .post('/v1/me/phone')
        .set(bearer(session.accessToken))
        .send({ phone: other })
        .expect(202);
      const verified = await ctx
        .http()
        .post('/v1/me/phone/verify')
        .set(bearer(session.accessToken))
        .send({ phone: other, code: lastSmsCode(ctx, other) })
        .expect(200);
      expect(verified.body).toMatchObject({ phone: other, phoneVerified: true });
    });
  });

  describe('Google and Apple', () => {
    it('creates an account from a verified Google identity and signs it in again', async () => {
      const idToken = await ctx.social.sign('google', {
        sub: 'google-123',
        email: 'Gina@Gmail.com',
        email_verified: true,
        name: 'Gina',
      });
      const first = await ctx.http().post('/v1/auth/google').send({ idToken }).expect(200);
      expect(first.body.user).toMatchObject({
        email: 'gina@gmail.com',
        emailVerified: true,
        displayName: 'Gina',
        hasPassword: false,
      });
      const again = await ctx.http().post('/v1/auth/google').send({ idToken }).expect(200);
      expect(again.body.user.id).toBe(first.body.user.id);
    });

    it('rejects tokens for another audience, bad nonces and tampered signatures', async () => {
      const wrongAudience = await ctx.social.sign(
        'google',
        { sub: 'x', email: 'x@gmail.com', email_verified: true },
        'someone-else',
      );
      await ctx.http().post('/v1/auth/google').send({ idToken: wrongAudience }).expect(401);

      const withNonce = await ctx.social.sign('google', { sub: 'y', nonce: 'expected-nonce' });
      await ctx
        .http()
        .post('/v1/auth/google')
        .send({ idToken: withNonce, nonce: 'other-nonce' })
        .expect(401);
      await ctx
        .http()
        .post('/v1/auth/google')
        .send({ idToken: withNonce, nonce: 'expected-nonce' })
        .expect(200);

      // A Google token presented to the Apple endpoint fails signature and issuer checks.
      await ctx.http().post('/v1/auth/apple').send({ idToken: withNonce }).expect(401);
      const tampered = `${withNonce.slice(0, -4)}AAAA`;
      await ctx.http().post('/v1/auth/google').send({ idToken: tampered }).expect(401);
    });

    it('accepts Apple tokens with a hashed nonce and string email_verified', async () => {
      const { createHash } = await import('node:crypto');
      const nonce = 'raw-apple-nonce';
      const idToken = await ctx.social.sign('apple', {
        sub: 'apple-001',
        email: 'relay@privaterelay.appleid.com',
        email_verified: 'true',
        nonce: createHash('sha256').update(nonce).digest('hex'),
      });
      const response = await ctx
        .http()
        .post('/v1/auth/apple')
        .send({ idToken, nonce, displayName: 'Ade' })
        .expect(200);
      expect(response.body.user).toMatchObject({
        email: 'relay@privaterelay.appleid.com',
        displayName: 'Ade',
      });
    });

    it('links to an existing verified account without touching its password', async () => {
      await register(ctx, 'link@example.com');
      await ctx
        .http()
        .post('/v1/auth/email/verify')
        .send({ token: await emailToken(ctx, 'link@example.com', 'verify-email') })
        .expect(204);
      const idToken = await ctx.social.sign('google', {
        sub: 'google-link',
        email: 'link@example.com',
        email_verified: true,
      });
      const response = await ctx.http().post('/v1/auth/google').send({ idToken }).expect(200);
      expect(response.body.user.hasPassword).toBe(true);
    });

    it('defeats account pre-hijacking: an unverified squatter loses the password and sessions', async () => {
      // The attacker registers the victim's email first but cannot verify it.
      const squatter = await signUp(ctx, 'victim@example.com', 'attacker chosen pass');
      const idToken = await ctx.social.sign('google', {
        sub: 'victim-google',
        email: 'victim@example.com',
        email_verified: true,
      });
      const victim = await ctx.http().post('/v1/auth/google').send({ idToken }).expect(200);
      expect(victim.body.user).toMatchObject({
        id: squatter.userId,
        hasPassword: false,
        emailVerified: true,
      });
      await ctx.http().get('/v1/me').set(bearer(squatter.accessToken)).expect(401);
      await ctx
        .http()
        .post('/v1/auth/login')
        .send({ email: 'victim@example.com', password: 'attacker chosen pass' })
        .expect(401);
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'auth.social.linked', actorUserId: squatter.userId },
      });
      expect(audit?.metadata).toEqual({ provider: 'google', clearedUnverifiedPassword: true });
    });

    it('does not link on an unverified provider email', async () => {
      const existing = await signUp(ctx, 'unverified@example.com');
      const idToken = await ctx.social.sign('google', {
        sub: 'g-unverified',
        email: 'unverified@example.com',
        email_verified: false,
      });
      const response = await ctx.http().post('/v1/auth/google').send({ idToken }).expect(200);
      expect(response.body.user.id).not.toBe(existing.userId);
      expect(response.body.user.email).toBeNull();
    });

    it('answers 404 for a provider without configured client ids', async () => {
      const disabled = await createTestApp({ APPLE_CLIENT_IDS: [] });
      try {
        const idToken = await disabled.social.sign('apple', { sub: 'a' });
        const response = await disabled.http().post('/v1/auth/apple').send({ idToken }).expect(404);
        expect(response.body.type).toBe('urn:suskii:problem:social-provider-disabled');
      } finally {
        await disabled.close();
      }
      expect(GOOGLE_CLIENT_ID).toContain('googleusercontent');
    });
  });
});
