import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(4100),
});

export type WorkerConfig = z.infer<typeof envSchema>;

/**
 * Parses and validates the worker environment. Fails fast on bad input; the error
 * lists offending keys and rules but never echoes values, which may be secrets.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid worker environment: ${issues}`);
  }
  return result.data;
}
