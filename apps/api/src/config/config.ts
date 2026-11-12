import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseEnv, type Env } from './env.schema';

/** DI token for the validated configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
export type AppConfig = Env;

/**
 * Loads the repo-root `.env` for local development only. Production configuration is injected
 * by the platform (secret manager); variables already set in the process always win.
 */
export function loadDevelopmentEnvFile(cwd = process.cwd()): void {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return;
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, '../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return parseEnv(source);
}
