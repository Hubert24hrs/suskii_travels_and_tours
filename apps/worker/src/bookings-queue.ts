import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import {
  ACCOUNT_JOB,
  BOOKING_JOB,
  BOOKINGS_QUEUE,
  processBookingJob,
  VISA_JOB,
} from './bookings-jobs.js';
import { type WorkerConfig } from './config.js';
import { type BookingsApi } from './internal-api.js';
import { type WorkerComponent } from './lifecycle.js';
import { type Logger } from './logger.js';

const PREFIX = 'suskii';

/**
 * The booking sweeps on their own queue, so ticketing never waits behind fare refreshes or their
 * supplier rate limit. One job at a time per process; schedulers in Redis keep a single schedule
 * across replicas.
 */
export function createBookingsQueue(
  config: WorkerConfig,
  api: BookingsApi,
  logger: Logger,
): WorkerComponent {
  let connection: Redis | undefined;
  let queue: Queue | undefined;
  let worker: Worker | undefined;

  return {
    name: 'bookings-queue',
    async start() {
      connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
      const activeQueue = new Queue(BOOKINGS_QUEUE, { connection, prefix: PREFIX });
      queue = activeQueue;
      worker = new Worker(BOOKINGS_QUEUE, (job) => processBookingJob(job, { api, logger }), {
        connection,
        prefix: PREFIX,
        concurrency: 1,
      });
      worker.on('failed', (job, error) => {
        logger.warn({ job: job?.name, err: error.message }, 'booking sweep failed');
      });
      const repeat = { every: config.BOOKINGS_SWEEP_INTERVAL_SECONDS * 1000, immediately: true };
      // Sweeps repeat every minute anyway, so a failed run is not retried and history stays short.
      const opts = { attempts: 1, removeOnComplete: 100, removeOnFail: 100 };
      for (const name of Object.values(BOOKING_JOB)) {
        await activeQueue.upsertJobScheduler(name, repeat, { name, opts });
      }
      await activeQueue.upsertJobScheduler(
        VISA_JOB.scan,
        { every: config.VISA_SCAN_INTERVAL_SECONDS * 1000, immediately: true },
        { name: VISA_JOB.scan, opts },
      );
      await activeQueue.upsertJobScheduler(
        VISA_JOB.prune,
        { every: config.VISA_PRUNE_INTERVAL_HOURS * 3_600_000, immediately: true },
        { name: VISA_JOB.prune, opts },
      );
      await activeQueue.upsertJobScheduler(
        ACCOUNT_JOB.reminders,
        { every: config.REMINDER_SWEEP_MINUTES * 60_000, immediately: true },
        { name: ACCOUNT_JOB.reminders, opts },
      );
      await activeQueue.upsertJobScheduler(
        ACCOUNT_JOB.referrals,
        { every: config.REFERRAL_SWEEP_MINUTES * 60_000, immediately: true },
        { name: ACCOUNT_JOB.referrals, opts },
      );
      await activeQueue.upsertJobScheduler(
        ACCOUNT_JOB.retention,
        { every: config.RETENTION_SWEEP_INTERVAL_HOURS * 3_600_000, immediately: true },
        { name: ACCOUNT_JOB.retention, opts },
      );
    },
    async stop() {
      await worker?.close();
      await queue?.close();
      await connection?.quit();
    },
  };
}
