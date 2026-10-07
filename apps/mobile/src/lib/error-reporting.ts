import { createSentryReporter, type ErrorReporter, type ErrorTags } from '@suskii/shared';

import { appConfig } from '../config';

let reporter: ErrorReporter | undefined;

/** Sends a JavaScript error to Sentry when EXPO_PUBLIC_SENTRY_DSN is set (ADR-046). */
export function reportError(error: unknown, tags?: ErrorTags): Promise<void> {
  if (!appConfig.sentryDsn) return Promise.resolve();
  reporter ??= createSentryReporter({
    dsn: appConfig.sentryDsn,
    platform: 'javascript',
    service: 'mobile',
    release: appConfig.version,
    environment: appConfig.variant,
  });
  return reporter.capture(error, tags);
}

/** A fatal error ends the app: wait this long at most for its report to leave. */
const FATAL_REPORT_WAIT_MS = 1500;

interface PromiseRejectionTracker {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
  }) => void;
}

/**
 * Reports uncaught errors and, in release builds, unhandled promise rejections (development keeps
 * React Native's own LogBox tracker). Native crashes need the native SDK, which is a store-release
 * decision (ADR-046). Runs once, from error-reporting-setup.ts.
 */
export function installErrorReporting(): void {
  if (!appConfig.sentryDsn) return;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const sent = reportError(error, { kind: isFatal ? 'fatal' : 'uncaught' });
    if (!isFatal) {
      previous(error, isFatal);
      return;
    }
    const wait = new Promise<void>((resolve) => setTimeout(resolve, FATAL_REPORT_WAIT_MS));
    void Promise.race([sent, wait]).finally(() => previous(error, isFatal));
  });
  const hermes = (globalThis as { HermesInternal?: PromiseRejectionTracker }).HermesInternal;
  if (!__DEV__ && hermes?.enablePromiseRejectionTracker) {
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, rejection) => void reportError(rejection, { kind: 'rejection' }),
    });
  }
}
