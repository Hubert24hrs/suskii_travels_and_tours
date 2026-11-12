import { describe, expect, it } from 'vitest';

import { redisConnection } from './redis-connection.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ==\n-----END CERTIFICATE-----';

describe('redisConnection', () => {
  it('verifies a TLS connection against the configured CA', () => {
    const connection = redisConnection(
      {
        REDIS_URL: 'rediss://cache.internal:6378',
        REDIS_TLS_CA: Buffer.from(PEM).toString('base64'),
      },
      { lazyConnect: true },
    );
    expect(connection.options.tls).toMatchObject({ ca: PEM });
    expect(connection.options.maxRetriesPerRequest).toBeNull();
    connection.disconnect();
  });

  it('adds no TLS settings without a CA or on a plain connection', () => {
    const plain = redisConnection(
      { REDIS_URL: 'redis://cache:6379', REDIS_TLS_CA: PEM },
      { lazyConnect: true },
    );
    expect(plain.options.tls).toBeUndefined();
    plain.disconnect();
  });
});
