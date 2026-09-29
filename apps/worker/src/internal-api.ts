import type { components, paths } from '@suskii/api-client/schema';
import createClient from 'openapi-fetch';

export type RefreshTargets = components['schemas']['RefreshTargets'];
export type RefreshResult = components['schemas']['RefreshResult'];
export type PruneResult = components['schemas']['PruneResult'];

/** A failed internal API call. `status` 0 means the API was unreachable or timed out. */
export class InternalApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`${operation} failed with status ${status}`);
    this.name = 'InternalApiError';
  }

  /** Worth retrying: the API or a supplier was unavailable, or we were rate limited. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** The worker's view of the API's /v1/internal routes (ADR-011). */
export interface InternalApi {
  readonly refreshTargets: () => Promise<RefreshTargets>;
  readonly refreshDealRoute: (routeId: string) => Promise<RefreshResult>;
  readonly refreshDestination: (destinationId: string) => Promise<RefreshResult>;
  readonly pruneSnapshots: () => Promise<PruneResult>;
}

export interface InternalApiOptions {
  baseUrl: string;
  token: string;
  /** A refresh runs a few supplier searches (each within the 12 s search budget). */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export function createInternalApi(options: InternalApiOptions): InternalApi {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    headers: { Authorization: `Bearer ${options.token}` },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const timeoutMs = options.timeoutMs ?? 60_000;

  const call = async <T>(
    operation: string,
    request: (signal: AbortSignal) => Promise<{ data?: T; response: Response }>,
  ): Promise<T> => {
    let result: { data?: T; response: Response };
    try {
      result = await request(AbortSignal.timeout(timeoutMs));
    } catch {
      throw new InternalApiError(operation, 0);
    }
    if (result.data === undefined) throw new InternalApiError(operation, result.response.status);
    return result.data;
  };

  return {
    refreshTargets: () =>
      call('listRefreshTargets', (signal) =>
        client.GET('/v1/internal/refresh-targets', { signal }),
      ),
    refreshDealRoute: (routeId) =>
      call('refreshDealRoute', (signal) =>
        client.POST('/v1/internal/deals/routes/{routeId}/refresh', {
          params: { path: { routeId } },
          signal,
        }),
      ),
    refreshDestination: (destinationId) =>
      call('refreshHotelDestination', (signal) =>
        client.POST('/v1/internal/destinations/{destinationId}/refresh', {
          params: { path: { destinationId } },
          signal,
        }),
      ),
    pruneSnapshots: () =>
      call('pruneSnapshots', (signal) => client.POST('/v1/internal/snapshots/prune', { signal })),
  };
}
