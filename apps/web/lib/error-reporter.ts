import {
  createSentryReporter,
  webVitalsPage,
  type ErrorReporter,
  type ErrorTags,
} from '@suskii/shared/lite';

import { publicEnv } from './env';

let reporter: ErrorReporter | undefined;

/**
 * Sends an error to Sentry when NEXT_PUBLIC_SENTRY_DSN is set, and nowhere otherwise (ADR-046).
 * Shared by the server (instrumentation.ts) and the browser, which loads this module only once
 * an error has happened, so it costs the pages nothing up front.
 */
export function reportError(error: unknown, tags: ErrorTags = {}): Promise<void> {
  if (!publicEnv.sentryDsn) return Promise.resolve();
  reporter ??= createSentryReporter({
    dsn: publicEnv.sentryDsn,
    platform: typeof window === 'undefined' ? 'node' : 'javascript',
    service: 'web',
    release: publicEnv.sentryRelease || undefined,
    environment: publicEnv.sentryEnvironment,
  });
  return reporter.capture(error, tags);
}

/** From the browser: tagged with the page template, never the URL (ids and tokens stay out). */
export function reportBrowserError(error: unknown, tags: ErrorTags = {}): Promise<void> {
  // Browser extensions inject scripts into every page; their errors are not ours.
  if (error instanceof Error && error.stack?.includes('extension://')) return Promise.resolve();
  return reportError(error, { route: webVitalsPage(location.pathname), ...tags });
}
