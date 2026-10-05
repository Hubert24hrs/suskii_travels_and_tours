import { UnrecoverableError } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { InternalApiError, type InternalApi } from './internal-api.js';
import { JOB, processRefreshJob, refreshAllOnce, type PlannedJob } from './refresh-jobs.js';

const ROUTES = [
  { id: '01920000-0000-7000-8000-000000000001', slug: 'lagos-to-london' },
  { id: '01920000-0000-7000-8000-000000000002', slug: 'lagos-to-dubai' },
];
const CITIES = [{ id: '01920000-0000-7000-8000-000000000010', slug: 'dubai' }];
const REFRESHED = {
  status: 'refreshed' as const,
  snapshotId: 's',
  fetchedAt: '2026-10-01T00:00:00.000Z',
};

const fakeApi = (overrides: Partial<InternalApi> = {}): InternalApi => ({
  refreshTargets: vi.fn(() => Promise.resolve({ dealRoutes: ROUTES, hotelDestinations: CITIES })),
  refreshDealRoute: vi.fn(() => Promise.resolve(REFRESHED)),
  refreshDestination: vi.fn(() => Promise.resolve(REFRESHED)),
  pruneSnapshots: vi.fn(() => Promise.resolve({ deletedDeals: 3, deletedDestinations: 1 })),
  prunePushTokens: vi.fn(() => Promise.resolve({ deleted: 2 })),
  runPriceAlerts: vi.fn(() => Promise.resolve({ checked: 3, notified: 1, retired: 0, failed: 0 })),
  ...overrides,
});

const deps = (api: InternalApi, enqueued: PlannedJob[] = []) => ({
  api,
  enqueue: (jobs: PlannedJob[]) => {
    enqueued.push(...jobs);
    return Promise.resolve();
  },
  intervals: { dealsMinutes: 180, destinationsMinutes: 360 },
  logger: pino({ level: 'silent' }),
  now: () => new Date('2026-10-01T10:00:00Z'),
});

describe('price alerts', () => {
  it('runs due alerts through the API on the refresh queue', async () => {
    const api = fakeApi();
    await expect(
      processRefreshJob({ name: JOB.priceAlerts, data: {} }, deps(api)),
    ).resolves.toEqual({ checked: 3, notified: 1, retired: 0, failed: 0 });
    expect(api.runPriceAlerts).toHaveBeenCalledTimes(1);
  });
});

describe('refresh jobs', () => {
  it('plans one retrying job per route, with ids stable within an interval', async () => {
    const enqueued: PlannedJob[] = [];
    await expect(
      processRefreshJob({ name: JOB.planDeals, data: {} }, deps(fakeApi(), enqueued)),
    ).resolves.toEqual({ planned: 2 });
    expect(enqueued.map((job) => [job.name, job.data.slug, job.opts.attempts])).toEqual([
      [JOB.refreshRoute, 'lagos-to-london', 3],
      [JOB.refreshRoute, 'lagos-to-dubai', 3],
    ]);
    const slot = Math.floor(Date.parse('2026-10-01T10:00:00Z') / (180 * 60_000));
    expect(enqueued[0]?.opts.jobId).toBe(`deal-route-${ROUTES[0]?.id}-${slot}`);
    expect(enqueued.every((job) => !job.opts.jobId.includes(':'))).toBe(true);

    const cities: PlannedJob[] = [];
    await processRefreshJob({ name: JOB.planDestinations, data: {} }, deps(fakeApi(), cities));
    expect(cities.map((job) => job.data.destinationId)).toEqual([CITIES[0]?.id]);
  });

  it('refreshes one route or destination per job and prunes', async () => {
    const api = fakeApi();
    await processRefreshJob(
      { name: JOB.refreshRoute, data: { routeId: ROUTES[0]?.id, slug: 'lagos-to-london' } },
      deps(api),
    );
    expect(api.refreshDealRoute).toHaveBeenCalledWith(ROUTES[0]?.id);
    await processRefreshJob(
      { name: JOB.refreshDestination, data: { destinationId: CITIES[0]?.id, slug: 'dubai' } },
      deps(api),
    );
    expect(api.refreshDestination).toHaveBeenCalledWith(CITIES[0]?.id);
    await expect(processRefreshJob({ name: JOB.prune, data: {} }, deps(api))).resolves.toEqual({
      deletedDeals: 3,
      deletedDestinations: 1,
    });
    await expect(
      processRefreshJob({ name: JOB.prunePushTokens, data: {} }, deps(api)),
    ).resolves.toEqual({ deleted: 2 });
  });

  it('retries transient failures and stops on final ones', async () => {
    const job = { name: JOB.refreshRoute, data: { routeId: ROUTES[0]?.id, slug: 'x' } };
    const transient = fakeApi({
      refreshDealRoute: () => Promise.reject(new InternalApiError('refreshDealRoute', 503)),
    });
    await expect(processRefreshJob(job, deps(transient))).rejects.toBeInstanceOf(InternalApiError);
    const gone = fakeApi({
      refreshDealRoute: () => Promise.reject(new InternalApiError('refreshDealRoute', 404)),
    });
    await expect(processRefreshJob(job, deps(gone))).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      processRefreshJob({ name: JOB.refreshRoute, data: { routeId: 'nope' } }, deps(fakeApi())),
    ).rejects.toThrow();
    await expect(
      processRefreshJob({ name: 'mystery', data: {} }, deps(fakeApi())),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('refreshes everything once and reports failures', async () => {
    const api = fakeApi({
      refreshDealRoute: (routeId) =>
        routeId === ROUTES[1]?.id
          ? Promise.reject(new InternalApiError('refreshDealRoute', 503))
          : Promise.resolve(REFRESHED),
      refreshDestination: () =>
        Promise.resolve({ status: 'no_results' as const, snapshotId: null, fetchedAt: null }),
    });
    await expect(refreshAllOnce(api, 2)).resolves.toEqual({
      refreshed: 1,
      noResults: 1,
      failed: ['lagos-to-dubai'],
    });
  });
});
