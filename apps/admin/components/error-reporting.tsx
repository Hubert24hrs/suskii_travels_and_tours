'use client';

import { useEffect } from 'react';

import { publicEnv } from '../lib/env';

/**
 * Reports uncaught errors and unhandled rejections in the browser (ADR-046). Only the listeners
 * ship with the page; the reporter loads once something has gone wrong.
 */
export function ErrorReporting(): null {
  useEffect(() => {
    if (!publicEnv.sentryDsn) return;
    const report = (error: unknown): void => {
      void import('../lib/error-reporter').then(({ reportBrowserError }) =>
        reportBrowserError(error, { kind: 'browser' }),
      );
    };
    // Cross-origin scripts give "Script error." without an error object: nothing to report.
    const onError = (event: ErrorEvent): void => {
      if (event.error !== undefined && event.error !== null) report(event.error);
    };
    const onRejection = (event: PromiseRejectionEvent): void => report(event.reason);
    addEventListener('error', onError);
    addEventListener('unhandledrejection', onRejection);
    return () => {
      removeEventListener('error', onError);
      removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
