// Imported first by main.ts: instrumentation has to patch modules before they load.
import { loadDevelopmentEnvFile } from '../config/config';

import { startTelemetry } from './telemetry';

// Load the local .env before reading OTEL_* (a no-op in production and tests).
loadDevelopmentEnvFile();

const sdk = startTelemetry();

if (sdk) {
  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
}
