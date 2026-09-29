import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/config';

/** Browser features a JSON API never needs. */
const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-CSRF-Token',
  'X-Request-Id',
  'X-Suskii-Client',
];
export const CORS_EXPOSED_HEADERS = [
  'X-Request-Id',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'Retry-After',
  'Idempotent-Replayed',
];

/**
 * HTTP-level configuration shared by `main.ts` and the e2e tests, so tests exercise exactly
 * what production serves.
 */
export function configureApp<T extends NestExpressApplication>(app: T, config: AppConfig): T {
  // Client IPs (rate limits, audit) come from X-Forwarded-For only through trusted proxy hops.
  app.set('trust proxy', config.TRUST_PROXY_HOPS);

  app.use(
    helmet({
      // A JSON API renders nothing: forbid every resource type and framing.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
    }),
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cookieParser());
  // Explicit JSON body cap (Nest's default is the same, but it is a security control): larger
  // payloads get 413 before any parsing work.
  app.useBodyParser('json', { limit: '100kb' });

  app.enableCors({
    // Only allowlisted browser origins get CORS headers; server-to-server calls send no Origin.
    origin: (origin, callback) =>
      callback(null, origin === undefined || config.CORS_ORIGINS.includes(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
    maxAge: 600,
  });

  // Public routes live under /v1/...; infra probes are VERSION_NEUTRAL.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  return app;
}
