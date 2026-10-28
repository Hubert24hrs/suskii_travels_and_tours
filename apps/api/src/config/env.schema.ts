import { parseDsn } from '@suskii/shared';
import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

/** True when a Postgres URL makes the driver insist on TLS (never echoes the URL). */
/** An https URL, or plain http to a collector on the same host (a sidecar). */
export function isTlsOrLoopback(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  return protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

function requiresTls(databaseUrl: string): boolean {
  const params = new URL(databaseUrl).searchParams;
  const sslmode = params.get('sslmode');
  if (sslmode !== null) return ['require', 'verify-ca', 'verify-full'].includes(sslmode);
  return params.get('ssl') === 'true' || params.get('ssl') === '1';
}

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item));

const originOf = (url: string): string => new URL(url).origin;

/** Prefix of the local development internal token in .env.example; refused in production. */
export const LOCAL_INTERNAL_TOKEN_PREFIX = 'local-dev-only-';

/** Every environment variable the API reads. Values are never echoed in validation errors. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /**
     * Connections per process (node-postgres pool). Instances times this must stay under the
     * database's max_connections with room for migrations and operators (ADR-059).
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /**
     * Production requires TLS to Postgres (`sslmode=verify-full`, or `require`) and Redis
     * (`rediss://`). Set these only when the hop is already private and encrypted another way: a
     * Unix socket or a local Cloud SQL Auth Proxy, a sidecar or a mesh with mTLS (ADR-038).
     */
    DATABASE_ALLOW_PLAINTEXT: booleanish.default(false),
    REDIS_ALLOW_PLAINTEXT: booleanish.default(false),
    /** CA of a managed Redis's server certificate (PEM or its base64), e.g. Memorystore's. */
    REDIS_TLS_CA: z.string().min(1).optional(),

    /** Browser origins allowed to call the API with credentials. */
    CORS_ORIGINS: csv(z.url()).default([]),
    /** Number of trusted reverse proxies (Cloudflare, load balancer) in front of the API. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    /**
     * Request header carrying the client's address as set by the edge (`cf-connecting-ip` behind
     * Cloudflare), used instead of counting X-Forwarded-For hops. Only set it when the edge
     * overwrites the header on every request and the origin accepts nothing but the edge's
     * traffic (ADR-059).
     */
    CLIENT_IP_HEADER: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .optional(),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    COOKIE_SECURE: booleanish.default(true),
    WEB_APP_URL: z.url().default('http://localhost:3000'),

    /** Ed25519 PKCS#8 private key (PEM, or base64 of the PEM) used to sign access tokens. */
    JWT_PRIVATE_KEY: z.string().min(1).optional(),
    JWT_PUBLIC_KEY: z.string().min(1).optional(),
    /** Retired public keys still accepted during rotation (PEM or base64, `|`-separated). */
    JWT_PREVIOUS_PUBLIC_KEYS: z.string().min(1).optional(),
    JWT_ISSUER: z.string().min(1).default('suskii-api'),
    JWT_AUDIENCE: z.string().min(1).default('suskii'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(600).max(900).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Signed-in devices per account; a new sign-in beyond it ends the least recently used one. */
    MAX_ACTIVE_SESSIONS: z.coerce.number().int().min(1).max(50).default(10),
    /**
     * Staff accounts (any role besides customer, ADR-037): fewer devices, an idle timeout instead
     * of REFRESH_TOKEN_TTL_DAYS and an absolute lifetime of hours, not days.
     */
    STAFF_MAX_ACTIVE_SESSIONS: z.coerce.number().int().min(1).max(10).default(3),
    STAFF_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
    STAFF_SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(24).default(12),
    /** How long an authenticator code counts for step-up admin actions (role changes, refunds). */
    STEP_UP_WINDOW_MINUTES: z.coerce.number().int().min(1).max(30).default(10),

    /** 32-byte key (base64) for field-level encryption until the KMS adapter lands (phase 12). */
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes, base64')
      .optional(),
    /** Id written into every new envelope (`v2.<id>.`); change it with the key (ADR-038). */
    FIELD_ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[a-z0-9]{1,16}$/, 'lower-case letters and digits, at most 16')
      .default('k1'),
    /**
     * Retired keys that still decrypt during a rotation, as `id:base64key` (comma-separated).
     * Remove one once `keys:reencrypt` reports nothing left under it.
     */
    FIELD_ENCRYPTION_PREVIOUS_KEYS: csv(
      z
        .string()
        .regex(/^[a-z0-9]{1,16}:[A-Za-z0-9+/_-]+={0,2}$/, 'must be id:base64key')
        .refine(
          (entry) => Buffer.from(entry.slice(entry.indexOf(':') + 1), 'base64').length === 32,
          'each key must be 32 bytes, base64',
        ),
    ).default([]),
    /**
     * Server secret (>= 32 chars) from which purpose-specific HMAC keys are derived (HKDF): IP
     * pseudonymisation, CSRF tokens, OTP and recovery-code hashes.
     */
    HMAC_SECRET: z.string().min(32).optional(),

    HIBP_ENABLED: booleanish.default(true),
    EMAIL_PROVIDER: z.enum(['smtp', 'mock']).default('smtp'),
    EMAIL_FROM: z.string().min(3).default('Suskii Travels <no-reply@localhost>'),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMS_PROVIDER: z.enum(['mock']).default('mock'),
    WHATSAPP_PROVIDER: z.enum(['mock']).default('mock'),
    /** Push notifications (ADR-022): Expo's push service relays to FCM and APNs. */
    PUSH_PROVIDER: z.enum(['expo', 'mock']).default('mock'),
    EXPO_PUSH_URL: z.url().default('https://exp.host/--/api/v2/push/send'),
    /** Expo access token for enhanced push security (recommended in production). */
    EXPO_ACCESS_TOKEN: z.string().min(16).optional(),
    /**
     * Device attestation (ADR-023). `none` rejects every attestation until real Play Integrity and
     * App Attest verifiers are configured; `mock` accepts `mock:<challenge>` (development, tests).
     */
    DEVICE_ATTESTATION: z.enum(['mock', 'none']).default('mock'),
    /**
     * Oldest app version still served (MASVS-CODE-2); older apps get 426 `app-update-required`
     * and show an update screen. Unset serves every version.
     */
    MOBILE_MIN_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'must be a version like 1.4.0')
      .optional(),
    /** Attestation on mobile login, registration and payment start: off, report or enforce. */
    ATTESTATION_MODE: z.enum(['off', 'report', 'enforce']).default('off'),
    /** Staging escape hatch: allow mock email/SMS providers when NODE_ENV=production. */
    ALLOW_MOCK_PROVIDERS: booleanish.default(false),

    GOOGLE_CLIENT_IDS: csv(z.string().min(1)).default([]),
    APPLE_CLIENT_IDS: csv(z.string().min(1)).default([]),
    /**
     * Test stacks only (ADR-067): a mock Google and Apple sign-in, so the buttons work without the
     * providers' client ids. It signs anyone in as any email, so production refuses it even with
     * ALLOW_MOCK_PROVIDERS.
     */
    SOCIAL_MOCK_ENABLED: booleanish.default(false),

    /** Optional IP allowlist for /v1/admin routes (exact IPs). */
    ADMIN_IP_ALLOWLIST: csv(z.string().min(1)).default([]),
    /**
     * Admin console origins. Cookie-authenticated admin requests must come from one of them
     * (ADR-033); each must also be in CORS_ORIGINS.
     */
    ADMIN_ORIGINS: csv(z.url())
      .default(['http://localhost:3001'])
      .transform((origins) => origins.map((origin) => new URL(origin).origin)),
    RATE_LIMIT_ENABLED: booleanish.default(true),

    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default('suskii-api'),
    /** Error reports go to Sentry with this DSN (ADR-046); without one they are only logged. */
    SENTRY_DSN: z
      .string()
      .refine((value) => parseDsn(value) !== null, 'Expected https://<key>@<host>/<project>')
      .optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).max(64).optional(),
    /** The deployed version (the git SHA), so reports match the uploaded source maps. */
    SENTRY_RELEASE: z.string().min(1).max(128).optional(),

    /**
     * Enabled flight and hotel suppliers (feature flags). `duffel` needs DUFFEL_API_TOKEN;
     * `hotelbeds` needs HOTELBEDS_API_KEY and HOTELBEDS_API_SECRET (ADR-071).
     */
    FLIGHT_SUPPLIERS: csv(z.enum(['mock', 'duffel'])).default(['mock']),
    HOTEL_SUPPLIERS: csv(z.enum(['mock', 'duffel', 'hotelbeds'])).default(['mock']),
    DUFFEL_API_TOKEN: z.string().min(1).optional(),
    DUFFEL_API_URL: z.url().default('https://api.duffel.com'),
    /** Hotelbeds APItude; the default is the evaluation host, which books nothing. */
    HOTELBEDS_API_URL: z.url().default('https://api.test.hotelbeds.com'),
    HOTELBEDS_API_KEY: z.string().min(1).optional(),
    HOTELBEDS_API_SECRET: z.string().min(1).optional(),
    /** Kilometres around the city centre a Hotelbeds search covers. */
    HOTELBEDS_SEARCH_RADIUS_KM: z.coerce.number().int().min(1).max(200).default(20),
    /** Whole-search budget (spec: 12 s) and per-supplier timeout inside it. */
    SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(12_000),
    SUPPLIER_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000),
    /** How long identical searches are served from cache (spec: 5-15 minutes). */
    SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
    FX_PROVIDER: z.enum(['mock']).default('mock'),
    FX_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
    /**
     * Country of the selling entity whose tax rules price every offer (ADR-072). Rules for other
     * countries can be prepared in the admin console; only this country's apply.
     */
    TAX_SELLER_COUNTRY: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default('NG'),

    /** Service token for /v1/internal routes (the worker). Unset: internal routes answer 404. */
    INTERNAL_API_TOKEN: z.string().min(32).optional(),
    /** Deals and destination prices older than this are never shown (ADR-011). */
    DEALS_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    /** Departure dates searched per deal route, in days from today at the origin. */
    DEALS_DEPARTURE_OFFSETS_DAYS: csv(
      z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(330)),
    ).default([21, 45]),
    /** Check-in date of the hotel search behind "from" prices, in days from today. */
    DESTINATIONS_CHECK_IN_OFFSET_DAYS: z.coerce.number().int().min(1).max(330).default(30),
    /** Deal and destination snapshots are kept this long for price history, then pruned. */
    SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    /** Fare history behind route facts (ADR-080); a year and a month covers every month. */
    ROUTE_FARE_RETENTION_DAYS: z.coerce.number().int().min(30).max(800).default(400),
    /** Route facts show only with at least this many days of fares in the last 90. */
    ROUTE_FACTS_MIN_DAYS: z.coerce.number().int().min(1).max(30).default(3),
    /** Cloudflare Turnstile secret; unset outside production means the mock verifier. */
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),

    /**
     * Hosted-checkout providers in preference order (ADR-016). The checkout offers those that
     * settle the booking's currency; the first is the default.
     */
    PAYMENT_PROVIDERS: csv(z.enum(['mock', 'paystack', 'flutterwave', 'stripe'])).default(['mock']),
    /**
     * Enabled providers that take no new payments, for an outage (docs/runbooks): their webhooks,
     * reconciliation and refunds keep working, which removing them from PAYMENT_PROVIDERS breaks.
     */
    PAYMENT_PROVIDERS_PAUSED: csv(z.enum(['mock', 'paystack', 'flutterwave', 'stripe'])).default(
      [],
    ),
    PAYSTACK_SECRET_KEY: z.string().min(16).optional(),
    PAYSTACK_API_URL: z.url().default('https://api.paystack.co'),
    FLUTTERWAVE_SECRET_KEY: z.string().min(16).optional(),
    /** The "secret hash" set on the Flutterwave dashboard, sent back in `verif-hash`. */
    FLUTTERWAVE_WEBHOOK_HASH: z.string().min(16).optional(),
    FLUTTERWAVE_API_URL: z.url().default('https://api.flutterwave.com'),
    STRIPE_SECRET_KEY: z.string().min(16).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(16).optional(),
    STRIPE_API_URL: z.url().default('https://api.stripe.com'),
    /** Timeout of one call to a payment provider's API. */
    PAYMENT_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
    /** How long a hosted checkout session stays payable. */
    PAYMENT_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
    /** Pending payments older than this are verified with the provider (lost webhooks). */
    PAYMENT_RECONCILE_AFTER_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    /** Holds and installments (ADR-018); fees and the default policy are owner decisions. */
    HOLD_MIN_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(6),
    HOLD_SAFETY_MARGIN_MINUTES: z.coerce.number().int().min(15).max(1440).default(120),
    HOLD_MAX_ACTIVE: z.coerce.number().int().min(1).max(20).default(2),
    INSTALLMENT_DEPOSIT_BPS: z.coerce.number().int().min(500).max(9000).default(3000),
    INSTALLMENT_MAX_COUNT: z.coerce.number().int().min(1).max(12).default(3),
    INSTALLMENT_MIN_SPACING_HOURS: z.coerce.number().int().min(1).max(720).default(24),
    INSTALLMENT_FEE_BPS: z.coerce.number().int().min(0).max(2000).default(0),
    INSTALLMENT_DEFAULT_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
    INSTALLMENT_GRACE_HOURS: z.coerce.number().int().min(0).max(168).default(24),
    /** Packages on a payment plan are paid in full this many days before departure (ADR-028). */
    PACKAGE_BALANCE_DUE_DAYS: z.coerce.number().int().min(1).max(120).default(30),

    /** Visa documents (ADR-026): `mock` only outside production unless ALLOW_MOCK_PROVIDERS. */
    ANTIVIRUS_PROVIDER: z.enum(['clamav', 'mock']).default('mock'),
    CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    VISA_DOCUMENT_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(100_000)
      .max(20_000_000)
      .default(10_000_000),
    /** Signed document links stay valid this long. */
    VISA_DOCUMENT_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    /** Documents are deleted this many days after the application closes. */
    VISA_DOCUMENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),

    /**
     * Cars (ADR-049): each product is on outside production and off in production unless set.
     * A disabled product's routes answer 404 and clients hide its entry points.
     */
    CARS_BUSES_ENABLED: booleanish.optional(),
    CARS_RIDES_ENABLED: booleanish.optional(),
    CARS_RENTALS_ENABLED: booleanish.optional(),
    /** Widens the service area from Nigeria to West Africa (ADR-053). */
    CARS_WEST_AFRICA_ENABLED: booleanish.default(false),
    /** Cars features (task P9), each defaulting like the products. */
    CARS_BUNDLES_ENABLED: booleanish.optional(),
    CARS_PRICE_BREAKDOWN_ENABLED: booleanish.optional(),
    CARS_SAFETY_SUITE_ENABLED: booleanish.optional(),
    CARS_OFFLINE_QR_ENABLED: booleanish.optional(),
    CARS_DEPARTURE_PLANNER_ENABLED: booleanish.optional(),
    /**
     * Ed25519 key that signs bus ticket QR codes (base64 of the PKCS#8 PEM). Unset outside
     * production means a per-process key; previous public keys (base64 SPKI PEMs, `|`-separated)
     * keep verifying tickets issued before a rotation.
     */
    CARS_TICKET_SIGNING_KEY: z.string().min(1).optional(),
    CARS_TICKET_PREVIOUS_PUBLIC_KEYS: z.string().optional(),
    /** VAT on Cars fares in basis points: a placeholder until the owner confirms tax rules. */
    CARS_VAT_BPS: z.coerce.number().int().min(0).max(5000).default(0),
    /** Bus seat holds (ADR-051). */
    BUS_SEAT_HOLD_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
    BUS_MAX_ACTIVE_HOLDS: z.coerce.number().int().min(1).max(10).default(2),
    /** Routing and geocoding (ADR-053): `mock` only outside production unless ALLOW_MOCK_PROVIDERS. */
    MAPS_PROVIDER: z.enum(['mock', 'osrm']).default('mock'),
    OSRM_URL: z.url().optional(),
    MAPS_TIMEOUT_MS: z.coerce.number().int().min(500).max(20_000).default(3000),
    /**
     * AI trip search (ADR-061): on outside production, off in production unless set. `mock` only
     * outside production unless ALLOW_MOCK_PROVIDERS; `anthropic` needs LLM_API_KEY.
     */
    AI_SEARCH_ENABLED: booleanish.optional(),
    LLM_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    LLM_API_KEY: z.string().min(1).optional(),
    LLM_MODEL: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{2,63}$/)
      .default('claude-haiku-5-5'),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8000),
    /** Prices in micro-dollars per million tokens; the defaults are Claude Haiku 5.5's. */
    LLM_INPUT_MICROUSD_PER_MTOK: z.coerce.number().int().min(0).default(100_000),
    LLM_OUTPUT_MICROUSD_PER_MTOK: z.coerce.number().int().min(0).default(500_000),
    LLM_CACHE_READ_MICROUSD_PER_MTOK: z.coerce.number().int().min(0).default(10_000),
    LLM_CACHE_WRITE_MICROUSD_PER_MTOK: z.coerce.number().int().min(0).default(125_000),
    /** Daily spend caps in micro-dollars: per user or guest, and for everyone together. */
    AI_SEARCH_USER_DAILY_MICROUSD: z.coerce.number().int().min(0).default(50_000),
    AI_SEARCH_GLOBAL_DAILY_MICROUSD: z.coerce.number().int().min(0).default(20_000_000),
    /**
     * Partner offers and affiliate tracking (ADR-069, ADR-070): on outside production, off in
     * production unless set. The mock network and mock activities only outside production unless
     * ALLOW_MOCK_PROVIDERS.
     */
    PARTNER_OFFERS_ENABLED: booleanish.optional(),
    AFFILIATE_NETWORK: z.enum(['mock', 'travelpayouts']).default('mock'),
    TRAVELPAYOUTS_API_URL: z.url().default('https://api.travelpayouts.com'),
    /** Travelpayouts API token (Partner Links API). */
    TRAVELPAYOUTS_TOKEN: z.string().min(1).optional(),
    /** The account's partner marker and the project id (`trs`), from the dashboard. */
    TRAVELPAYOUTS_MARKER: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,40}$/)
      .optional(),
    TRAVELPAYOUTS_TRS: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,40}$/)
      .optional(),
    /** Shared secret in the postback URL set in the network dashboard (`?token=`). */
    TRAVELPAYOUTS_POSTBACK_SECRET: z.string().min(24).optional(),
    /** Tours and activities with prices (Viator Partner API, Basic Access). */
    ACTIVITY_PARTNER: z.enum(['mock', 'viator']).default('mock'),
    VIATOR_API_URL: z.url().default('https://api.viator.com/partner'),
    VIATOR_API_KEY: z.string().min(1).optional(),
    /** Tags Viator's returned product links, to match Viator's campaign reports. */
    VIATOR_CAMPAIGN: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,40}$/)
      .default('suskii'),
    PARTNER_TIMEOUT_MS: z.coerce.number().int().min(500).max(20_000).default(5000),
    /** How long an offer link stays valid after it was shown. */
    PARTNER_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    /**
     * Server-side ad conversions (ADR-079): `meta` (Conversions API) and `tiktok` (Events API)
     * send the Purchase events of bookings whose recorded consent allows marketing; `mock` keeps
     * them in memory (tests and local runs; production refuses it unless ALLOW_MOCK_PROVIDERS).
     * Empty keeps no attribution and sends nothing.
     */
    AD_CONVERSIONS: csv(z.enum(['mock', 'meta', 'tiktok'])).default([]),
    /** Meta pixel (dataset) id and a Conversions API access token from Events Manager. */
    META_PIXEL_ID: z
      .string()
      .regex(/^\d{6,20}$/)
      .optional(),
    META_CAPI_ACCESS_TOKEN: z.string().min(20).optional(),
    META_GRAPH_API_URL: z.url().default('https://graph.facebook.com/v24.0'),
    /** Sends to Events Manager's Test Events tab instead of the live data set, when set. */
    META_TEST_EVENT_CODE: z
      .string()
      .regex(/^[A-Za-z0-9]{3,32}$/)
      .optional(),
    /** TikTok pixel code and an Events API access token from Events Manager. */
    TIKTOK_PIXEL_ID: z
      .string()
      .regex(/^[A-Z0-9]{8,32}$/)
      .optional(),
    TIKTOK_EVENTS_ACCESS_TOKEN: z.string().min(20).optional(),
    TIKTOK_EVENTS_API_URL: z.url().default('https://business-api.tiktok.com/open_api/v1.3'),
    TIKTOK_TEST_EVENT_CODE: z
      .string()
      .regex(/^[A-Za-z0-9]{3,32}$/)
      .optional(),
    AD_CONVERSIONS_TIMEOUT_MS: z.coerce.number().int().min(500).max(20_000).default(5000),
    /** Driver identity checks and payouts: mock adapters until the owner picks providers. */
    KYC_PROVIDER: z.enum(['mock']).default('mock'),
    PAYOUT_PROVIDER: z.enum(['mock']).default('mock'),
    /** Rides (ADR-051 to ADR-053). */
    RIDE_SURGE_CAP_BPS: z.coerce.number().int().min(0).max(20_000).default(5000),
    RIDE_MATCH_RADIUS_METRES: z.coerce.number().int().min(500).max(30_000).default(5000),
    RIDE_OFFER_SECONDS: z.coerce.number().int().min(5).max(120).default(15),
    /** A ride still unmatched after this long ends as `no_driver` and is refunded in full. */
    RIDE_MATCH_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    /** Scheduled rides start matching this long before pickup; they can be booked this far ahead. */
    RIDE_SCHEDULE_LEAD_MINUTES: z.coerce.number().int().min(5).max(120).default(15),
    RIDE_SCHEDULE_MAX_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    /** Drivers whose last position is older than this are not offered rides. */
    RIDE_LOCATION_FRESH_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
    RIDE_DEVIATION_METRES: z.coerce.number().int().min(100).max(10_000).default(500),
    RIDE_DEVIATION_SECONDS: z.coerce.number().int().min(30).max(1800).default(120),
    /** Longest trip quoted from the straight-line fallback, and longest intrastate trip. */
    RIDE_FALLBACK_MAX_KM: z.coerce.number().int().min(5).max(500).default(80),
    RIDE_MAX_KM: z.coerce.number().int().min(5).max(1000).default(150),
    RIDE_PING_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(90),
    /** Rentals (ADR-051): turnaround between rentals, photo dispute window, delivery estimate. */
    RENTAL_TURNAROUND_HOURS: z.coerce.number().int().min(0).max(48).default(3),
    RENTAL_PHOTO_RETENTION_DAYS: z.coerce.number().int().min(30).max(730).default(180),
    RENTAL_MIN_LEAD_HOURS: z.coerce.number().int().min(0).max(72).default(2),
    RENTAL_MAX_ADVANCE_DAYS: z.coerce.number().int().min(1).max(365).default(180),
    /** Driver balances below this (NGN minor units) wait for the next payout run. */
    DRIVER_PAYOUT_MIN_MINOR: z.coerce.number().int().min(0).default(100_000),
    /** Price alerts (ADR-032): how often each is checked and the drop worth a notice. */
    PRICE_ALERT_INTERVAL_HOURS: z.coerce.number().int().min(1).max(48).default(6),
    PRICE_ALERT_MIN_DROP_BPS: z.coerce.number().int().min(100).max(9000).default(500),
    /** Alerts checked per worker run (each distinct route and date costs one supplier search). */
    PRICE_ALERT_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    /**
     * Ticketed flights are asked for airline schedule changes this often until they depart, at
     * most SCHEDULE_CHANGE_BATCH_SIZE per sweep (one supplier call each, ADR-065).
     */
    SCHEDULE_CHANGE_CHECK_HOURS: z.coerce.number().int().min(1).max(48).default(6),
    SCHEDULE_CHANGE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    /**
     * A change moving a flight by this many hours (within one country, or otherwise) entitles the
     * traveller to a full refund (ADR-073; the US DOT thresholds).
     */
    SIGNIFICANT_CHANGE_DOMESTIC_HOURS: z.coerce.number().min(1).max(24).default(3),
    SIGNIFICANT_CHANGE_INTERNATIONAL_HOURS: z.coerce.number().min(1).max(24).default(6),
    /** Prime members are reminded this many days before their paid-up end (ADR-030). */
    PRIME_REMINDER_DAYS: z.coerce.number().int().min(1).max(60).default(7),
    /** A finished trip can be reviewed for this many days after it ends (ADR-077). */
    REVIEW_WINDOW_DAYS: z.coerce.number().int().min(7).max(365).default(90),
    /**
     * Referral rewards (ADR-031), in minor units of REFERRAL_REWARD_CURRENCY; zero pays nothing
     * (referrals are still tracked). A referral qualifies on a completed trip of at least
     * REFERRAL_MIN_SPEND_MINOR; at most REFERRAL_MONTHLY_CAP qualify per referrer per month.
     */
    REFERRAL_REWARD_REFERRER_MINOR: z.coerce.number().int().min(0).max(100_000_000).default(0),
    REFERRAL_REWARD_REFEREE_MINOR: z.coerce.number().int().min(0).max(100_000_000).default(0),
    REFERRAL_REWARD_CURRENCY: z.string().length(3).default('NGN'),
    REFERRAL_MIN_SPEND_MINOR: z.coerce.number().int().min(0).default(0),
    REFERRAL_MONTHLY_CAP: z.coerce.number().int().min(1).max(1000).default(10),
    /**
     * Retained financial records (bookings, payments, ledger, refunds) of deleted accounts are
     * kept this long (ADR-029); a legal decision for the owner. The purge job is phase 11.
     */
    FINANCIAL_RECORDS_RETENTION_YEARS: z.coerce.number().int().min(1).max(20).default(7),

    /**
     * Staff refunds worth more than this (NGN minor units) need a second approver (ADR-019).
     * 0 means every staff refund needs one.
     */
    REFUND_APPROVAL_THRESHOLD_NGN: z.coerce.number().int().min(0).default(0),
    /**
     * Payment risk review (ADR-040): signals scored at capture; at or above the score, fulfilment
     * waits for staff. Limits count the last 24 hours (cards: 30 days).
     */
    PAYMENT_RISK_ENABLED: booleanish.default(true),
    PAYMENT_RISK_REVIEW_SCORE: z.coerce.number().int().min(1).max(1000).default(60),
    PAYMENT_RISK_MAX_PAYMENTS_PER_DAY: z.coerce.number().int().min(1).max(100).default(5),
    PAYMENT_RISK_MAX_ATTEMPTS_PER_IP: z.coerce.number().int().min(1).max(500).default(10),
    PAYMENT_RISK_MAX_CARDS: z.coerce.number().int().min(1).max(50).default(3),
    /** ISO country codes and IATA airport pairs (`LOS-LHR`) that add to the score. */
    PAYMENT_RISK_COUNTRIES: csv(z.string().regex(/^[A-Z]{2}$/)).default([]),
    PAYMENT_RISK_ROUTES: csv(z.string().regex(/^[A-Z]{3}-[A-Z]{3}$/)).default([]),
    /**
     * Request header carrying the client's country as set by the edge (e.g. `cf-ipcountry`
     * behind Cloudflare). Only set it when the edge overwrites the header on every request.
     */
    CLIENT_COUNTRY_HEADER: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/)
      .optional(),
    /** Refunds still pending at a provider without a lookup API go to review after this. */
    REFUND_REVIEW_AFTER_HOURS: z.coerce.number().int().min(1).max(720).default(72),
    /** Operations mailbox for money alerts (automatic refunds, failures, reviews). */
    OPS_ALERT_EMAIL: z.email().optional(),
    /** Booking with a supplier can take far longer than a search or a re-price. */
    SUPPLIER_BOOKING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(45_000),
    /** Automatic ticketing attempts before a paid booking goes to REFUND_PENDING. */
    TICKETING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(6),
    /**
     * Tickets, vouchers and uploaded documents. `filesystem` is for development and tests; `s3`
     * is any S3-compatible store: AWS S3, Google Cloud Storage (HMAC keys), Cloudflare R2 or
     * MinIO (ADR-057).
     */
    OBJECT_STORAGE: z.enum(['filesystem', 's3']).default('filesystem'),
    OBJECT_STORAGE_DIR: z.string().min(1).default('.data/objects'),
    /** e.g. https://storage.googleapis.com, https://s3.eu-west-1.amazonaws.com. */
    OBJECT_STORAGE_ENDPOINT: z.url().optional(),
    /** The bucket's region for AWS; `auto` for Google Cloud Storage and R2. */
    OBJECT_STORAGE_REGION: z
      .string()
      .regex(/^[a-z0-9-]{2,32}$/)
      .default('auto'),
    OBJECT_STORAGE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .optional(),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Path-style URLs (endpoint/bucket/key), which MinIO needs; virtual-hosted otherwise. */
    OBJECT_STORAGE_PATH_STYLE: booleanish.default(false),
    OBJECT_STORAGE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    /** Production only: a plain http endpoint on a private, otherwise encrypted network. */
    OBJECT_STORAGE_ALLOW_PLAINTEXT: booleanish.default(false),
    /**
     * Mock flight supplier only: basis points added when re-pricing chosen outbound routes, e.g.
     * `LOS-DXB:500`, so tests can walk through the price-change consent path. Each rule applies
     * once, at the re-price right before payment.
     */
    MOCK_REPRICE_RULES: csv(
      z
        .string()
        .regex(/^[A-Z]{3}-[A-Z]{3}:-?\d{1,5}$/, 'use ORIGIN-DESTINATION:basisPoints')
        .transform((rule) => {
          const [route = '', bps = '0'] = rule.split(':');
          return [route, Number(bps)] as const;
        }),
    )
      .transform((rules) => new Map(rules))
      .default(new Map()),
    /**
     * Mock flight supplier only: minutes the airline moves the first flight of ticketed orders
     * on chosen outbound routes, e.g. `LOS-ABV:90`, so the schedule-change journey can be walked
     * through locally (ADR-065).
     */
    MOCK_SCHEDULE_CHANGE_RULES: csv(
      z
        .string()
        .regex(/^[A-Z]{3}-[A-Z]{3}:-?\d{1,4}$/, 'use ORIGIN-DESTINATION:minutes')
        .transform((rule) => {
          const [route = '', minutes = '0'] = rule.split(':');
          return [route, Number(minutes)] as const;
        }),
    )
      .transform((rules) => new Map(rules))
      .default(new Map()),
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [key], message });
    };
    const previousKeyIds = env.FIELD_ENCRYPTION_PREVIOUS_KEYS.map((entry) => entry.split(':')[0]);
    if (
      new Set(previousKeyIds).size !== previousKeyIds.length ||
      previousKeyIds.includes(env.FIELD_ENCRYPTION_KEY_ID)
    ) {
      require('FIELD_ENCRYPTION_PREVIOUS_KEYS', 'key ids must be unique and differ from FIELD_ENCRYPTION_KEY_ID');
    }
    if (env.CLIENT_IP_HEADER && env.TRUST_PROXY_HOPS > 0)
      require('CLIENT_IP_HEADER', 'set either CLIENT_IP_HEADER or TRUST_PROXY_HOPS, not both');
    if (
      (env.FLIGHT_SUPPLIERS.includes('duffel') || env.HOTEL_SUPPLIERS.includes('duffel')) &&
      !env.DUFFEL_API_TOKEN
    ) {
      require('DUFFEL_API_TOKEN', 'is required when FLIGHT_SUPPLIERS or HOTEL_SUPPLIERS includes duffel');
    }
    if (env.HOTEL_SUPPLIERS.includes('hotelbeds')) {
      if (!env.HOTELBEDS_API_KEY)
        require('HOTELBEDS_API_KEY', 'is required when HOTEL_SUPPLIERS includes hotelbeds');
      if (!env.HOTELBEDS_API_SECRET)
        require('HOTELBEDS_API_SECRET', 'is required when HOTEL_SUPPLIERS includes hotelbeds');
    }
    if (env.MAPS_PROVIDER === 'osrm' && !env.OSRM_URL)
      require('OSRM_URL', 'is required when MAPS_PROVIDER is osrm');
    if (env.LLM_PROVIDER === 'anthropic' && !env.LLM_API_KEY)
      require('LLM_API_KEY', 'is required when LLM_PROVIDER is anthropic');
    if (env.FLIGHT_SUPPLIERS.length === 0)
      require('FLIGHT_SUPPLIERS', 'enable at least one supplier');
    if (env.HOTEL_SUPPLIERS.length === 0)
      require('HOTEL_SUPPLIERS', 'enable at least one supplier');
    if (env.SUPPLIER_TIMEOUT_MS > env.SEARCH_TIMEOUT_MS) {
      require('SUPPLIER_TIMEOUT_MS', 'must not exceed SEARCH_TIMEOUT_MS');
    }
    if (env.DEALS_DEPARTURE_OFFSETS_DAYS.length === 0)
      require('DEALS_DEPARTURE_OFFSETS_DAYS', 'list at least one offset');
    if (env.PAYMENT_PROVIDERS.length === 0)
      require('PAYMENT_PROVIDERS', 'enable at least one payment provider');
    if (new Set(env.PAYMENT_PROVIDERS).size !== env.PAYMENT_PROVIDERS.length)
      require('PAYMENT_PROVIDERS', 'list each provider once');
    if (env.PAYMENT_PROVIDERS_PAUSED.some((name) => !env.PAYMENT_PROVIDERS.includes(name)))
      require('PAYMENT_PROVIDERS_PAUSED', 'may only name providers in PAYMENT_PROVIDERS');
    if (env.PAYMENT_PROVIDERS.includes('paystack') && !env.PAYSTACK_SECRET_KEY)
      require('PAYSTACK_SECRET_KEY', 'is required when PAYMENT_PROVIDERS includes paystack');
    if (env.PAYMENT_PROVIDERS.includes('flutterwave')) {
      if (!env.FLUTTERWAVE_SECRET_KEY)
        require('FLUTTERWAVE_SECRET_KEY', 'is required when PAYMENT_PROVIDERS includes flutterwave');
      if (!env.FLUTTERWAVE_WEBHOOK_HASH)
        require('FLUTTERWAVE_WEBHOOK_HASH', 'is required when PAYMENT_PROVIDERS includes flutterwave');
    }
    if (env.PAYMENT_PROVIDERS.includes('stripe')) {
      if (!env.STRIPE_SECRET_KEY)
        require('STRIPE_SECRET_KEY', 'is required when PAYMENT_PROVIDERS includes stripe');
      if (!env.STRIPE_WEBHOOK_SECRET)
        require('STRIPE_WEBHOOK_SECRET', 'is required when PAYMENT_PROVIDERS includes stripe');
    }
    if (env.AFFILIATE_NETWORK === 'travelpayouts') {
      for (const key of ['TRAVELPAYOUTS_TOKEN', 'TRAVELPAYOUTS_MARKER'] as const) {
        if (!env[key]) require(key, 'is required when AFFILIATE_NETWORK is travelpayouts');
      }
    }
    if (env.ACTIVITY_PARTNER === 'viator' && !env.VIATOR_API_KEY)
      require('VIATOR_API_KEY', 'is required when ACTIVITY_PARTNER is viator');
    if (env.AD_CONVERSIONS.includes('meta')) {
      for (const key of ['META_PIXEL_ID', 'META_CAPI_ACCESS_TOKEN'] as const) {
        if (!env[key]) require(key, 'is required when AD_CONVERSIONS includes meta');
      }
    }
    if (env.AD_CONVERSIONS.includes('tiktok')) {
      for (const key of ['TIKTOK_PIXEL_ID', 'TIKTOK_EVENTS_ACCESS_TOKEN'] as const) {
        if (!env[key]) require(key, 'is required when AD_CONVERSIONS includes tiktok');
      }
    }
    if (env.OBJECT_STORAGE === 's3') {
      for (const key of [
        'OBJECT_STORAGE_ENDPOINT',
        'OBJECT_STORAGE_BUCKET',
        'OBJECT_STORAGE_ACCESS_KEY_ID',
        'OBJECT_STORAGE_SECRET_ACCESS_KEY',
      ] as const) {
        if (!env[key]) require(key, 'is required when OBJECT_STORAGE is s3');
      }
    }
    if (env.NODE_ENV !== 'production') return;
    if (!env.INTERNAL_API_TOKEN) require('INTERNAL_API_TOKEN', 'is required in production');
    else if (env.INTERNAL_API_TOKEN.startsWith(LOCAL_INTERNAL_TOKEN_PREFIX))
      require('INTERNAL_API_TOKEN', 'the local development token is not allowed in production');
    if (!env.TURNSTILE_SECRET_KEY) require('TURNSTILE_SECRET_KEY', 'is required in production');
    if (env.SOCIAL_MOCK_ENABLED)
      require('SOCIAL_MOCK_ENABLED', 'is never allowed in production: it signs anyone in as any email');
    if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY)
      require('JWT_PRIVATE_KEY', 'signing keys are required in production');
    if (!env.FIELD_ENCRYPTION_KEY) require('FIELD_ENCRYPTION_KEY', 'is required in production');
    if (!env.DATABASE_ALLOW_PLAINTEXT && !requiresTls(env.DATABASE_URL))
      require('DATABASE_URL', 'must use TLS in production (sslmode=verify-full); DATABASE_ALLOW_PLAINTEXT is only for a socket or local proxy');
    if (!env.REDIS_ALLOW_PLAINTEXT && !env.REDIS_URL.startsWith('rediss://'))
      require('REDIS_URL', 'must use TLS in production (rediss://); REDIS_ALLOW_PLAINTEXT is only for a socket or local proxy');
    if (!env.HMAC_SECRET) require('HMAC_SECRET', 'is required in production');
    if (!env.COOKIE_SECURE) require('COOKIE_SECURE', 'must be true in production');
    if (env.CORS_ORIGINS.length === 0)
      require('CORS_ORIGINS', 'must list the web and admin origins in production');
    if (env.ADMIN_ORIGINS.some((origin) => !origin.startsWith('https://')))
      require('ADMIN_ORIGINS', 'must list the https admin console origins in production');
    else if (env.ADMIN_ORIGINS.some((origin) => !env.CORS_ORIGINS.map(originOf).includes(origin)))
      require('ADMIN_ORIGINS', 'every admin origin must also be in CORS_ORIGINS');
    if (!env.ALLOW_MOCK_PROVIDERS && env.EMAIL_PROVIDER === 'mock')
      require('EMAIL_PROVIDER', 'mock provider is not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.SMS_PROVIDER === 'mock')
      require('SMS_PROVIDER', 'mock provider is not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.WHATSAPP_PROVIDER === 'mock')
      require('WHATSAPP_PROVIDER', 'mock provider is not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.PUSH_PROVIDER === 'mock')
      require('PUSH_PROVIDER', 'mock provider is not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.DEVICE_ATTESTATION === 'mock')
      require('DEVICE_ATTESTATION', 'mock attestation is not allowed in production');
    if (!env.EXPO_PUSH_URL.startsWith('https://'))
      require('EXPO_PUSH_URL', 'must use https in production');
    // Never show fabricated fares or exchange rates in production (brand guardrails).
    if (!env.ALLOW_MOCK_PROVIDERS && env.FLIGHT_SUPPLIERS.includes('mock'))
      require('FLIGHT_SUPPLIERS', 'the mock supplier is not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.HOTEL_SUPPLIERS.includes('mock'))
      require('HOTEL_SUPPLIERS', 'the mock supplier is not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.FX_PROVIDER === 'mock')
      require('FX_PROVIDER', 'mock exchange rates are not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.PAYMENT_PROVIDERS.includes('mock'))
      require('PAYMENT_PROVIDERS', 'mock payments are not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.ANTIVIRUS_PROVIDER === 'mock')
      require('ANTIVIRUS_PROVIDER', 'uploaded documents must be scanned by a real scanner');
    if (!env.ALLOW_MOCK_PROVIDERS && env.AD_CONVERSIONS.includes('mock'))
      require('AD_CONVERSIONS', 'the mock sends nothing to any network; it is not allowed in production');
    // Real providers must be called over TLS with their production hosts' defaults or overrides.
    for (const key of [
      'PAYSTACK_API_URL',
      'FLUTTERWAVE_API_URL',
      'STRIPE_API_URL',
      'DUFFEL_API_URL',
      'HOTELBEDS_API_URL',
      'TRAVELPAYOUTS_API_URL',
      'VIATOR_API_URL',
      'META_GRAPH_API_URL',
      'TIKTOK_EVENTS_API_URL',
    ] as const) {
      if (!env[key].startsWith('https://')) require(key, 'must use https in production');
    }
    // The evaluation host confirms bookings that do not exist: travellers would pay for nothing.
    if (
      env.HOTEL_SUPPLIERS.includes('hotelbeds') &&
      !env.ALLOW_MOCK_PROVIDERS &&
      new URL(env.HOTELBEDS_API_URL).hostname === 'api.test.hotelbeds.com'
    )
      require('HOTELBEDS_API_URL', 'the evaluation host books nothing; use https://api.hotelbeds.com in production');
    // Telemetry may go to a collector on the same host; anywhere else it needs TLS.
    if (env.OTEL_EXPORTER_OTLP_ENDPOINT && !isTlsOrLoopback(env.OTEL_EXPORTER_OTLP_ENDPOINT))
      require('OTEL_EXPORTER_OTLP_ENDPOINT', 'must use https in production unless the collector is on localhost');
    if (!env.ALLOW_MOCK_PROVIDERS && env.OBJECT_STORAGE === 'filesystem')
      require('OBJECT_STORAGE', 'filesystem storage is not allowed in production');
    if (
      env.OBJECT_STORAGE === 's3' &&
      !env.OBJECT_STORAGE_ALLOW_PLAINTEXT &&
      !env.OBJECT_STORAGE_ENDPOINT?.startsWith('https://')
    )
      require('OBJECT_STORAGE_ENDPOINT', 'must use https in production; OBJECT_STORAGE_ALLOW_PLAINTEXT is only for a private network');
    // AI trip search is off in production unless set (ADR-061); when on it needs a real model.
    if (env.AI_SEARCH_ENABLED && !env.ALLOW_MOCK_PROVIDERS && env.LLM_PROVIDER === 'mock')
      require('LLM_PROVIDER', 'the mock model is not allowed in production');
    // Partner offers are off in production unless set (ADR-070); when on they need real partners.
    if (env.PARTNER_OFFERS_ENABLED && !env.ALLOW_MOCK_PROVIDERS) {
      if (env.AFFILIATE_NETWORK === 'mock')
        require('AFFILIATE_NETWORK', 'the mock network earns nothing; it is not allowed in production');
      if (env.ACTIVITY_PARTNER === 'mock')
        require('ACTIVITY_PARTNER', 'mock activities are not allowed in production');
    }
    if (env.AFFILIATE_NETWORK === 'travelpayouts' && !env.TRAVELPAYOUTS_POSTBACK_SECRET)
      require('TRAVELPAYOUTS_POSTBACK_SECRET', 'is required in production: conversions are recorded from postbacks');
    // Cars products are off in production unless set; enabled ones need their real providers.
    if (env.CARS_BUSES_ENABLED && !env.CARS_TICKET_SIGNING_KEY)
      require('CARS_TICKET_SIGNING_KEY', 'is required in production when buses are enabled');
    if (env.CARS_RIDES_ENABLED && !env.ALLOW_MOCK_PROVIDERS) {
      if (env.MAPS_PROVIDER === 'mock')
        require('MAPS_PROVIDER', 'mock routing is not allowed in production');
      if (env.KYC_PROVIDER === 'mock')
        require('KYC_PROVIDER', 'driver checks need a real KYC provider in production');
      if (env.PAYOUT_PROVIDER === 'mock')
        require('PAYOUT_PROVIDER', 'driver payouts need a real provider in production');
    }
    if (env.MAPS_PROVIDER === 'osrm' && env.OSRM_URL && !env.OSRM_URL.startsWith('https://'))
      require('OSRM_URL', 'must use https in production');
  });

export type Env = z.output<typeof envSchema>;

/** Parses the environment, failing fast with key names and rules only (never values). */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  // `KEY=` in a .env file means "not set" (the .env.example convention for unset secrets).
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid API environment: ${issues}`);
  }
  return result.data;
}
