import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

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

/** Every environment variable the API reads. Values are never echoed in validation errors. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    /** Browser origins allowed to call the API with credentials. */
    CORS_ORIGINS: csv(z.url()).default([]),
    /** Number of trusted reverse proxies (Cloudflare, load balancer) in front of the API. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
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

    /** 32-byte key (base64) for field-level encryption until the KMS adapter lands (phase 12). */
    FIELD_ENCRYPTION_KEY: z.string().min(1).optional(),
    /** Secret for pseudonymising IP addresses in logs and the audit trail. */
    IP_HASH_SECRET: z.string().min(32).optional(),

    HIBP_ENABLED: booleanish.default(true),
    EMAIL_PROVIDER: z.enum(['smtp', 'mock']).default('smtp'),
    EMAIL_FROM: z.string().min(3).default('Suskii Travels <no-reply@localhost>'),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMS_PROVIDER: z.enum(['mock']).default('mock'),
    /** Staging escape hatch: allow mock email/SMS providers when NODE_ENV=production. */
    ALLOW_MOCK_PROVIDERS: booleanish.default(false),

    GOOGLE_CLIENT_IDS: csv(z.string().min(1)).default([]),
    APPLE_CLIENT_IDS: csv(z.string().min(1)).default([]),

    /** Optional IP allowlist for /v1/admin routes (exact IPs). */
    ADMIN_IP_ALLOWLIST: csv(z.string().min(1)).default([]),
    RATE_LIMIT_ENABLED: booleanish.default(true),

    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default('suskii-api'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const require = (key: keyof typeof env, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [key], message });
    };
    if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY)
      require('JWT_PRIVATE_KEY', 'signing keys are required in production');
    if (!env.FIELD_ENCRYPTION_KEY) require('FIELD_ENCRYPTION_KEY', 'is required in production');
    if (!env.IP_HASH_SECRET) require('IP_HASH_SECRET', 'is required in production');
    if (!env.COOKIE_SECURE) require('COOKIE_SECURE', 'must be true in production');
    if (env.CORS_ORIGINS.length === 0)
      require('CORS_ORIGINS', 'must list the web and admin origins in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.EMAIL_PROVIDER === 'mock')
      require('EMAIL_PROVIDER', 'mock provider is not allowed in production');
    if (!env.ALLOW_MOCK_PROVIDERS && env.SMS_PROVIDER === 'mock')
      require('SMS_PROVIDER', 'mock provider is not allowed in production');
  });

export type Env = z.output<typeof envSchema>;

/** Parses the environment, failing fast with key names and rules only (never values). */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid API environment: ${issues}`);
  }
  return result.data;
}
