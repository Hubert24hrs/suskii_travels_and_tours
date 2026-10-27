import { bearer, enrolTotp, login, PASSWORD, signUp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const MINUTE_MS = 60_000;

/**
 * The test stacks' mock Google and Apple sign-in, and fingerprint sign-in on a phone with a
 * device credential (ADR-067).
 */
describe('mock social sign-in and fingerprint sign-in (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ SOCIAL_MOCK_ENABLED: true, RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function mockSignIn(provider: 'google' | 'apple', email: string, name?: string) {
    const { body: issued } = await ctx.http().post('/v1/auth/social/nonce').expect(200);
    const { body: minted } = await ctx
      .http()
      .post('/v1/auth/social/mock-token')
      .send({ provider, email, ...(name ? { name } : {}), nonce: issued.nonce as string })
      .expect(200);
    const response = await ctx
      .http()
      .post(`/v1/auth/${provider}`)
      .send({ idToken: minted.idToken as string, nonce: issued.nonce as string });
    return { response, idToken: minted.idToken as string, nonce: issued.nonce as string };
  }

  describe('mock Google and Apple', () => {
    it('tells clients the mock is on', async () => {
      const response = await ctx.http().get('/v1/auth/social/providers').expect(200);
      expect(response.body).toEqual({ google: true, apple: true, mock: true });
    });

    it('signs up with Google, then signs in again as the same user', async () => {
      const first = await mockSignIn('google', 'Ada@Example.com', 'Ada Okafor');
      expect(first.response.status).toBe(200);
      expect(first.response.body).toMatchObject({
        status: 'authenticated',
        user: { email: 'ada@example.com', emailVerified: true, displayName: 'Ada Okafor' },
      });
      const again = await mockSignIn('google', 'ada@example.com');
      expect(again.response.body.user.id).toBe(first.response.body.user.id);
      // The same token cannot be replayed: its nonce was used.
      await ctx
        .http()
        .post('/v1/auth/google')
        .send({ idToken: first.idToken, nonce: first.nonce })
        .expect(401);
      // A Google token is not an Apple token.
      const { body: issued } = await ctx.http().post('/v1/auth/social/nonce').expect(200);
      const { body: minted } = await ctx
        .http()
        .post('/v1/auth/social/mock-token')
        .send({ provider: 'google', email: 'ada@example.com', nonce: issued.nonce as string })
        .expect(200);
      await ctx
        .http()
        .post('/v1/auth/apple')
        .send({ idToken: minted.idToken as string, nonce: issued.nonce as string })
        .expect(401);
    });

    it('links Apple to the account with the same verified email', async () => {
      const google = await mockSignIn('google', 'bola@example.com');
      const apple = await mockSignIn('apple', 'bola@example.com');
      expect(apple.response.body.user.id).toBe(google.response.body.user.id);
      const identities = await ctx.prisma.socialIdentity.findMany({
        where: { userId: google.response.body.user.id as string },
      });
      expect(identities.map((identity) => identity.provider).sort()).toEqual(['apple', 'google']);
    });

    it('is off unless enabled', async () => {
      const off = await createTestApp({ SOCIAL_MOCK_ENABLED: false });
      try {
        const providers = await off.http().get('/v1/auth/social/providers').expect(200);
        // The test app configures real client ids, so the buttons stay, without the mock.
        expect(providers.body).toEqual({ google: true, apple: true, mock: false });
        const { body: issued } = await off.http().post('/v1/auth/social/nonce').expect(200);
        await off
          .http()
          .post('/v1/auth/social/mock-token')
          .send({ provider: 'google', email: 'eve@example.com', nonce: issued.nonce as string })
          .expect(404);
        // A token the mock signed elsewhere is not accepted here either.
        const minted = await mockSignIn('google', 'eve@example.com');
        const { body: fresh } = await off.http().post('/v1/auth/social/nonce').expect(200);
        await off
          .http()
          .post('/v1/auth/google')
          .send({ idToken: minted.idToken, nonce: fresh.nonce as string })
          .expect(401);
      } finally {
        await off.close();
      }
    });
  });

  describe('fingerprint sign-in', () => {
    async function enable(accessToken: string) {
      const response = await ctx
        .http()
        .post('/v1/me/device-credentials')
        .set(bearer(accessToken))
        .send({ label: 'Android' })
        .expect(201);
      return response.body as { credentialId: string; secret: string };
    }

    const deviceSignIn = (credential: { credentialId: string; secret: string }) =>
      ctx.http().post('/v1/auth/device').send(credential);

    it('signs in with the phone credential until it is turned off', async () => {
      const session = await signUp(ctx, 'chi@example.com');
      const credential = await enable(session.accessToken);
      const stored = await ctx.prisma.deviceCredential.findUniqueOrThrow({
        where: { id: credential.credentialId },
      });
      // Only an HMAC is kept.
      expect(stored.secretHash).not.toContain(credential.secret);

      const signedIn = await deviceSignIn(credential).expect(200);
      expect(signedIn.body).toMatchObject({
        status: 'authenticated',
        user: { id: session.userId },
      });
      expect(signedIn.body.refreshToken).toEqual(expect.any(String));
      const sessions = await ctx.http().get('/v1/me/sessions').set(bearer(session.accessToken));
      expect(sessions.body.sessions.map((s: { authMethod: string }) => s.authMethod)).toContain(
        'device',
      );

      await deviceSignIn({ ...credential, secret: `${credential.secret}x` }).expect(401);
      await deviceSignIn({ credentialId: crypto.randomUUID(), secret: credential.secret }).expect(
        401,
      );

      const listed = await ctx
        .http()
        .get('/v1/me/device-credentials')
        .set(bearer(session.accessToken))
        .expect(200);
      expect(listed.body.credentials).toEqual([
        expect.objectContaining({ id: credential.credentialId, label: 'Android' }),
      ]);
      // Another account cannot see or turn it off.
      const other = await signUp(ctx, 'dayo@example.com');
      await ctx
        .http()
        .delete(`/v1/me/device-credentials/${credential.credentialId}`)
        .set(bearer(other.accessToken))
        .expect(404);
      await ctx
        .http()
        .delete(`/v1/me/device-credentials/${credential.credentialId}`)
        .set(bearer(session.accessToken))
        .expect(204);
      await deviceSignIn(credential).expect(401);
      const audit = await ctx.prisma.auditLog.findMany({
        where: { targetId: credential.credentialId },
        select: { action: true },
      });
      expect(audit.map((entry) => entry.action).sort()).toEqual([
        'auth.device_credential.created',
        'auth.device_credential.revoked',
      ]);
    });

    it('turns on only right after signing in', async () => {
      const session = await signUp(ctx, 'emeka@example.com');
      await ctx.prisma.session.update({
        where: { id: session.sessionId },
        data: { createdAt: new Date(Date.now() - 11 * MINUTE_MS) },
      });
      const refused = await ctx
        .http()
        .post('/v1/me/device-credentials')
        .set(bearer(session.accessToken))
        .send({ label: 'Android' })
        .expect(401);
      expect(refused.body.type).toBe('urn:suskii:problem:reauthentication-required');
    });

    it('ends when the account signs out everywhere, and still asks for MFA', async () => {
      const session = await signUp(ctx, 'funke@example.com');
      const credential = await enable(session.accessToken);
      await ctx
        .http()
        .post('/v1/me/password')
        .set(bearer(session.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'a whole new passphrase here' })
        .expect(204);
      await deviceSignIn(credential).expect(401);

      const fresh = await login(ctx, 'funke@example.com', 'a whole new passphrase here');
      await enrolTotp(ctx, fresh.accessToken);
      const again = await login(ctx, 'funke@example.com', 'a whole new passphrase here').catch(
        () => null,
      );
      // With MFA on, password sign-in asks for a code; fingerprint sign-in does the same.
      expect(again).toBeNull();
      const second = await enable(fresh.accessToken);
      const challenged = await deviceSignIn(second).expect(200);
      expect(challenged.body.status).toBe('mfa_required');
    });

    it('keeps at most five phones', async () => {
      const session = await signUp(ctx, 'gbenga@example.com');
      const first = await enable(session.accessToken);
      for (let index = 0; index < 5; index += 1) await enable(session.accessToken);
      await deviceSignIn(first).expect(401);
      const active = await ctx.prisma.deviceCredential.count({
        where: { userId: session.userId, revokedAt: null },
      });
      expect(active).toBe(5);
    });
  });
});
