import { loadConfig, loadDevelopmentEnvFile } from './config.js';
import { createInternalApi } from './internal-api.js';
import { createLogger } from './logger.js';
import { refreshAllOnce } from './refresh-jobs.js';

// Refreshes every deal route and hotel destination once, without the queue. Handy after seeding a
// local database: `pnpm --filter @suskii/worker refresh:once` (the API must be running).
loadDevelopmentEnvFile();
const config = loadConfig();
const logger = createLogger(config);

if (!config.INTERNAL_API_TOKEN) {
  logger.error('INTERNAL_API_TOKEN is not set; cannot call the internal API');
  process.exit(1);
}

const api = createInternalApi({
  baseUrl: config.API_INTERNAL_URL,
  token: config.INTERNAL_API_TOKEN,
});
try {
  const summary = await refreshAllOnce(api, config.REFRESH_CONCURRENCY);
  logger.info(summary, 'refresh complete');
  process.exit(summary.failed.length > 0 ? 1 : 0);
} catch (error) {
  logger.error({ err: (error as Error).message }, 'refresh failed');
  process.exit(1);
}
