import type { CookieOptions, Response } from 'express';

import type { AppConfig } from '../config/config';
import { parseEnv } from '../config/env.schema';

import { REFRESH_COOKIE_PATH, clearSessionCookies, setSessionCookies } from './cookies';

interface Written {
  kind: 'set' | 'clear';
  name: string;
  value?: string;
  options: CookieOptions;
}

/** Records what the helpers ask Express to send, in order. */
function recorder(): { response: Response; written: Written[] } {
  const written: Written[] = [];
  const response = {
    cookie(name: string, value: string, options: CookieOptions) {
      written.push({ kind: 'set', name, value, options });
      return response;
    },
    clearCookie(name: string, options: CookieOptions) {
      written.push({ kind: 'clear', name, options });
      return response;
    },
  };
  return { response: response as unknown as Response, written };
}

const config = (extra: Record<string, string> = {}): AppConfig =>
  parseEnv({
    DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
    REDIS_URL: 'redis://localhost:6379',
    ...extra,
  });

const session = {
  accessToken: 'access',
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000),
  refreshToken: 'refresh',
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  csrfToken: 'csrf',
};

const SHARED = 'endpoints.suskii.test';

describe('session cookies', () => {
  it("stay on the API's own name without COOKIE_DOMAIN and clear nothing else", () => {
    const { response, written } = recorder();
    setSessionCookies(response, config(), session);
    expect(written.map(({ kind, name }) => `${kind} ${name}`)).toEqual([
      'set __Secure-suskii_at',
      'set __Secure-suskii_rt',
      'set __Secure-suskii_csrf',
    ]);
    expect(written.every(({ options }) => options.domain === undefined)).toBe(true);
  });

  it('go on the shared parent with COOKIE_DOMAIN and expire the copies on the API name', () => {
    const { response, written } = recorder();
    setSessionCookies(response, config({ COOKIE_DOMAIN: SHARED }), session);
    const set = written.filter(({ kind }) => kind === 'set');
    expect(set.map(({ name, options }) => [name, options.domain, options.path])).toEqual([
      ['__Secure-suskii_at', SHARED, '/'],
      ['__Secure-suskii_rt', SHARED, REFRESH_COOKIE_PATH],
      ['__Secure-suskii_csrf', SHARED, '/'],
    ]);
    // The copies an earlier setting left are expired at the same name and path, with no domain
    // (another cookie than the shared one) and Secure, which a __Secure- name requires.
    const cleared = written.filter(({ kind }) => kind === 'clear');
    expect(cleared.map(({ name, options }) => [name, options.domain, options.path])).toEqual([
      ['__Secure-suskii_at', undefined, '/'],
      ['__Secure-suskii_rt', undefined, REFRESH_COOKIE_PATH],
      ['__Secure-suskii_csrf', undefined, '/'],
    ]);
    expect(cleared.every(({ options }) => options.secure === true)).toBe(true);
  });

  it('are cleared on both names at sign out with COOKIE_DOMAIN', () => {
    const { response, written } = recorder();
    clearSessionCookies(response, config({ COOKIE_DOMAIN: SHARED }));
    expect(written.every(({ kind }) => kind === 'clear')).toBe(true);
    expect(written.map(({ name, options }) => [name, options.domain ?? 'own name'])).toEqual([
      ['__Secure-suskii_at', 'own name'],
      ['__Secure-suskii_rt', 'own name'],
      ['__Secure-suskii_csrf', 'own name'],
      ['__Secure-suskii_at', SHARED],
      ['__Secure-suskii_rt', SHARED],
      ['__Secure-suskii_csrf', SHARED],
    ]);
  });

  it('are cleared once at sign out without COOKIE_DOMAIN', () => {
    const { response, written } = recorder();
    clearSessionCookies(response, config());
    expect(written).toHaveLength(3);
    expect(written.every(({ options }) => options.domain === undefined)).toBe(true);
  });
});
