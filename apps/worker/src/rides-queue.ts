import { type ErrorReporter } from '@suskii/shared';
import { Queue, Worker } from 'bullmq';
import { type Redis } from 'ioredis';

import { type WorkerConfig } from './config.js';
import { type RidesApi } from './internal-api.js';
import { type WorkerComponent } from './lifecycle.js';
import { type Logger } from './logger.js';
import { redisConnection } from './redis-connection.js';
import { processRideJob, RIDE_JOB, RIDES_QUEUE } from './rides-jobs.js';
import { instrumentWorker, observeQueue } from './telemetry.js';

const PREFIX = 'suskii';

/**
 * Ride matching on its own queue (ADR-053): it runs every few seconds and must never wait behind
 * booking sweeps or supplier refreshes. Schedulers in Redis keep one schedule across replicas.
 */
export function createRidesQueue(
  config: WorkerConfig,
  api: RidesApi,
  logger: Logger,
  errors: ErrorReporter,
): WorkerComponent {
  let connection: Redis | undefined;
  let queue: Queue | undefined;
  let worker: Worker | undefined;
  let unobserve: (() => void) | undefined;

  return {
    name: 'rides-queue',
    async start() {
      connection = redisConnection(config);
      const activeQueue = new Queue(RIDES_QUEUE, { connection, prefix: PREFIX });
      queue = activeQueue;
      worker = new Worker(RIDES_QUEUE, (job) => processRideJob(job, { api, logger }), {
        connection,
        prefix: PREFIX,
        concurrency: 1,
      });
      instrumentWorker(worker, { queue: RIDES_QUEUE, message: 'rides job failed', logger, errors });
      unobserve = observeQueue(activeQueue);
      // Runs repeat within seconds, so a failed one is not retried and history stays short.
      const opts = { attempts: 1, removeOnComplete: 50, removeOnFail: 100 };
      await activeQueue.upsertJobScheduler(
        RIDE_JOB.dispatch,
        { every: config.RIDES_DISPATCH_INTERVAL_SECONDS * 1000, immediately: true },
        { name: RIDE_JOB.dispatch, opts },
      );
      await activeQueue.upsertJobScheduler(
        RIDE_JOB.driverDocuments,
        { every: config.VISA_SCAN_INTERVAL_SECONDS * 1000, immediately: true },
        { name: RIDE_JOB.driverDocuments, opts },
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
