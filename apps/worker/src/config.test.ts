import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies safe defaults for an empty environment', () => {
    expect(loadConfig({})).toStrictEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      WORKER_HEALTH_PORT: 4100,
      REDIS_URL: 'redis://localhost:6379',
      API_INTERNAL_URL: 'http://localhost:4000',
      REDIS_ALLOW_PLAINTEXT: false,
      API_INTERNAL_ALLOW_PLAINTEXT: false,
      DEALS_REFRESH_INTERVAL_MINUTES: 180,
      DESTINATIONS_REFRESH_INTERVAL_MINUTES: 360,
      SNAPSHOT_PRUNE_INTERVAL_MINUTES: 1440,
      REFRESH_CONCURRENCY: 2,
      REFRESH_RATE_PER_MINUTE: 30,
      BOOKINGS_SWEEP_INTERVAL_SECONDS: 60,
      VISA_SCAN_INTERVAL_SECONDS: 300,
      VISA_PRUNE_INTERVAL_HOURS: 24,
      PRICE_ALERT_SWEEP_MINUTES: 15,
      REMINDER_SWEEP_MINUTES: 15,
      REFERRAL_SWEEP_MINUTES: 60,
      RETENTION_SWEEP_INTERVAL_HOURS: 24,
      OTEL_SERVICE_NAME: 'suskii-worker',
    });
  });

  it('refuses a malformed Sentry DSN without echoing it', () => {
    expect(() => loadConfig({ SENTRY_DSN: 'http://leaky-key@sentry.example.com/1' })).toThrow(
      /^Invalid worker environment: SENTRY_DSN: Expected https:\/\/<key>@<host>\/<project>$/,
    );
  });

  it('coerces numbers and treats empty values as unset', () => {
    const config = loadConfig({ WORKER_HEALTH_PORT: '9000', INTERNAL_API_TOKEN: '' });
    expect(config.WORKER_HEALTH_PORT).toBe(9000);
    expect(config.INTERNAL_API_TOKEN).toBeUndefined();
  });

  it('rejects invalid values and names the offending key without echoing the value', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'shout', WORKER_HEALTH_PORT: '70000' })).toThrow(
      /LOG_LEVEL.*WORKER_HEALTH_PORT/,
    );
    expect(() => loadConfig({ LOG_LEVEL: 'super-secret-value' })).not.toThrow(/super-secret-value/);
    expect(() => loadConfig({ INTERNAL_API_TOKEN: 'too-short' })).toThrow(/INTERNAL_API_TOKEN/);
  });

  it('requires a real service token in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      /INTERNAL_API_TOKEN: is required in production/,
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        INTERNAL_API_TOKEN: 'local-dev-only-internal-token-change-me',
      }),
    ).toThrow(/local development token/);
  });

  it('requires TLS to Redis and the API in production unless the hop is declared private', () => {
    const production = {
      NODE_ENV: 'production',
      INTERNAL_API_TOKEN: 'a-real-service-token-0123456789abcdef',
    };
    expect(() => loadConfig(production)).toThrow(/REDIS_URL.*API_INTERNAL_URL/);
    expect(
      loadConfig({
        ...production,
        REDIS_URL: 'rediss://cache.internal:6380',
        API_INTERNAL_URL: 'https://api.internal',
      }).REDIS_URL,
    ).toBe('rediss://cache.internal:6380');
    expect(
      loadConfig({
        ...production,
        REDIS_ALLOW_PLAINTEXT: 'true',
        API_INTERNAL_ALLOW_PLAINTEXT: '1',
      }).API_INTERNAL_ALLOW_PLAINTEXT,
    ).toBe(true);
  });
});
