import { loadConfig, loadDevelopmentEnvFile } from './config.js';
import { createModelFactory } from './model/factory.js';
import { runAgentService } from './service.js';

async function main(): Promise<void> {
  loadDevelopmentEnvFile();
  const config = loadConfig();
  await runAgentService(config, createModelFactory(config));
}

main().catch((error: unknown) => {
  // Configuration errors name keys and rules, never values.
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
