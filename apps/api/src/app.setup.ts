import { isIP } from 'node:net';

import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/config';
import { RideRealtimeGateway } from './rides/ride-realtime.gateway';

/** Browser features a JSON API never needs. */
const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

/**
 * Answers compressed at the origin (Brotli or gzip, ADR-075): public search, catalog and content
 * reads, which carry no token or personal data. Keeping compression away from responses that
 * hold a secret next to text a caller chose means response sizes cannot leak the secret (BREACH).
 */
export const COMPRESSED_PATHS = [
  /^\/v1\/flights\/searches(?:\/[^/]+\/offers)?$/,
  /^\/v1\/flights\/offers\/[^/]+$/,
  /^\/v1\/hotels\/searches(?:\/[^/]+\/hotels)?$/,
  /^\/v1\/hotels\/results\/[^/]+$/,
  /^\/v1\/(?:catalog|content)\/.+$/,
  /^\/v1\/(?:deals|destinations)(?:\/.*)?$/,
  /^\/v1\/status$/,
];

export const compressible = (path: string): boolean =>
  COMPRESSED_PATHS.some((rule) => rule.test(path));

export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-CSRF-Token',
  'X-Request-Id',
  'X-Suskii-Client',
  'X-Booking-Token',
  'X-File-Name',
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
  // Client IPs (rate limits, audit, the admin allowlist) come from X-Forwarded-For only through
  // trusted proxy hops, or from the edge's own header when CLIENT_IP_HEADER names one.
  const clientIpHeader = config.CLIENT_IP_HEADER;
  if (clientIpHeader) {
    // The edge overwrites this header on every request and is the only way in, so its value is
    // the client whatever proxies sit between. Anything else in X-Forwarded-For is discarded.
    app.set('trust proxy', 1);
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const value = req.headers[clientIpHeader];
      const address = typeof value === 'string' ? value.trim() : '';
      if (isIP(address)) req.headers['x-forwarded-for'] = address;
      else delete req.headers['x-forwarded-for'];
      next();
    });
  } else {
    app.set('trust proxy', config.TRUST_PROXY_HOPS);
  }

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
  app.use(
    compression({
      // Small answers cost more to compress than they save on the wire.
      threshold: 1024,
      filter: (req, res) => compressible(req.path) && compression.filter(req, res),
    }),
  );
  app.use(cookieParser());
  // Explicit JSON body cap (Nest's default is the same, but it is a security control): larger
  // payloads get 413 before any parsing work. With `rawBody: true` on the application (main.ts,
  // tests), the exact bytes are kept for webhook signature checks. Compressed request bodies are
  // refused with 415 before any decompression: no client or provider sends them, and inflating
  // them is where body-parser 2.3 can be stalled (GHSA-27r3-jxmh-p828, docs/audits/e2e-audit.md).
  app.useBodyParser('json', { limit: '100kb', inflate: false });
  app.useBodyParser('urlencoded', { extended: true, limit: '100kb', inflate: false });

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
  // Live ride updates share the API's port, TLS and load balancer (ADR-052).
  app.get(RideRealtimeGateway, { strict: false }).attach(app.getHttpServer());
  return app;
}
