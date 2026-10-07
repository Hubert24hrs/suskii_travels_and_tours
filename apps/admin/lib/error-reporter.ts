import { createSentryReporter, type ErrorReporter, type ErrorTags } from '@suskii/shared/lite';

import { publicEnv } from './env';

let reporter: ErrorReporter | undefined;

/**
 * Sends an error to Sentry when NEXT_PUBLIC_SENTRY_DSN is set, and nowhere otherwise (ADR-046).
 * Shared by the server (instrumentation.ts) and the browser, which loads it only after an error.
 */
export function reportError(error: unknown, tags: ErrorTags = {}): Promise<void> {
  if (!publicEnv.sentryDsn) return Promise.resolve();
  reporter ??= createSentryReporter({
    dsn: publicEnv.sentryDsn,
    platform: typeof window === 'undefined' ? 'node' : 'javascript',
    service: 'admin',
    release: publicEnv.sentryRelease || undefined,
    environment: publicEnv.sentryEnvironment,
  });
  return reporter.capture(error, tags);
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** From the browser: tagged with the console path, record ids replaced (ADR-046). */
export function reportBrowserError(error: unknown, tags: ErrorTags = {}): Promise<void> {
  if (error instanceof Error && error.stack?.includes('extension://')) return Promise.resolve();
  return reportError(error, { route: location.pathname.replace(UUID, ':id'), ...tags });
}
