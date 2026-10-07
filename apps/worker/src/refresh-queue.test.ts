import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { noopErrorReporter } from '@suskii/shared';
import { pino } from 'pino';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.js';
import type { InternalApi } from './internal-api.js';
import { JOB, REFRESH_QUEUE } from './refresh-jobs.js';
import { createRefreshQueue } from './refresh-queue.js';

/**
 * BullMQ wiring against a real Redis. Runs when TEST_REDIS_URL is set (CI e2e job, local
 * development); the logic itself is covered by refresh-jobs.test.ts without Redis.
 */
const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!redisUrl)('refresh queue (Redis)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  it('schedules planning immediately and fans out to per-route jobs', async () => {
    const flush = new Redis(redisUrl ?? '');
    await flush.flushdb();
    cleanup.push(() => flush.quit());

    const refreshed: string[] = [];
    const api: InternalApi = {
      refreshTargets: () =>
        Promise.resolve({
          dealRoutes: [
            { id: '01920000-0000-7000-8000-000000000001', slug: 'lagos-to-london' },
            { id: '01920000-0000-7000-8000-000000000002', slug: 'abuja-to-dubai' },
          ],
          hotelDestinations: [{ id: '01920000-0000-7000-8000-000000000010', slug: 'dubai' }],
        }),
      refreshDealRoute: vi.fn((id: string) => {
        refreshed.push(id);
        return Promise.resolve({ status: 'refreshed' as const, snapshotId: 's', fetchedAt: null });
      }),
      refreshDestination: vi.fn((id: string) => {
        refreshed.push(id);
        return Promise.resolve({ status: 'refreshed' as const, snapshotId: 's', fetchedAt: null });
      }),
      runPriceAlerts: vi.fn(() =>
        Promise.resolve({ checked: 0, notified: 0, retired: 0, failed: 0 }),
      ),
      pruneSnapshots: vi.fn(() => Promise.resolve({ deletedDeals: 0, deletedDestinations: 0 })),
      prunePushTokens: vi.fn(() => Promise.resolve({ deleted: 0 })),
    };
    const config = loadConfig({ REDIS_URL: redisUrl, REFRESH_CONCURRENCY: '3' });
    const component = createRefreshQueue(config, api, pino({ level: 'silent' }), noopErrorReporter);
    await component.start();
    cleanup.push(() => component.stop());

    await vi.waitFor(() => expect(refreshed).toHaveLength(3), { timeout: 10_000, interval: 100 });
    expect(api.pruneSnapshots).toHaveBeenCalled();
    await vi.waitFor(() => expect(api.prunePushTokens).toHaveBeenCalled(), { timeout: 10_000 });

    const connection = new Redis(redisUrl ?? '', { maxRetriesPerRequest: null });
    const queue = new Queue(REFRESH_QUEUE, { connection, prefix: 'suskii' });
    cleanup.push(
      () => connection.quit(),
      () => queue.close(),
    );
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key).sort()).toEqual(
      [JOB.planDeals, JOB.planDestinations, JOB.priceAlerts, JOB.prune, JOB.prunePushTokens].sort(),
    );
    // Replaying a plan in the same interval adds no duplicate route jobs.
    const events = new QueueEvents(REFRESH_QUEUE, {
      connection: { url: redisUrl },
      prefix: 'suskii',
    });
    cleanup.push(() => events.close());
    await queue.add(JOB.planDeals, {});
    await vi.waitFor(
      async () => expect(await queue.getCompletedCount()).toBeGreaterThanOrEqual(7),
      {
        timeout: 10_000,
        interval: 100,
      },
    );
    expect(refreshed).toHaveLength(3);
  });
});
