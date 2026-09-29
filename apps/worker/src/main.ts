import { loadConfig, loadDevelopmentEnvFile } from './config.js';
import { createHealthServer } from './health-server.js';
import { createInternalApi } from './internal-api.js';
import { createLifecycle, type WorkerComponent } from './lifecycle.js';
import { createLogger } from './logger.js';
import { createRefreshQueue } from './refresh-queue.js';

loadDevelopmentEnvFile();
const config = loadConfig();
const logger = createLogger(config);

// Queue processors register here as WorkerComponents in the phases that introduce them:
// deals and destinations (phase 4); ticketing, notifications and instalments later.
const components: WorkerComponent[] = [createHealthServer(config.WORKER_HEALTH_PORT)];
if (config.INTERNAL_API_TOKEN) {
  const api = createInternalApi({
    baseUrl: config.API_INTERNAL_URL,
    token: config.INTERNAL_API_TOKEN,
  });
  components.push(createRefreshQueue(config, api, logger));
} else {
  logger.warn('INTERNAL_API_TOKEN is not set; deals and destination refreshes are disabled');
}
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
