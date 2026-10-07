import { loadConfig, loadDevelopmentEnvFile } from './config.js';
import { createBookingsQueue } from './bookings-queue.js';
import { createHealthServer } from './health-server.js';
import { createInternalApi } from './internal-api.js';
import { createLifecycle, type WorkerComponent } from './lifecycle.js';
import { createLogger } from './logger.js';
import { createRefreshQueue } from './refresh-queue.js';
import { createErrorReporter, startMetrics } from './telemetry.js';

loadDevelopmentEnvFile();
const config = loadConfig();
const logger = createLogger(config);
const metricsProvider = startMetrics(config);
const errors = createErrorReporter(config);

// Anything nothing caught (unhandled rejections included) is logged and reported, then the
// process exits as it would have and the platform restarts it.
process.once('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  setTimeout(() => process.exit(1), 2000).unref();
  void errors.capture(error, { kind: 'uncaught' }).finally(() => process.exit(1));
});

// Queue processors register here as WorkerComponents in the phases that introduce them:
// deals and destinations (phase 4), booking expiry and ticketing (phase 5); notifications and
// instalments later.
const components: WorkerComponent[] = [createHealthServer(config.WORKER_HEALTH_PORT)];
if (config.INTERNAL_API_TOKEN) {
  const api = createInternalApi({
    baseUrl: config.API_INTERNAL_URL,
    token: config.INTERNAL_API_TOKEN,
  });
  components.push(createRefreshQueue(config, api, logger, errors));
  components.push(createBookingsQueue(config, api, logger, errors));
} else {
  logger.warn(
    'INTERNAL_API_TOKEN is not set; deals refreshes, booking expiry and ticketing retries are disabled',
  );
}
const lifecycle = createLifecycle(components, logger);

const shutdown = (signal: NodeJS.Signals): void => {
  logger.info({ signal }, 'shutting down');
  lifecycle
    .stop()
    .then(() => metricsProvider?.shutdown())
    .then(
      () => process.exit(0),
      () => process.exit(1),
    );
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await lifecycle.start();
  logger.info({ env: config.NODE_ENV, healthPort: config.WORKER_HEALTH_PORT }, 'worker ready');
} catch {
  process.exit(1);
}
