import type { CookieOptions, Request, Response } from 'express';

import type { AppConfig } from '../config/config';

export interface SessionCookieNames {
  access: string;
  refresh: string;
  csrf: string;
}

/** `__Secure-` names require the Secure attribute, so the prefix is dropped only for plain-HTTP dev. */
export function sessionCookieNames(config: Pick<AppConfig, 'COOKIE_SECURE'>): SessionCookieNames {
  const prefix = config.COOKIE_SECURE ? '__Secure-' : '';
  return {
    access: `${prefix}suskii_at`,
    refresh: `${prefix}suskii_rt`,
    csrf: `${prefix}suskii_csrf`,
  };
}

/** The refresh cookie is only sent to the endpoints that consume it. */
export const REFRESH_COOKIE_PATH = '/v1/auth';

export interface CookieSession {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  csrfToken: string;
  /** False for a sign-in without "Remember me" (ADR-108). */
  remembered?: boolean;
}

function base(config: AppConfig): CookieOptions {
  return {
    secure: config.COOKIE_SECURE,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookies(
  response: Response,
  config: AppConfig,
  session: CookieSession,
): void {
  const names = sessionCookieNames(config);
  const now = Date.now();
  // Without "Remember me" the cookies carry no lifetime, so the browser drops them when it
  // closes; the tokens inside still expire on the server (ADR-108).
  const until = (expires: Date): CookieOptions =>
    session.remembered === false ? {} : { maxAge: expires.getTime() - now };
  response.cookie(names.access, session.accessToken, {
    ...base(config),
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...until(session.accessTokenExpiresAt),
  });
  response.cookie(names.refresh, session.refreshToken, {
    ...base(config),
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    ...until(session.refreshTokenExpiresAt),
  });
  // Readable by the web app's JavaScript so it can echo it in X-CSRF-Token.
  response.cookie(names.csrf, session.csrfToken, {
    ...base(config),
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    ...until(session.refreshTokenExpiresAt),
  });
}

export function clearSessionCookies(response: Response, config: AppConfig): void {
  const names = sessionCookieNames(config);
  response.clearCookie(names.access, { ...base(config), path: '/' });
  response.clearCookie(names.refresh, { ...base(config), path: REFRESH_COOKIE_PATH });
  response.clearCookie(names.csrf, { ...base(config), path: '/' });
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
