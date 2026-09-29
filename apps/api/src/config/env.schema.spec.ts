import { LOCAL_INTERNAL_TOKEN_PREFIX, parseEnv } from './env.schema';

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

  it('gates suppliers behind flags and requires the Duffel token when enabled', () => {
    expect(parseEnv(base).FLIGHT_SUPPLIERS).toEqual(['mock']);
    expect(() => parseEnv({ ...base, FLIGHT_SUPPLIERS: 'mock,duffel' })).toThrow(
      /DUFFEL_API_TOKEN/,
    );
    expect(
      parseEnv({ ...base, FLIGHT_SUPPLIERS: 'duffel', DUFFEL_API_TOKEN: 'duffel_test_x' })
        .FLIGHT_SUPPLIERS,
    ).toEqual(['duffel']);
    expect(() => parseEnv({ ...base, FLIGHT_SUPPLIERS: 'amadeus' })).toThrow(/FLIGHT_SUPPLIERS/);
    expect(() =>
      parseEnv({ ...base, SEARCH_TIMEOUT_MS: '5000', SUPPLIER_TIMEOUT_MS: '8000' }),
    ).toThrow(/SUPPLIER_TIMEOUT_MS/);
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
      'FLIGHT_SUPPLIERS',
      'HOTEL_SUPPLIERS',
      'FX_PROVIDER',
      'INTERNAL_API_TOKEN',
      'TURNSTILE_SECRET_KEY',
    ]) {
      expect(message).toContain(key);
    }
  });

  it('requires each enabled payment provider keys, and no mock payments in production', () => {
    expect(parseEnv(base).PAYMENT_PROVIDERS).toEqual(['mock']);
    expect(() => parseEnv({ ...base, PAYMENT_PROVIDERS: 'paystack,stripe' })).toThrow(
      /PAYSTACK_SECRET_KEY.*STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET/s,
    );
    expect(() => parseEnv({ ...base, PAYMENT_PROVIDERS: 'flutterwave,flutterwave' })).toThrow(
      /list each provider once/,
    );
    const env = parseEnv({
      ...base,
      PAYMENT_PROVIDERS: 'paystack, mock',
      PAYSTACK_SECRET_KEY: 'sk_test_0123456789abcdef',
    });
    expect(env.PAYMENT_PROVIDERS).toEqual(['paystack', 'mock']);
    expect(env.INSTALLMENT_DEPOSIT_BPS).toBe(3000);
    expect(env.REFUND_APPROVAL_THRESHOLD_NGN).toBe(0);
    let message = '';
    try {
      parseEnv({ ...base, NODE_ENV: 'production', PAYSTACK_API_URL: 'http://paystack.local' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('PAYMENT_PROVIDERS: mock payments are not allowed in production');
    expect(message).toContain('PAYSTACK_API_URL: must use https in production');
  });

  it('refuses the local development internal token in production', () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        INTERNAL_API_TOKEN: `${LOCAL_INTERNAL_TOKEN_PREFIX}0123456789abcdefghij`,
      }),
    ).toThrow(/INTERNAL_API_TOKEN: the local development token is not allowed in production/);
  });

  it('parses deal refresh settings with sensible defaults', () => {
    expect(parseEnv(base)).toMatchObject({
      DEALS_MAX_AGE_HOURS: 24,
      DEALS_DEPARTURE_OFFSETS_DAYS: [21, 45],
      DESTINATIONS_CHECK_IN_OFFSET_DAYS: 30,
      SNAPSHOT_RETENTION_DAYS: 7,
    });
    expect(parseEnv({ ...base, DEALS_DEPARTURE_OFFSETS_DAYS: '14, 30,60' })).toMatchObject({
      DEALS_DEPARTURE_OFFSETS_DAYS: [14, 30, 60],
    });
    expect(() => parseEnv({ ...base, DEALS_DEPARTURE_OFFSETS_DAYS: 'soon' })).toThrow(
      /DEALS_DEPARTURE_OFFSETS_DAYS/,
    );
    expect(() => parseEnv({ ...base, INTERNAL_API_TOKEN: 'short' })).toThrow(/INTERNAL_API_TOKEN/);
  });
});
