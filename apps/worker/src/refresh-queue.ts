import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { type WorkerConfig } from './config.js';
import { type InternalApi } from './internal-api.js';
import { type WorkerComponent } from './lifecycle.js';
import { type Logger } from './logger.js';
import { JOB, processRefreshJob, REFRESH_QUEUE } from './refresh-jobs.js';

const PREFIX = 'suskii';

/**
 * BullMQ queue, worker and job schedulers for the refresh jobs. Schedulers live in Redis, so any
 * number of worker replicas share one schedule and each job runs once.
 */
export function createRefreshQueue(
  config: WorkerConfig,
  api: InternalApi,
  logger: Logger,
): WorkerComponent {
  let connection: Redis | undefined;
  let queue: Queue | undefined;
  let worker: Worker | undefined;

  return {
    name: 'refresh-queue',
    async start() {
      // BullMQ workers need blocking commands that are never retried per request.
      connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
      const activeQueue = new Queue(REFRESH_QUEUE, { connection, prefix: PREFIX });
      queue = activeQueue;
      worker = new Worker(
        REFRESH_QUEUE,
        (job) =>
          processRefreshJob(job, {
            api,
            enqueue: (jobs) => activeQueue.addBulk(jobs),
            intervals: {
              dealsMinutes: config.DEALS_REFRESH_INTERVAL_MINUTES,
              destinationsMinutes: config.DESTINATIONS_REFRESH_INTERVAL_MINUTES,
            },
            logger,
          }),
        {
          connection,
          prefix: PREFIX,
          concurrency: config.REFRESH_CONCURRENCY,
          limiter: { max: config.REFRESH_RATE_PER_MINUTE, duration: 60_000 },
        },
      );
      worker.on('failed', (job, error) => {
        logger.warn(
          { job: job?.name, attempts: job?.attemptsMade, err: error.message },
          'refresh job failed',
        );
      });
      const every = (minutes: number) => ({ every: minutes * 60_000, immediately: true });
      await activeQueue.upsertJobScheduler(
        JOB.planDeals,
        every(config.DEALS_REFRESH_INTERVAL_MINUTES),
        {
          name: JOB.planDeals,
        },
      );
      await activeQueue.upsertJobScheduler(
        JOB.planDestinations,
        every(config.DESTINATIONS_REFRESH_INTERVAL_MINUTES),
        { name: JOB.planDestinations },
      );
      await activeQueue.upsertJobScheduler(
        JOB.prune,
        every(config.SNAPSHOT_PRUNE_INTERVAL_MINUTES),
        {
          name: JOB.prune,
        },
      );
      // Daily housekeeping shares the snapshot schedule (ADR-022).
      await activeQueue.upsertJobScheduler(
        JOB.prunePushTokens,
        every(config.SNAPSHOT_PRUNE_INTERVAL_MINUTES),
        { name: JOB.prunePushTokens },
      );
      // A failed alert run is simply picked up by the next one (the API tracks what is due).
      await activeQueue.upsertJobScheduler(
        JOB.priceAlerts,
        every(config.PRICE_ALERT_SWEEP_MINUTES),
        { name: JOB.priceAlerts, opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } },
      );
    },
    async stop() {
      await worker?.close();
      await queue?.close();
      await connection?.quit();
    },
  };
}
