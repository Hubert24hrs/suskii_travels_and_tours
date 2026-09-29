import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

/** Prefix of the local development token in .env.example; refused in production (ADR-011). */
const LOCAL_INTERNAL_TOKEN_PREFIX = 'local-dev-only-';

const minutes = (fallback: number) => z.coerce.number().int().min(5).max(10_080).default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(4100),

    REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://localhost:6379'),
    /** API base URL for server-to-server calls. */
    API_INTERNAL_URL: z.url().default('http://localhost:4000'),
    /** Service token for /v1/internal routes; without it the refresh jobs are disabled. */
    INTERNAL_API_TOKEN: z.string().min(32).optional(),
    DEALS_REFRESH_INTERVAL_MINUTES: minutes(180),
    DESTINATIONS_REFRESH_INTERVAL_MINUTES: minutes(360),
    SNAPSHOT_PRUNE_INTERVAL_MINUTES: minutes(1440),
    /** Refresh jobs in parallel per worker process. */
    REFRESH_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    /** Ceiling on refresh jobs per minute across all workers (supplier quotas). */
    REFRESH_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(30),
    /** How often unpaid bookings are expired and due ticketing attempts are made. */
    BOOKINGS_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(600).default(60),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.INTERNAL_API_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_API_TOKEN'],
        message: 'is required in production',
      });
    } else if (env.INTERNAL_API_TOKEN.startsWith(LOCAL_INTERNAL_TOKEN_PREFIX)) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_API_TOKEN'],
        message: 'the local development token is not allowed in production',
      });
    }
  });

export type WorkerConfig = z.infer<typeof envSchema>;

/**
 * Parses and validates the worker environment. Fails fast on bad input; the error
 * lists offending keys and rules but never echoes values, which may be secrets.
 * `KEY=` (empty) means unset, as in `.env.example`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid worker environment: ${issues}`);
  }
  return result.data;
}

/** Local development only: loads the repo-root `.env`; variables already set always win. */
export function loadDevelopmentEnvFile(cwd = process.cwd()): void {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return;
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, '../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}
