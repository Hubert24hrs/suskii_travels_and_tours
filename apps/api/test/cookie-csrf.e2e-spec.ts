import { cookieHeader, parseSetCookies, register } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const AT = '__Secure-suskii_at';
const RT = '__Secure-suskii_rt';
const CSRF = '__Secure-suskii_csrf';

describe('auth: web cookie transport and CSRF (e2e)', () => {
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

  async function cookieLogin(email: string) {
    await register(ctx, email);
    const response = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email, password: 'correct horse battery staple', transport: 'cookie' })
      .expect(200);
    return { body: response.body, cookies: parseSetCookies(response.headers['set-cookie']) };
  }

  it('sets __Secure- httpOnly cookies and keeps tokens out of the body', async () => {
    const { body, cookies } = await cookieLogin('web@example.com');
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('refreshToken');
    expect(body.csrfToken).toEqual(cookies.get(CSRF)?.value);

    const at = cookies.get(AT)?.attributes ?? '';
    expect(at).toMatch(/HttpOnly/);
    expect(at).toMatch(/Secure/);
    expect(at).toMatch(/SameSite=Lax/);
    expect(at).toMatch(/Path=\//);
    const rt = cookies.get(RT)?.attributes ?? '';
    expect(rt).toMatch(/HttpOnly/);
    expect(rt).toMatch(/SameSite=Strict/);
    expect(rt).toMatch(/Path=\/v1\/auth/);
    // The CSRF cookie is readable by the web app's JavaScript, and only that.
    expect(cookies.get(CSRF)?.attributes).not.toMatch(/HttpOnly/);
  });

  it('allows safe requests with the cookie alone but requires a session-bound CSRF token for writes', async () => {
    const { body, cookies } = await cookieLogin('csrf@example.com');
    const jar = cookieHeader(cookies, [AT, CSRF]);
    await ctx.http().get('/v1/me').set('Cookie', jar).expect(200);

    const missing = await ctx
      .http()
      .patch('/v1/me')
      .set('Cookie', jar)
      .send({ displayName: 'Ada' })
      .expect(403);
    expect(missing.body.type).toBe('urn:suskii:problem:csrf-failed');

    // A token from another session (e.g. the attacker's own) is useless.
    const attacker = await cookieLogin('attacker@example.com');
    await ctx
      .http()
      .patch('/v1/me')
      .set('Cookie', jar)
      .set('X-CSRF-Token', attacker.body.csrfToken as string)
      .send({ displayName: 'Ada' })
      .expect(403);
    await ctx
      .http()
      .patch('/v1/me')
      .set('Cookie', jar)
      .set('X-CSRF-Token', 'forged.token')
      .send({ displayName: 'Ada' })
      .expect(403);

    const ok = await ctx
      .http()
      .patch('/v1/me')
      .set('Cookie', jar)
      .set('X-CSRF-Token', body.csrfToken as string)
      .send({ displayName: 'Ada' })
      .expect(200);
    expect(ok.body.displayName).toBe('Ada');
  });

  it('refreshes from the refresh cookie only with the CSRF header, rotating all three cookies', async () => {
    const { body, cookies } = await cookieLogin('refresh@example.com');
    const jar = cookieHeader(cookies, [RT, CSRF]);
    await ctx.http().post('/v1/auth/refresh').set('Cookie', jar).send({}).expect(403);

    const refreshed = await ctx
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', jar)
      .set('X-CSRF-Token', body.csrfToken as string)
      .send({})
      .expect(200);
    const rotated = parseSetCookies(refreshed.headers['set-cookie']);
    expect(rotated.get(RT)?.value).not.toBe(cookies.get(RT)?.value);
    expect(rotated.get(AT)?.value).toBeTruthy();
    expect(refreshed.body.csrfToken).toBe(rotated.get(CSRF)?.value);

    // Replaying the old refresh cookie is reuse: the session dies and the cookies are cleared.
    const replay = await ctx
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', jar)
      .set('X-CSRF-Token', body.csrfToken as string)
      .send({})
      .expect(401);
    expect(replay.body.type).toBe('urn:suskii:problem:session-revoked');
    expect(parseSetCookies(replay.headers['set-cookie']).get(AT)?.attributes).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
  });

  it('logs out with cookies (CSRF required) and clears them', async () => {
    const { body, cookies } = await cookieLogin('logout@example.com');
    const jar = cookieHeader(cookies, [AT, RT, CSRF]);
    // Without a valid CSRF token a cross-site page cannot sign the user out.
    const forged = await ctx.http().post('/v1/auth/logout').set('Cookie', jar).send({}).expect(403);
    expect(forged.body.type).toBe('urn:suskii:problem:csrf-failed');
    await ctx.http().get('/v1/me').set('Cookie', jar).expect(200);

    const out = await ctx
      .http()
      .post('/v1/auth/logout')
      .set('Cookie', jar)
      .set('X-CSRF-Token', body.csrfToken as string)
      .send({})
      .expect(204);
    const cleared = parseSetCookies(out.headers['set-cookie']);
    expect([...cleared.keys()].sort()).toEqual([AT, CSRF, RT].sort());
    await ctx.http().get('/v1/me').set('Cookie', jar).expect(401);
  });

  it('does not require CSRF for bearer-token requests (mobile)', async () => {
    await register(ctx, 'mobile@example.com');
    const login = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email: 'mobile@example.com', password: 'correct horse battery staple' })
      .expect(200);
    await ctx
      .http()
      .patch('/v1/me')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ displayName: 'Mobile' })
      .expect(200);
  });
});
