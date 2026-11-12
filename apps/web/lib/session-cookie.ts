import { readCookie } from './read-cookie';

/**
 * Whether the browser holds a session, from the API's readable CSRF cookie (ADR-007). Apart from
 * `session.ts`, so the header can show "Account" without shipping the refresh code on every page
 * (ADR-013).
 */
const CSRF_COOKIES = ['__Secure-suskii_csrf', 'suskii_csrf'] as const;

/** The CSRF token of the current session, or null when signed out. */
export function csrfToken(): string | null {
  for (const name of CSRF_COOKIES) {
    const value = readCookie(name);
    if (value) return value;
  }
  return null;
}

/** Whether a session cookie exists (it may still need a refresh). */
export function hasSession(): boolean {
  return csrfToken() !== null;
}
