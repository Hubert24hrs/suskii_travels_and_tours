import { publicEnv } from './env';

/**
 * Web sessions (ADR-007, phase 9). The API keeps tokens in httpOnly cookies on its own origin
 * (same site as the web app) and a readable CSRF cookie that the browser echoes in
 * `X-CSRF-Token`. The access cookie lives 15 minutes; the app refreshes it before it runs out so
 * searches keep the member's prices. Refresh tokens are single use and a reused one revokes the
 * whole session, so refreshes are serialised across tabs with a Web Lock and re-checked inside it.
 * Client only: nothing here runs during server rendering.
 */

const CSRF_COOKIES = ['__Secure-suskii_csrf', 'suskii_csrf'] as const;
const EXPIRY_KEY = 'suskii.session.accessExpiresAt';
const REFRESH_LOCK = 'suskii-session-refresh';
/** Refresh this long before the access token expires. */
const MARGIN_MS = 60_000;

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

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

function storedExpiry(): number {
  try {
    return Number(window.localStorage.getItem(EXPIRY_KEY) ?? 0);
  } catch {
    return 0;
  }
}

/** Notes when the access cookie expires (after sign-in or a refresh). */
export function rememberSession(accessTokenExpiresAt: string): void {
  try {
    window.localStorage.setItem(EXPIRY_KEY, String(Date.parse(accessTokenExpiresAt)));
  } catch {
    // Private mode: the app refreshes before each request instead.
  }
  window.dispatchEvent(new Event('suskii:session'));
}

export function forgetSession(): void {
  try {
    window.localStorage.removeItem(EXPIRY_KEY);
  } catch {
    // Nothing stored.
  }
  window.dispatchEvent(new Event('suskii:session'));
}

const needsRefresh = (): boolean => storedExpiry() - MARGIN_MS <= Date.now();

let inflight: Promise<boolean> | null = null;

async function refreshNow(): Promise<boolean> {
  // Another tab may have refreshed while this one waited for the lock.
  if (!needsRefresh()) return true;
  const csrf = csrfToken();
  if (!csrf) return false;
  try {
    const response = await fetch(`${publicEnv.apiBaseUrl.replace(/\/$/, '')}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: '{}',
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) forgetSession();
      return false;
    }
    const body = (await response.json()) as { accessTokenExpiresAt?: string };
    if (body.accessTokenExpiresAt) rememberSession(body.accessTokenExpiresAt);
    return true;
  } catch {
    return false;
  }
}

/** Refreshes the session once (across tabs) when the access cookie is about to expire. */
export function ensureFreshSession(): Promise<boolean> {
  if (!hasSession()) return Promise.resolve(false);
  if (!needsRefresh()) return Promise.resolve(true);
  inflight ??= (async () => {
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      return locks ? await locks.request(REFRESH_LOCK, refreshNow) : await refreshNow();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forces the next request to refresh first (after the API answered 401 for a live session). */
export function expireSession(): void {
  try {
    window.localStorage.setItem(EXPIRY_KEY, '0');
  } catch {
    // Nothing stored.
  }
}
