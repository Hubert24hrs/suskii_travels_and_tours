import { type INestApplication, VersioningType } from '@nestjs/common';

/**
 * Application-wide HTTP configuration shared by `main.ts` and the e2e tests,
 * so tests exercise exactly what production serves.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  // Public routes live under /v1/...; controllers opt out with VERSION_NEUTRAL.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  return app;
}
