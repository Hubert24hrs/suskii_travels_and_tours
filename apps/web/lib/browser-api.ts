import type { components, paths } from '@suskii/api-client/schema';
import createClient, { type Client } from 'openapi-fetch';

import { CLIENT_ID, publicEnv } from './env';

export type Schemas = components['schemas'];
export type BrowserApi = Client<paths>;

let client: BrowserApi | undefined;

/**
 * The API from the browser: typed routes, the web sales channel and the API's cookies (for
 * signed-in travellers once accounts reach the web in phase 9). Client components only.
 */
export function browserApi(): BrowserApi {
  client ??= createClient<paths>({
    baseUrl: publicEnv.apiBaseUrl.replace(/\/$/, ''),
    credentials: 'include',
    headers: { 'X-Suskii-Client': CLIENT_ID },
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
