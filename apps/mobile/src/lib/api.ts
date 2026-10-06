import { createApiClient, type ApiClient, type Schemas } from '@suskii/api-client';

import { appConfig, CLIENT_ID } from '../config';

import { appUpdate } from './app-update';

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

/** fetch with transport failures normalised to `NetworkError`; aborts stay aborts. */
function transport(fetchImpl: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    try {
      return await fetchImpl(input, init);
    } catch (error) {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (signal?.aborted) throw error;
      throw error instanceof NetworkError ? error : new NetworkError(error);
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
    onResponse: noticeRetiredVersion,
  });
  return client;
}

/** The API answers 426 once this app version is retired: switch to the update screen. */
function noticeRetiredVersion({ response }: { response: Response }): Response {
  if (response.status === 426) appUpdate.markRequired();
  return response;
}

/** A client without credentials, for the refresh call itself. */
export function createBareApi(fetchImpl: typeof globalThis.fetch = globalThis.fetch): ApiClient {
  const client = createApiClient({ baseUrl: appConfig.apiBaseUrl, fetch: transport(fetchImpl) });
  client.use({
    onRequest({ request }) {
      request.headers.set('X-Suskii-Client', CLIENT_ID);
      return request;
    },
    onResponse: noticeRetiredVersion,
  });
  return client;
}

/** Slug of a problem+json error (`urn:suskii:problem:<slug>`), if any. */
export function problemSlug(error: unknown): string | null {
  const type = (error as { type?: unknown } | null)?.type;
  return typeof type === 'string' ? (type.split(':').pop() ?? null) : null;
}

/** True for failures that mean "no network" rather than an API answer. */
export const isNetworkError = (error: unknown): boolean => error instanceof TypeError;
