import { createApiClient, type ApiClient, type Schemas } from '@suskii/api-client';

import { appConfig, CLIENT_ID } from '../config';

import { appUpdate } from './app-update';
import { noteAttestationResult } from './attestation';

export type { ApiClient, Schemas };

/**
 * A request that got no HTTP answer (no network, host unreachable, connection refused). The
 * platform's fetch reports these with different error types (Hermes' polyfill uses TypeError,
 * Expo's native fetch its own errors), so the client rethrows them as this one type.
 */
export class NetworkError extends TypeError {
  constructor(cause: unknown) {
    super('Network request failed', { cause });
    this.name = 'NetworkError';
  }
}

/**
 * A read with no answer after this long counts as no network, so screens fall back to the copies
 * saved on the phone instead of loading forever on a network that drops packets. Writes wait:
 * an upload on slow 3G can take minutes, and their Idempotency-Key covers a retry.
 */
export const READ_TIMEOUT_MS = 20_000;

/**
 * fetch with transport failures normalised to `NetworkError` and reads bounded by
 * `READ_TIMEOUT_MS` (reported as `NetworkError` too); the caller's own aborts stay aborts.
 */
function transport(
  fetchImpl: typeof globalThis.fetch,
  readTimeoutMs = READ_TIMEOUT_MS,
): typeof globalThis.fetch {
  return async (input, init) => {
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    // AbortSignal.any is missing on Hermes: a controller follows the caller's signal by hand.
    const timeout = method === 'GET' || method === 'HEAD' ? new AbortController() : null;
    const followCaller = () => timeout?.abort();
    if (timeout && callerSignal?.aborted) timeout.abort();
    else if (timeout) callerSignal?.addEventListener('abort', followCaller);
    const timer = timeout ? setTimeout(() => timeout.abort(), readTimeoutMs) : undefined;
    try {
      return await fetchImpl(input, timeout ? { ...init, signal: timeout.signal } : init);
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      throw error instanceof NetworkError ? error : new NetworkError(error);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', followCaller);
    }
  };
}

export interface TokenSource {
  accessToken(): string | undefined;
  /** Rotates the refresh token once (single flight); undefined when the session is gone. */
  refresh(): Promise<string | undefined>;
}

/**
 * The typed API client for the app (ADR-020): bearer token from memory, one refresh-and-retry on
 * a 401, and the client headers every request needs (sales channel, language).
 */
export function createAppApi(
  tokens: TokenSource,
  locale: () => string,
  platformFetch: typeof globalThis.fetch = globalThis.fetch,
): ApiClient {
  const fetchImpl = transport(platformFetch);
  const fetchWithRefresh = async (request: Request): Promise<Response> => {
    const retry = request.clone();
    const response = await fetchImpl(request);
    if (response.status !== 401 || !request.headers.has('Authorization')) return response;
    const fresh = await tokens.refresh();
    if (!fresh) return response;
    retry.headers.set('Authorization', `Bearer ${fresh}`);
    return fetchImpl(retry);
  };
  const client = createApiClient({
    baseUrl: appConfig.apiBaseUrl,
    getAccessToken: () => tokens.accessToken(),
    fetch: fetchWithRefresh as typeof globalThis.fetch,
  });
  client.use({
    onRequest({ request }) {
      request.headers.set('X-Suskii-Client', CLIENT_ID);
      request.headers.set('Accept-Language', locale());
      return request;
    },
    onResponse: noticeResponse,
  });
  return client;
}

/**
 * Reads what every answer may tell the app: 426 once this version is retired (switch to the
 * update screen) and the verdict on a device attestation the request carried. Returns nothing so
 * openapi-fetch keeps the response as it is: returning it would fail its `instanceof Response`
 * check on devices, where Expo's fetch answers with its own response class.
 */
function noticeResponse({
  request,
  response,
}: {
  request: Request;
  response: Response;
}): undefined {
  if (response.status === 426) appUpdate.markRequired();
  if (request.headers.has('X-Suskii-Attestation')) {
    void noteAttestationResult(response.headers.get('X-Suskii-Attestation-Result'));
  }
  return undefined;
}

/** A client without credentials, for the refresh call itself. */
export function createBareApi(fetchImpl: typeof globalThis.fetch = globalThis.fetch): ApiClient {
  const client = createApiClient({ baseUrl: appConfig.apiBaseUrl, fetch: transport(fetchImpl) });
  client.use({
    onRequest({ request }) {
      request.headers.set('X-Suskii-Client', CLIENT_ID);
      return request;
    },
    onResponse: noticeResponse,
  });
  return client;
}

/** Slug of a problem+json error (`urn:suskii:problem:<slug>`), if any. */
export function problemSlug(error: unknown): string | null {
  const type = (error as { type?: unknown } | null)?.type;
  return typeof type === 'string' ? (type.split(':').pop() ?? null) : null;
}

/**
 * True for failures that mean "no network" rather than an API answer. Only the client's own
 * `NetworkError`: any other TypeError is a bug, and must not pass for being offline.
 */
export const isNetworkError = (error: unknown): boolean => error instanceof NetworkError;
