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
    expect(env.DATABASE_POOL_MAX).toBe(10);
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

  it("takes the client address from either the edge's header or proxy hops, never both", () => {
    expect(parseEnv({ ...base, CLIENT_IP_HEADER: 'cf-connecting-ip' }).CLIENT_IP_HEADER).toBe(
      'cf-connecting-ip',
    );
    expect(() =>
      parseEnv({ ...base, CLIENT_IP_HEADER: 'cf-connecting-ip', TRUST_PROXY_HOPS: '2' }),
    ).toThrow(/CLIENT_IP_HEADER: set either/);
    expect(() => parseEnv({ ...base, CLIENT_IP_HEADER: 'CF Connecting IP' })).toThrow(
      /CLIENT_IP_HEADER/,
    );
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
      'ADMIN_ORIGINS',
      'EMAIL_PROVIDER',
      'SMS_PROVIDER',
      'FLIGHT_SUPPLIERS',
      'HOTEL_SUPPLIERS',
      'FX_PROVIDER',
      'INTERNAL_API_TOKEN',
      'TURNSTILE_SECRET_KEY',
      'PUSH_PROVIDER',
      'DEVICE_ATTESTATION',
    ]) {
      expect(message).toContain(key);
    }
  });

  it('requires TLS to Postgres and Redis in production unless the hop is declared private', () => {
    const production = (overrides: Record<string, string>) => {
      try {
        parseEnv({ ...base, NODE_ENV: 'production', ...overrides });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    const plaintext = production({});
    expect(plaintext).toContain('DATABASE_URL');
    expect(plaintext).toContain('REDIS_URL');
    expect(plaintext).not.toContain(':pw@');
    const tls = production({
      DATABASE_URL: 'postgresql://suskii:pw@db.internal:5432/suskii?sslmode=verify-full',
      REDIS_URL: 'rediss://cache.internal:6380',
    });
    expect(tls).not.toMatch(/DATABASE_URL|REDIS_URL/);
    expect(production({ DATABASE_URL: `${base.DATABASE_URL}?sslmode=prefer` })).toContain(
      'DATABASE_URL',
    );
    const declared = production({
      DATABASE_ALLOW_PLAINTEXT: 'true',
      REDIS_ALLOW_PLAINTEXT: 'true',
    });
    expect(declared).not.toMatch(/DATABASE_URL|REDIS_URL/);
  });

  it('pauses only enabled payment providers', () => {
    expect(
      parseEnv({ ...base, PAYMENT_PROVIDERS_PAUSED: 'mock' }).PAYMENT_PROVIDERS_PAUSED,
    ).toEqual(['mock']);
    expect(() => parseEnv({ ...base, PAYMENT_PROVIDERS_PAUSED: 'stripe' })).toThrow(
      /PAYMENT_PROVIDERS_PAUSED/,
    );
  });

  it('requires TLS to suppliers and telemetry in production, except a local collector', () => {
    const production = (overrides: Record<string, string>) => {
      try {
        parseEnv({ ...base, NODE_ENV: 'production', ...overrides });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    const plaintext = production({
      DUFFEL_API_URL: 'http://api.duffel.com',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.example.com:4318',
    });
    expect(plaintext).toContain('DUFFEL_API_URL');
    expect(plaintext).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
    expect(production({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' })).not.toContain(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    );
    expect(production({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com' })).not.toContain(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    );
  });

  it('defaults push and attestation to mocks outside production, off by default', () => {
    const env = parseEnv(base);
    expect(env.PUSH_PROVIDER).toBe('mock');
    expect(env.DEVICE_ATTESTATION).toBe('mock');
    expect(env.ATTESTATION_MODE).toBe('off');
    expect(() => parseEnv({ ...base, ATTESTATION_MODE: 'strict' })).toThrow(/ATTESTATION_MODE/);
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

  it('leaves Cars products off in production and requires their real providers when on', () => {
    const env = parseEnv(base);
    expect(env.CARS_RIDES_ENABLED).toBeUndefined();
    expect(env.BUS_SEAT_HOLD_MINUTES).toBe(10);
    expect(env.MAPS_PROVIDER).toBe('mock');
    expect(() => parseEnv({ ...base, MAPS_PROVIDER: 'osrm' })).toThrow(/OSRM_URL/);
    let message = '';
    try {
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        CARS_BUSES_ENABLED: 'true',
        CARS_RIDES_ENABLED: 'true',
        MAPS_PROVIDER: 'osrm',
        OSRM_URL: 'http://osrm.internal:5000',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const key of ['CARS_TICKET_SIGNING_KEY', 'KYC_PROVIDER', 'PAYOUT_PROVIDER', 'OSRM_URL']) {
      expect(message).toContain(key);
    }
    expect(message).not.toContain('MAPS_PROVIDER:');
  });
});
