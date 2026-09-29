import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTPayload,
} from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { SOCIAL_KEY_RESOLVERS, type SocialKeyResolvers } from '../../src/auth/social.service';
import { BackgroundTasks } from '../../src/common/background-tasks';
import type { AppConfig } from '../../src/config/config';
import { parseEnv } from '../../src/config/env.schema';
import { BreachedPasswordChecker } from '../../src/crypto/breached-password';
import { PrismaService } from '../../src/infra/prisma.service';
import { REDIS } from '../../src/infra/redis';
import { EmailProvider, type MockEmailProvider } from '../../src/notifications/email';
import { SmsProvider, type MockSmsProvider } from '../../src/notifications/sms';

export const WEB_ORIGIN = 'https://web.suskii.test';
export const GOOGLE_CLIENT_ID = 'google-client-id.apps.googleusercontent.com';
export const APPLE_CLIENT_ID = 'com.suskii.travels';
/** Service token for /v1/internal routes in tests. */
export const E2E_INTERNAL_TOKEN = 'e2e-internal-token-0123456789abcdefghij';
/** Passwords the fake breach checker reports as compromised. */
export const BREACHED_PASSWORD = 'password1234';

export interface SocialSigner {
  sign(
    provider: 'google' | 'apple',
    claims: JWTPayload & { sub: string },
    audience?: string,
  ): Promise<string>;
}

export interface TestContext {
  app: NestExpressApplication;
  http: () => ReturnType<typeof request>;
  config: AppConfig;
  prisma: PrismaService;
  redis: Redis;
  emails: MockEmailProvider;
  sms: MockSmsProvider;
  background: BackgroundTasks;
  social: SocialSigner;
  close: () => Promise<void>;
}

async function localSocialKeys(): Promise<{ resolvers: SocialKeyResolvers; signer: SocialSigner }> {
  const pairs = {
    google: await generateKeyPair('RS256', { extractable: true }),
    apple: await generateKeyPair('RS256', { extractable: true }),
  };
  const jwks = async (key: CryptoKey, kid: string) =>
    createLocalJWKSet({ keys: [{ ...(await exportJWK(key)), kid, alg: 'RS256' }] });
  const resolvers: SocialKeyResolvers = {
    google: await jwks(pairs.google.publicKey, 'google-test'),
    apple: await jwks(pairs.apple.publicKey, 'apple-test'),
  };
  const issuer = { google: 'https://accounts.google.com', apple: 'https://appleid.apple.com' };
  const defaultAudience = { google: GOOGLE_CLIENT_ID, apple: APPLE_CLIENT_ID };
  return {
    resolvers,
    signer: {
      sign: (provider, claims, audience) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid: `${provider}-test` })
          .setIssuer(issuer[provider])
          .setAudience(audience ?? defaultAudience[provider])
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(pairs[provider].privateKey),
    },
  };
}

/** Boots the full application exactly as main.ts does, with mock providers at the edges. */
export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  options: {
    controllers?: Type[];
    /** Provider overrides, e.g. the supplier list for resilience tests. */
    overrides?: (
      | { provide: unknown; useValue: unknown }
      | { provide: unknown; useFactory: (...deps: never[]) => unknown; inject: unknown[] }
    )[];
  } = {},
): Promise<TestContext> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  const redisUrl = process.env.E2E_REDIS_URL;
  if (!databaseUrl || !redisUrl)
    throw new Error('E2E_DATABASE_URL / E2E_REDIS_URL missing (global setup)');

  const config: AppConfig = {
    ...parseEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      EMAIL_PROVIDER: 'mock',
      HIBP_ENABLED: 'false',
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: WEB_ORIGIN,
      WEB_APP_URL: WEB_ORIGIN,
      GOOGLE_CLIENT_IDS: GOOGLE_CLIENT_ID,
      APPLE_CLIENT_IDS: APPLE_CLIENT_ID,
      HMAC_SECRET: 'e2e-hmac-secret-that-is-at-least-32-chars',
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      INTERNAL_API_TOKEN: E2E_INTERNAL_TOKEN,
    }),
    ...overrides,
  };
  const { resolvers, signer } = await localSocialKeys();
  const breached: BreachedPasswordChecker = {
    isBreached: (password: string) => Promise.resolve(password === BREACHED_PASSWORD),
  };

  let builder = Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(BreachedPasswordChecker)
    .useValue(breached)
    .overrideProvider(SOCIAL_KEY_RESOLVERS)
    .useValue(resolvers);
  for (const override of options.overrides ?? []) {
    builder =
      'useValue' in override
        ? builder.overrideProvider(override.provide).useValue(override.useValue)
        : builder.overrideProvider(override.provide).useFactory({
            factory: override.useFactory as (...args: unknown[]) => unknown,
            inject: override.inject as never[],
          });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
    rawBody: true,
  });
  configureApp(app, config);
  await app.init();

  const server = app.getHttpServer() as App;
  return {
    app,
    http: () => request(server),
    config,
    prisma: app.get(PrismaService),
    redis: app.get<Redis>(REDIS),
    emails: app.get<EmailProvider, MockEmailProvider>(EmailProvider),
    sms: app.get<SmsProvider, MockSmsProvider>(SmsProvider),
    background: app.get(BackgroundTasks),
    social: signer,
    close: () => app.close(),
  };
}

/**
 * Empties every table the tests write to and Redis. The audit log is append-only by design, and
 * the seeded reference data (countries, airports, cities, roles) stays.
 */
export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.prisma.$executeRawUnsafe(
    'TRUNCATE TABLE users, idempotency_keys, offers, search_logs, markup_rules, fee_rules, promo_codes, promo_redemptions, deal_snapshots, destination_hotel_snapshots, newsletter_subscriptions, bookings, booking_items, booking_passengers, booking_status_history, travellers, payments, webhook_events, booking_documents, ledger_entries, ledger_transactions, ledger_accounts, payment_plans, installments, refunds, booking_access_links RESTART IDENTITY CASCADE',
  );
  await ctx.redis.flushdb();
  ctx.emails.outbox.length = 0;
  ctx.sms.outbox.length = 0;
}
