import { type ErrorReporter } from '@suskii/shared';
import { Queue, Worker } from 'bullmq';
import { type Redis } from 'ioredis';

import {
  ACCOUNT_JOB,
  BOOKING_JOB,
  BOOKINGS_QUEUE,
  FINANCE_JOB,
  processBookingJob,
  VISA_JOB,
} from './bookings-jobs.js';
import { type WorkerConfig } from './config.js';
import { type BookingsApi } from './internal-api.js';
import { type WorkerComponent } from './lifecycle.js';
import { type Logger } from './logger.js';
import { redisConnection } from './redis-connection.js';
import { instrumentWorker, observeQueue } from './telemetry.js';

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
  errors: ErrorReporter,
): WorkerComponent {
  let connection: Redis | undefined;
  let queue: Queue | undefined;
  let worker: Worker | undefined;
  let unobserve: (() => void) | undefined;

  return {
    name: 'bookings-queue',
    async start() {
      connection = redisConnection(config);
      const activeQueue = new Queue(BOOKINGS_QUEUE, { connection, prefix: PREFIX });
      queue = activeQueue;
      worker = new Worker(BOOKINGS_QUEUE, (job) => processBookingJob(job, { api, logger }), {
        connection,
        prefix: PREFIX,
        concurrency: 1,
      });
      instrumentWorker(worker, {
        queue: BOOKINGS_QUEUE,
        message: 'booking sweep failed',
        logger,
        errors,
      });
      unobserve = observeQueue(activeQueue);
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
        FINANCE_JOB.reconcileLedger,
        { every: config.LEDGER_RECONCILE_INTERVAL_MINUTES * 60_000, immediately: true },
        { name: FINANCE_JOB.reconcileLedger, opts },
      );
      await activeQueue.upsertJobScheduler(
        FINANCE_JOB.driverPayouts,
        { every: config.DRIVER_PAYOUT_INTERVAL_HOURS * 3_600_000, immediately: true },
        { name: FINANCE_JOB.driverPayouts, opts },
      );
      await activeQueue.upsertJobScheduler(
        ACCOUNT_JOB.retention,
        { every: config.RETENTION_SWEEP_INTERVAL_HOURS * 3_600_000, immediately: true },
        { name: ACCOUNT_JOB.retention, opts },
      );
    },
    async stop() {
      unobserve?.();
      await worker?.close();
      await queue?.close();
      await connection?.quit();
    },
  };
}
