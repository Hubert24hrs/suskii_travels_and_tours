import { loadConfig } from './config.js';
import { createHealthServer } from './health-server.js';
import { createLifecycle, type WorkerComponent } from './lifecycle.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config);

// Queue processors (deals, ticketing reconciliation, notifications, installments)
// register here as WorkerComponents in the phases that introduce them.
const components: WorkerComponent[] = [createHealthServer(config.WORKER_HEALTH_PORT)];
const lifecycle = createLifecycle(components, logger);

const shutdown = (signal: NodeJS.Signals): void => {
  logger.info({ signal }, 'shutting down');
  lifecycle.stop().then(
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
