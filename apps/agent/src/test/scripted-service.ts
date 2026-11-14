import { loadConfig } from '../config.js';
import { AgentModelFactory } from '../model/factory.js';
import { MockAgentModel, type MockScript } from '../model/mock-model.js';
import { runAgentService } from '../service.js';

import { wholeTripScript } from './whole-trip-script.js';

/**
 * The agent service with a scripted stand-in model, for the API's end-to-end suites
 * (`apps/api/test/agent-whole-trip.e2e-spec.ts`). The graph, the guard, the tool gateway over
 * HTTP and the checkpoints are the shipped ones; only the model's turns come from a script that
 * reads what the tools really returned. The build leaves src/test out, so this never ships, and
 * it refuses to start in production all the same.
 */
const SCRIPTS: Record<string, MockScript> = { 'whole-trip': wholeTripScript };

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('NODE_ENV: the scripted agent service is for tests only');
  }
  const script = SCRIPTS[process.env.AGENT_TEST_SCRIPT ?? ''];
  if (!script) {
    throw new Error(`AGENT_TEST_SCRIPT: one of ${Object.keys(SCRIPTS).join(', ')}`);
  }
  await runAgentService(
    config,
    new AgentModelFactory(new MockAgentModel(script), {
      router: 'mock-router',
      specialist: 'mock-specialist',
      fallback: 'mock-fallback',
    }),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
