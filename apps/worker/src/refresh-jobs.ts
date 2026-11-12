import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';

import { InternalApiError, type InternalApi, type RefreshResult } from './internal-api.js';
import { type Logger } from './logger.js';

/**
 * Deals and hotel destination refreshes (ADR-011). Schedulers enqueue a "plan" job per interval;
 * planning fans out to one job per route or destination, so a failing route is retried on its
 * own (exponential backoff) without blocking the others. The API does the supplier work.
 */
export const REFRESH_QUEUE = 'refresh';

export const JOB = {
  planDeals: 'deals-plan',
  planDestinations: 'destinations-plan',
  refreshRoute: 'deals-route',
  refreshDestination: 'destinations-city',
  prune: 'snapshots-prune',
  prunePushTokens: 'push-tokens-prune',
  /** Due price alerts (ADR-032): supplier searches, under this queue's rate limit. */
  priceAlerts: 'price-alerts',
} as const;

const routeData = z.object({ routeId: z.uuid(), slug: z.string() });
const destinationData = z.object({ destinationId: z.uuid(), slug: z.string() });

export interface PlannedJob {
  name: string;
  data: Record<string, string>;
  opts: {
    jobId: string;
    attempts: number;
    backoff: { type: 'exponential'; delay: number };
    removeOnComplete: number;
    removeOnFail: number;
  };
}

export interface RefreshDeps {
  api: InternalApi;
  /** Adds planned jobs to the queue (`Queue.addBulk`). */
  enqueue: (jobs: PlannedJob[]) => Promise<unknown>;
  intervals: { dealsMinutes: number; destinationsMinutes: number };
  logger: Logger;
  now?: () => Date;
}

const RETRY = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 500,
  removeOnFail: 500,
};

/** Same id within one refresh interval, so a replayed plan job never duplicates work. */
const cycle = (now: Date, minutes: number): number =>
  Math.floor(now.getTime() / (minutes * 60_000));

/** Maps API failures to BullMQ semantics: retry transient ones, stop on the rest. */
async function refresh(run: () => Promise<RefreshResult>): Promise<RefreshResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InternalApiError && !error.retryable) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}

export async function processRefreshJob(
  job: { name: string; data: unknown },
  deps: RefreshDeps,
): Promise<unknown> {
  const now = (deps.now ?? (() => new Date()))();
  switch (job.name) {
    case JOB.planDeals: {
      const { dealRoutes } = await deps.api.refreshTargets();
      const slot = cycle(now, deps.intervals.dealsMinutes);
      await deps.enqueue(
        dealRoutes.map((route) => ({
          name: JOB.refreshRoute,
          data: { routeId: route.id, slug: route.slug },
          opts: { jobId: `deal-route-${route.id}-${slot}`, ...RETRY },
        })),
      );
      return { planned: dealRoutes.length };
    }
    case JOB.planDestinations: {
      const { hotelDestinations } = await deps.api.refreshTargets();
      const slot = cycle(now, deps.intervals.destinationsMinutes);
      await deps.enqueue(
        hotelDestinations.map((destination) => ({
          name: JOB.refreshDestination,
          data: { destinationId: destination.id, slug: destination.slug },
          opts: { jobId: `destination-${destination.id}-${slot}`, ...RETRY },
        })),
      );
      return { planned: hotelDestinations.length };
    }
    case JOB.refreshRoute: {
      const data = routeData.parse(job.data);
      const result = await refresh(() => deps.api.refreshDealRoute(data.routeId));
      deps.logger.info({ route: data.slug, status: result.status }, 'deal route refreshed');
      return result;
    }
    case JOB.refreshDestination: {
      const data = destinationData.parse(job.data);
      const result = await refresh(() => deps.api.refreshDestination(data.destinationId));
      deps.logger.info({ destination: data.slug, status: result.status }, 'destination refreshed');
      return result;
    }
    case JOB.prune: {
      const result = await deps.api.pruneSnapshots();
      deps.logger.info(result, 'old snapshots pruned');
      return result;
    }
    case JOB.prunePushTokens: {
      const result = await deps.api.prunePushTokens();
      deps.logger.info(result, 'push tokens pruned');
      return result;
    }
    case JOB.priceAlerts: {
      const result = await deps.api.runPriceAlerts();
      if (result.checked > 0) deps.logger.info(result, 'price alerts checked');
      return result;
    }
    default:
      throw new UnrecoverableError(`unknown job ${job.name}`);
  }
}

export interface RefreshSummary {
  refreshed: number;
  noResults: number;
  failed: string[];
}

/**
 * Refreshes everything once without the queue (`pnpm --filter @suskii/worker refresh:once`):
 * local development and test setup.
 */
export async function refreshAllOnce(
  api: InternalApi,
  concurrency: number,
): Promise<RefreshSummary> {
  const { dealRoutes, hotelDestinations } = await api.refreshTargets();
  const tasks = [
    ...dealRoutes.map((route) => ({ slug: route.slug, run: () => api.refreshDealRoute(route.id) })),
    ...hotelDestinations.map((destination) => ({
      slug: `hotels/${destination.slug}`,
      run: () => api.refreshDestination(destination.id),
    })),
  ];
  const summary: RefreshSummary = { refreshed: 0, noResults: 0, failed: [] };
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++];
      if (!task) return;
      try {
        const result = await task.run();
        if (result.status === 'refreshed') summary.refreshed += 1;
        else summary.noResults += 1;
      } catch {
        summary.failed.push(task.slug);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
  return summary;
}
