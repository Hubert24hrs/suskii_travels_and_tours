import type { components, paths } from '@suskii/api-client/schema';
import createClient, { type Client } from 'openapi-fetch';

import { CLIENT_ID, publicEnv } from './env';
import { csrfToken, ensureFreshSession } from './session';

export type Schemas = components['schemas'];
export type BrowserApi = Client<paths>;

let client: BrowserApi | undefined;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The API from the browser: typed routes, the web sales channel and the API's session cookies.
 * For signed-in travellers every request first refreshes an expiring session (so prices keep the
 * member tier) and every write carries the CSRF token the API requires with cookies.
 * Client components only.
 */
export function browserApi(): BrowserApi {
  if (client) return client;
  client = createClient<paths>({
    baseUrl: publicEnv.apiBaseUrl.replace(/\/$/, ''),
    credentials: 'include',
    headers: { 'X-Suskii-Client': CLIENT_ID },
  });
  client.use({
    async onRequest({ request, schemaPath }) {
      // Sign-in and refresh routes manage the session themselves.
      if (!schemaPath.startsWith('/v1/auth/')) await ensureFreshSession();
      const csrf = csrfToken();
      if (csrf && !SAFE_METHODS.has(request.method)) request.headers.set('X-CSRF-Token', csrf);
      return request;
    },
  });
  return client;
}

/** The problem slug of an API error (`price-changed` for `urn:suskii:problem:price-changed`). */
export function problemSlug(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const type = (error as { type?: unknown }).type;
  return typeof type === 'string' ? type.replace(/^urn:suskii:problem:/, '') : null;
}

/** A fresh key per logical write (booking, payment); retries of the same write reuse it. */
export function idempotencyKey(): string {
  return crypto.randomUUID();
}
