import createFetchClient, { type Client, type Middleware } from 'openapi-fetch';
import createQueryHooks from 'openapi-react-query';

import type { components, paths } from './schema';

export type { components, paths };
/** Named request/response schemas from the API, e.g. `Schemas['AuthUser']`. */
export type Schemas = components['schemas'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  /** API origin, e.g. process.env.NEXT_PUBLIC_API_BASE_URL. */
  baseUrl: string;
  /** Browsers: `'include'` sends the httpOnly auth cookies to the API origin. */
  credentials?: RequestCredentials;
  /** Mobile: returns the access token from secure storage (sent as a bearer token). */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  /** Browsers: returns the CSRF cookie value, echoed on state-changing requests. */
  getCsrfToken?: () => string | undefined;
  fetch?: typeof globalThis.fetch;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createFetchClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.credentials ? { credentials: options.credentials } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getAccessToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      if (!SAFE_METHODS.has(request.method)) {
        const csrf = options.getCsrfToken?.();
        if (csrf) request.headers.set('X-CSRF-Token', csrf);
      }
      return request;
    },
  };
  client.use(auth);
  return client;
}

/** TanStack Query hooks bound to a client: `api.useQuery('get', '/v1/me')`. */
export function createApiHooks(client: ApiClient): ReturnType<typeof createQueryHooks<paths>> {
  return createQueryHooks(client);
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { status?: unknown }).status === 'number'
  );
}
