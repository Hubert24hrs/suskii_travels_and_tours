import { parseEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applies safe development defaults', () => {
    const env = parseEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('parses comma-separated lists and booleans', () => {
    const env = parseEnv({
      ...base,
      CORS_ORIGINS: 'http://localhost:3000, http://localhost:3001',
      COOKIE_SECURE: 'false',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('treats empty values from .env files as unset', () => {
    const env = parseEnv({
      ...base,
      JWT_PRIVATE_KEY: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      GOOGLE_CLIENT_IDS: '',
      COOKIE_DOMAIN: '',
    });
    expect(env.JWT_PRIVATE_KEY).toBeUndefined();
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.GOOGLE_CLIENT_IDS).toEqual([]);
    expect(env.COOKIE_DOMAIN).toBeUndefined();
  });

  it('validates the field encryption key length', () => {
    expect(() => parseEnv({ ...base, FIELD_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /FIELD_ENCRYPTION_KEY: must be 32 bytes/,
    );
    expect(
      parseEnv({ ...base, FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') })
        .FIELD_ENCRYPTION_KEY,
    ).toBeDefined();
  });

  it('keeps access tokens between 10 and 15 minutes', () => {
    expect(() => parseEnv({ ...base, ACCESS_TOKEN_TTL_SECONDS: '3600' })).toThrow(
      /ACCESS_TOKEN_TTL_SECONDS/,
    );
  });

  it('rejects non-Postgres database URLs without echoing the value', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://root:secret@db/app' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://root:secret@db/app' })).not.toThrow(
      /secret/,
    );
  });

  it('requires keys, secrets, secure cookies, CORS and real providers in production', () => {
    let message = '';
    try {
      parseEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false', EMAIL_PROVIDER: 'mock' });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const key of [
      'JWT_PRIVATE_KEY',
      'FIELD_ENCRYPTION_KEY',
      'HMAC_SECRET',
      'COOKIE_SECURE',
      'CORS_ORIGINS',
      'EMAIL_PROVIDER',
      'SMS_PROVIDER',
    ]) {
      expect(message).toContain(key);
    }
  });
});
