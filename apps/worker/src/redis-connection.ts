import { Redis, type RedisOptions } from 'ioredis';

import { type WorkerConfig } from './config.js';

/** A PEM, or the base64 of a PEM (single-line env vars and secret managers). */
const decodePem = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed.replace(/\\n/g, '\n').trim();
  return Buffer.from(trimmed, 'base64').toString('utf8').trim();
};

/**
 * A BullMQ connection: blocking commands are never retried per request. On `rediss://` with
 * REDIS_TLS_CA it verifies the managed Redis's server certificate against that CA (Memorystore,
 * ADR-059) instead of the system trust store.
 */
export function redisConnection(
  config: Pick<WorkerConfig, 'REDIS_URL' | 'REDIS_TLS_CA'>,
  options: RedisOptions = {},
): Redis {
  const tls =
    config.REDIS_URL.startsWith('rediss://') && config.REDIS_TLS_CA
      ? { tls: { ca: decodePem(config.REDIS_TLS_CA) } }
      : {};
  return new Redis(config.REDIS_URL, { ...options, maxRetriesPerRequest: null, ...tls });
}
