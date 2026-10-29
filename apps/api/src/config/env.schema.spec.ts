import { DEFAULT_COMPANY_TOPUP_LIMITS, LOCAL_INTERNAL_TOKEN_PREFIX, parseEnv } from './env.schema';

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
    expect(() => parseEnv({ ...base, HOTEL_SUPPLIERS: 'duffel' })).toThrow(/DUFFEL_API_TOKEN/);
    expect(
      parseEnv({ ...base, HOTEL_SUPPLIERS: 'duffel', DUFFEL_API_TOKEN: 'duffel_test_x' })
        .HOTEL_SUPPLIERS,
    ).toEqual(['duffel']);
    expect(() => parseEnv({ ...base, HOTEL_SUPPLIERS: 'booking' })).toThrow(/HOTEL_SUPPLIERS/);
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

  it('requires the Hotelbeds key and secret, and refuses its evaluation host in production', () => {
    const hotelbeds = { ...base, HOTEL_SUPPLIERS: 'hotelbeds' };
    expect(() => parseEnv(hotelbeds)).toThrow(/HOTELBEDS_API_KEY.*HOTELBEDS_API_SECRET/s);
    const env = parseEnv({ ...hotelbeds, HOTELBEDS_API_KEY: 'k', HOTELBEDS_API_SECRET: 's' });
    expect(env.HOTEL_SUPPLIERS).toEqual(['hotelbeds']);
    expect(env.HOTELBEDS_API_URL).toBe('https://api.test.hotelbeds.com');
    expect(env.HOTELBEDS_SEARCH_RADIUS_KM).toBe(20);
    expect(() => parseEnv({ ...base, HOTELBEDS_SEARCH_RADIUS_KM: '0' })).toThrow(
      /HOTELBEDS_SEARCH_RADIUS_KM/,
    );

    const production = (overrides: Record<string, string>) => {
      try {
        parseEnv({ ...base, NODE_ENV: 'production', ...overrides });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    const credentials = {
      HOTEL_SUPPLIERS: 'hotelbeds',
      HOTELBEDS_API_KEY: 'k',
      HOTELBEDS_API_SECRET: 's',
    };
    // The evaluation host confirms bookings that do not exist.
    expect(production(credentials)).toMatch(/HOTELBEDS_API_URL: the evaluation host books nothing/);
    expect(
      production({ ...credentials, HOTELBEDS_API_URL: 'https://api.hotelbeds.com' }),
    ).not.toContain('HOTELBEDS_API_URL');
    expect(production({ HOTELBEDS_API_URL: 'http://api.hotelbeds.com' })).toContain(
      'HOTELBEDS_API_URL: must use https',
    );
  });

  it('requires the Expedia key and secret, and refuses its sandbox host in production', () => {
    const expedia = { ...base, HOTEL_SUPPLIERS: 'expedia' };
    expect(() => parseEnv(expedia)).toThrow(/EXPEDIA_RAPID_API_KEY.*EXPEDIA_RAPID_SHARED_SECRET/s);
    const env = parseEnv({
      ...expedia,
      EXPEDIA_RAPID_API_KEY: 'k',
      EXPEDIA_RAPID_SHARED_SECRET: 's',
    });
    expect(env.HOTEL_SUPPLIERS).toEqual(['expedia']);
    expect(env.EXPEDIA_RAPID_API_URL).toBe('https://test.ean.com');
    expect(env.EXPEDIA_POINT_OF_SALE).toBe('NG');
    expect(env.EXPEDIA_REQUEST_CURRENCY).toBe('USD');
    expect(env.EXPEDIA_MAX_PROPERTIES).toBe(250);
    expect(() => parseEnv({ ...base, EXPEDIA_MAX_PROPERTIES: '251' })).toThrow(
      /EXPEDIA_MAX_PROPERTIES/,
    );
    expect(() => parseEnv({ ...base, EXPEDIA_POINT_OF_SALE: 'ng' })).toThrow(
      /EXPEDIA_POINT_OF_SALE/,
    );

    const production = (overrides: Record<string, string>) => {
      try {
        parseEnv({ ...base, NODE_ENV: 'production', ...overrides });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    const credentials = {
      HOTEL_SUPPLIERS: 'expedia',
      EXPEDIA_RAPID_API_KEY: 'k',
      EXPEDIA_RAPID_SHARED_SECRET: 's',
    };
    expect(production(credentials)).toMatch(
      /EXPEDIA_RAPID_API_URL: the sandbox host books nothing/,
    );
    expect(
      production({ ...credentials, EXPEDIA_RAPID_API_URL: 'https://api.ean.com' }),
    ).not.toContain('EXPEDIA_RAPID_API_URL');
    expect(production({ EXPEDIA_RAPID_API_URL: 'http://api.ean.com' })).toContain(
      'EXPEDIA_RAPID_API_URL: must use https',
    );
  });

  it('requires partner credentials and refuses mock partners in production (ADR-070)', () => {
    expect(() => parseEnv({ ...base, AFFILIATE_NETWORK: 'travelpayouts' })).toThrow(
      /TRAVELPAYOUTS_TOKEN.*TRAVELPAYOUTS_MARKER/s,
    );
    expect(() => parseEnv({ ...base, ACTIVITY_PARTNER: 'viator' })).toThrow(/VIATOR_API_KEY/);
    expect(() => parseEnv({ ...base, TRAVELPAYOUTS_POSTBACK_SECRET: 'too-short' })).toThrow(
      /TRAVELPAYOUTS_POSTBACK_SECRET/,
    );
    const env = parseEnv(base);
    expect(env.PARTNER_OFFERS_ENABLED).toBeUndefined();
    expect([env.AFFILIATE_NETWORK, env.ACTIVITY_PARTNER]).toEqual(['mock', 'mock']);
    expect(env.PARTNER_LINK_TTL_HOURS).toBe(24);

    const production = (overrides: Record<string, string>) => {
      try {
        parseEnv({ ...base, NODE_ENV: 'production', ...overrides });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    // Off in production unless set: the mocks are only refused once partner offers are on.
    expect(production({})).not.toContain('AFFILIATE_NETWORK');
    const on = production({ PARTNER_OFFERS_ENABLED: 'true' });
    expect(on).toContain('AFFILIATE_NETWORK: the mock network earns nothing');
    expect(on).toContain('ACTIVITY_PARTNER: mock activities');
    const real = production({
      PARTNER_OFFERS_ENABLED: 'true',
      AFFILIATE_NETWORK: 'travelpayouts',
      TRAVELPAYOUTS_TOKEN: 't',
      TRAVELPAYOUTS_MARKER: '12345',
      ACTIVITY_PARTNER: 'viator',
      VIATOR_API_KEY: 'v',
      VIATOR_API_URL: 'http://api.viator.com/partner',
    });
    expect(real).not.toContain('AFFILIATE_NETWORK');
    expect(real).toContain('TRAVELPAYOUTS_POSTBACK_SECRET: is required in production');
    expect(real).toContain('VIATOR_API_URL: must use https');
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

  it('refuses mock ad conversions in production and requires https to the networks (ADR-079)', () => {
    const production = (overrides: Record<string, string>) => {
      try {
        parseEnv({ ...base, NODE_ENV: 'production', ...overrides });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(parseEnv(base).AD_CONVERSIONS).toEqual([]);
    expect(production({ AD_CONVERSIONS: 'mock' })).toContain(
      'AD_CONVERSIONS: the mock sends nothing',
    );
    const plaintext = production({
      META_GRAPH_API_URL: 'http://graph.facebook.com/v26.0',
      TIKTOK_EVENTS_API_URL: 'http://business-api.tiktok.com/open_api/v1.3',
    });
    expect(plaintext).toContain('META_GRAPH_API_URL: must use https');
    expect(plaintext).toContain('TIKTOK_EVENTS_API_URL: must use https');
  });

  it('needs the webhook secrets for whatsapp support, the token for cloud, and no mock in production (ADR-084)', () => {
    expect(parseEnv(base).WHATSAPP_SUPPORT_PROVIDER).toBe('none');
    expect(() => parseEnv({ ...base, WHATSAPP_SUPPORT_PROVIDER: 'mock' })).toThrow(
      /WHATSAPP_APP_SECRET.*WHATSAPP_VERIFY_TOKEN/s,
    );
    const secrets = {
      WHATSAPP_APP_SECRET: 'app-secret-0123456789',
      WHATSAPP_VERIFY_TOKEN: 'verify-token-0123456789',
    };
    expect(
      parseEnv({ ...base, WHATSAPP_SUPPORT_PROVIDER: 'mock', ...secrets })
        .WHATSAPP_SUPPORT_TEMPLATE,
    ).toBe('support_reply_waiting');
    expect(() => parseEnv({ ...base, WHATSAPP_SUPPORT_PROVIDER: 'cloud', ...secrets })).toThrow(
      /WHATSAPP_PHONE_NUMBER_ID.*WHATSAPP_ACCESS_TOKEN/s,
    );
    let message = '';
    try {
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        WHATSAPP_SUPPORT_PROVIDER: 'mock',
        WHATSAPP_GRAPH_API_URL: 'http://graph.facebook.com/v26.0',
        ...secrets,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('WHATSAPP_SUPPORT_PROVIDER: the mock answers nobody');
    expect(message).toContain('WHATSAPP_GRAPH_API_URL: must use https');
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

  it('takes company wallet top-up limits per currency, replacing the defaults (ADR-090)', () => {
    expect(parseEnv(base).COMPANY_WALLET_TOPUP_LIMITS).toEqual(DEFAULT_COMPANY_TOPUP_LIMITS);
    expect(
      parseEnv({ ...base, COMPANY_WALLET_TOPUP_LIMITS: '' }).COMPANY_WALLET_TOPUP_LIMITS,
    ).toEqual(DEFAULT_COMPANY_TOPUP_LIMITS);
    expect(
      parseEnv({ ...base, COMPANY_WALLET_TOPUP_LIMITS: 'GHS=5000/2000000, NGN=500000/100000000' })
        .COMPANY_WALLET_TOPUP_LIMITS,
    ).toEqual({
      GHS: { minMinor: 5_000, maxMinor: 2_000_000 },
      NGN: { minMinor: 500_000, maxMinor: 100_000_000 },
    });
    for (const bad of ['NGN=0/100', 'NGN=500/100', 'naira=1/2', 'NGN=100']) {
      expect(() => parseEnv({ ...base, COMPANY_WALLET_TOPUP_LIMITS: bad })).toThrow(
        /COMPANY_WALLET_TOPUP_LIMITS/,
      );
    }
    expect(parseEnv(base).COMPANY_WALLET_TOPUPS_PER_DAY).toBe(5);
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

  it('needs credentials for every text provider named, routes by calling code, and no mock in production (ADR-091)', () => {
    expect(parseEnv(base)).toMatchObject({ SMS_PROVIDER: 'mock', SMS_ROUTES: [] });
    expect(() => parseEnv({ ...base, SMS_PROVIDER: 'termii' })).toThrow(
      /TERMII_API_KEY.*TERMII_SENDER_ID/s,
    );
    expect(() => parseEnv({ ...base, SMS_ROUTES: '254=africastalking' })).toThrow(
      /AFRICASTALKING_USERNAME.*AFRICASTALKING_API_KEY/s,
    );
    expect(() => parseEnv({ ...base, SMS_ROUTES: '+234=termii' })).toThrow(/SMS_ROUTES/);
    const env = parseEnv({
      ...base,
      SMS_PROVIDER: 'africastalking',
      SMS_ROUTES: '234=termii',
      TERMII_API_KEY: 'TL-test-key-0123456789',
      TERMII_SENDER_ID: 'SuskiiTT',
      AFRICASTALKING_USERNAME: 'suskii',
      AFRICASTALKING_API_KEY: 'atsk_test_0123456789',
    });
    expect(env.SMS_ROUTES).toEqual([['234', 'termii']]);
    expect(env.TERMII_CHANNEL).toBe('dnd');
    let message = '';
    try {
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        SMS_PROVIDER: 'africastalking',
        SMS_ROUTES: '233=mock',
        AFRICASTALKING_USERNAME: 'sandbox',
        AFRICASTALKING_API_KEY: 'atsk_test_0123456789',
        AFRICASTALKING_API_URL: 'https://api.sandbox.africastalking.com',
        TERMII_API_URL: 'http://api.ng.termii.com',
        WHATSAPP_PROVIDER: 'none',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('SMS_ROUTES: mock provider is not allowed');
    expect(message).toContain('AFRICASTALKING_API_URL: the sandbox delivers nothing');
    expect(message).toContain('TERMII_API_URL: must use https');
    expect(message).not.toContain('SMS_PROVIDER');
    // `none` turns WhatsApp notifications off, which production accepts.
    expect(message).not.toContain('WHATSAPP_PROVIDER');
  });

  it('needs the app id for real exchange rates and reads fixed rates per dollar (ADR-091)', () => {
    expect(() => parseEnv({ ...base, FX_PROVIDER: 'openexchangerates' })).toThrow(
      /OPENEXCHANGERATES_APP_ID/,
    );
    const env = parseEnv({
      ...base,
      FX_PROVIDER: 'openexchangerates',
      OPENEXCHANGERATES_APP_ID: 'oxr-app-id-0123456789',
      FX_RATE_OVERRIDES: 'NGN=1600.5, GHS=15',
    });
    expect(env.FX_RATE_OVERRIDES).toEqual({ NGN: '1600.5', GHS: '15' });
    expect(parseEnv(base).FX_RATE_OVERRIDES).toEqual({});
    expect(() => parseEnv({ ...base, FX_RATE_OVERRIDES: 'NGN=1,600' })).toThrow(
      /FX_RATE_OVERRIDES/,
    );
    expect(() => parseEnv({ ...base, FX_RATE_OVERRIDES: 'ngn=1600' })).toThrow(/FX_RATE_OVERRIDES/);
  });
});
