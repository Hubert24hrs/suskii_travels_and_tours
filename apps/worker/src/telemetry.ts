import { metrics, type Counter, type ObservableResult } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { createSentryReporter, noopErrorReporter, type ErrorReporter } from '@suskii/shared';
import type { Queue, Worker } from 'bullmq';

import { type WorkerConfig } from './config.js';
import { InternalApiError } from './internal-api.js';
import { type Logger } from './logger.js';

type TelemetryConfig = Pick<
  WorkerConfig,
  | 'NODE_ENV'
  | 'OTEL_EXPORTER_OTLP_ENDPOINT'
  | 'OTEL_SERVICE_NAME'
  | 'SENTRY_DSN'
  | 'SENTRY_ENVIRONMENT'
  | 'SENTRY_RELEASE'
>;

/**
 * Starts the metrics export when OTEL_EXPORTER_OTLP_ENDPOINT is set (ADR-047). Without it the
 * instruments below are no-ops, so recording is always safe.
 */
export function startMetrics(config: TelemetryConfig): MeterProvider | undefined {
  if (!config.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;
  const provider = new MeterProvider({
    resource: resourceFromAttributes({ 'service.name': config.OTEL_SERVICE_NAME }),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/metrics`,
        }),
        exportIntervalMillis: 60_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(provider);
  return provider;
}

/** Jobs that fail for good go to Sentry when SENTRY_DSN is set (ADR-046). */
export function createErrorReporter(config: TelemetryConfig): ErrorReporter {
  if (!config.SENTRY_DSN) return noopErrorReporter;
  return createSentryReporter({
    dsn: config.SENTRY_DSN,
    platform: 'node',
    service: 'worker',
    release: config.SENTRY_RELEASE,
    environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
  });
}

// Created on first use: the API has no proxy meter, so instruments made before startMetrics()
// would stay no-ops.
const meter = () => metrics.getMeter('suskii-worker');
let jobs: Counter | undefined;

/** Finished jobs by queue, job name and outcome. */
export function recordJob(queue: string, job: string, outcome: 'completed' | 'failed'): void {
  jobs ??= meter().createCounter('suskii.worker.jobs', {
    description: 'Finished jobs by queue, job name and outcome',
  });
  jobs.add(1, { queue, job, outcome });
}

const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed', 'prioritized'] as const;
const observed = new Set<Queue>();
let gaugeRegistered = false;

/**
 * Queue depth by queue and state, read from Redis at each export (ADR-047). Queues register
 * while they run; a backlog that keeps growing means the workers cannot keep up.
 */
export function observeQueue(queue: Queue): () => void {
  if (!gaugeRegistered) {
    gaugeRegistered = true;
    meter()
      .createObservableGauge('suskii.queue.jobs', {
        description: 'Jobs in each BullMQ queue by state',
      })
      .addCallback(async (result: ObservableResult) => {
        for (const queue of observed) {
          try {
            const counts = await queue.getJobCounts(...QUEUE_STATES);
            for (const state of QUEUE_STATES)
              result.observe(counts[state] ?? 0, { queue: queue.name, state });
          } catch {
            // Redis unavailable: the health check reports it; skip this reading.
          }
        }
      });
  }
  observed.add(queue);
  return () => observed.delete(queue);
}

/**
 * Counts finished jobs and logs failures with the API request id. Retries are expected, so only a
 * job that has used up its attempts counts as failed and is reported.
 */
export function instrumentWorker(
  worker: Worker,
  options: { queue: string; message: string; logger: Logger; errors: ErrorReporter },
): void {
  worker.on('completed', (job) => recordJob(options.queue, job.name, 'completed'));
  worker.on('failed', (job, error) => {
    const requestId = error instanceof InternalApiError ? error.requestId : undefined;
    options.logger.warn(
      { job: job?.name, attempts: job?.attemptsMade, requestId, err: error.message },
      options.message,
    );
    if (job && job.attemptsMade < (job.opts.attempts ?? 1)) return;
    recordJob(options.queue, job?.name ?? 'unknown', 'failed');
    void options.errors.capture(error, { queue: options.queue, job: job?.name, requestId });
  });
}
