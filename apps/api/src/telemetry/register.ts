// Imported first by main.ts: instrumentation has to patch modules before they load.
import { startTelemetry } from './telemetry';

const sdk = startTelemetry();

if (sdk) {
  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
}
