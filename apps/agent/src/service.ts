import { createCheckpointer } from './checkpointer.js';
import { type AgentConfig } from './config.js';
import { createLogger } from './logger.js';
import { type AgentModelFactory } from './model/factory.js';
import { RunService } from './runs.js';
import { createAgentServer } from './server.js';
import { HttpToolGateway } from './tools/gateway.js';

/** How long running runs get to finish when the platform asks the process to stop. */
const DRAIN_MS = 25_000;

/**
 * Starts the agent service with the models given: checkpoints, the tool gateway, the runs and
 * the HTTP server, then stops them in order on SIGTERM or SIGINT. `main.ts` passes the models
 * from settings; nothing else in a build calls this.
 */
export async function runAgentService(
  config: AgentConfig,
  models: AgentModelFactory,
): Promise<void> {
  const logger = createLogger(config);
  const checkpointer = createCheckpointer(config);
  const runs = new RunService({
    models,
    gateway: new HttpToolGateway({
      baseUrl: config.API_INTERNAL_URL,
      token: config.AGENT_TOOLS_TOKEN ?? '',
      timeoutMs: config.AGENT_TOOL_TIMEOUT_MS,
    }),
    checkpointer: checkpointer.saver,
    logger,
    maxConcurrentRuns: config.AGENT_MAX_CONCURRENT_RUNS,
    toolTimeoutMs: config.AGENT_TOOL_TIMEOUT_MS,
  });
  const server = createAgentServer({
    port: config.AGENT_PORT,
    runToken: config.AGENT_RUN_TOKEN,
    runs,
    ready: () => checkpointer.ready(),
    logger,
  });
  await server.start();
  logger.info(
    {
      port: server.port(),
      model: models.provider,
      checkpoints: config.AGENT_DATABASE_URL ? 'postgres' : 'memory',
    },
    'agent service started',
  );

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'agent service stopping');
    const deadline = Date.now() + DRAIN_MS;
    const drain = async (): Promise<void> => {
      await server.stop().catch(() => undefined);
      while (runs.running > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await checkpointer.close().catch(() => undefined);
    };
    void drain().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
