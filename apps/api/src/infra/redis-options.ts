import type { RedisOptions } from 'ioredis';

import type { AppConfig } from '../config/config';
import { decodePem } from '../crypto/pem';

/**
 * TLS settings for a `rediss://` connection: the private CA a managed Redis signs its server
 * certificate with (Memorystore, ADR-059), so the server is verified rather than just encrypted.
 * Without `REDIS_TLS_CA` the system trust store applies, as before.
 */
export function redisTls(config: Pick<AppConfig, 'REDIS_URL' | 'REDIS_TLS_CA'>): RedisOptions {
  if (!config.REDIS_URL.startsWith('rediss://') || !config.REDIS_TLS_CA) return {};
  return { tls: { ca: decodePem(config.REDIS_TLS_CA) } };
}
