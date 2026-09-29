import type { Role } from '@suskii/shared';

import { base32Decode, hotp, timeStep } from '../../src/crypto/totp';

import type { TestContext } from './test-app';

export const PASSWORD = 'correct horse battery staple';

export interface TokenSession {
  userId: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
}

export const bearer = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

export async function register(
  ctx: TestContext,
  email: string,
  password = PASSWORD,
): Promise<void> {
  await ctx.http().post('/v1/auth/register').send({ email, password }).expect(202);
  await ctx.background.drain();
}

export async function login(
  ctx: TestContext,
  email: string,
  password = PASSWORD,
): Promise<TokenSession> {
  const response = await ctx.http().post('/v1/auth/login').send({ email, password }).expect(200);
  if (response.body.status !== 'authenticated')
    throw new Error(`unexpected ${response.body.status}`);
  return {
    userId: response.body.user.id,
    sessionId: response.body.sessionId,
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
  };
}

export async function signUp(
  ctx: TestContext,
  email: string,
  password = PASSWORD,
): Promise<TokenSession> {
  await register(ctx, email, password);
  return login(ctx, email, password);
}

/** The token from the latest email of `template` sent to `email` (links carry it in the fragment). */
export async function emailToken(
  ctx: TestContext,
  email: string,
  template: string,
): Promise<string> {
  await ctx.background.drain();
  const message = ctx.emails.outbox.filter((m) => m.to === email && m.template === template).at(-1);
  const token = message?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error(`no ${template} email for ${email}`);
  return token;
}

export function lastSmsCode(ctx: TestContext, phone: string): string {
  const code = ctx.sms.outbox
    .filter((m) => m.to === phone)
    .at(-1)
    ?.body.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no SMS for ${phone}`);
  return code;
}

export function totp(secret: string, offsetSteps = 0): string {
  return hotp(base32Decode(secret), timeStep(Date.now()) + offsetSteps);
}

export async function grantRoles(ctx: TestContext, userId: string, roles: Role[]): Promise<void> {
  await ctx.prisma.userRole.createMany({
    data: roles.map((roleKey) => ({ userId, roleKey })),
    skipDuplicates: true,
  });
}

/** Enrols TOTP with the current code; returns the secret and recovery codes. */
export async function enrolTotp(
  ctx: TestContext,
  accessToken: string,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await ctx.http().post('/v1/me/mfa/totp').set(bearer(accessToken)).expect(201);
  const confirm = await ctx
    .http()
    .post('/v1/me/mfa/totp/confirm')
    .set(bearer(accessToken))
    .send({ code: totp(setup.body.secret) })
    .expect(200);
  return { secret: setup.body.secret, recoveryCodes: confirm.body.recoveryCodes };
}

/** Parses Set-Cookie headers into a name -> {value, attributes} map. */
export function parseSetCookies(
  header: string[] | string | undefined,
): Map<string, { value: string; attributes: string }> {
  const list = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return new Map(
    list.map((cookie) => {
      const [pair = '', ...attributes] = cookie.split(';');
      const index = pair.indexOf('=');
      return [
        pair.slice(0, index).trim(),
        { value: pair.slice(index + 1), attributes: attributes.join(';') },
      ];
    }),
  );
}

export function cookieHeader(cookies: Map<string, { value: string }>, names: string[]): string {
  return names.map((name) => `${name}=${cookies.get(name)?.value ?? ''}`).join('; ');
}
