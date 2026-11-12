import { Inject, Injectable } from '@nestjs/common';
import {
  createSentryReporter,
  noopErrorReporter,
  type ErrorReporter as Reporter,
  type ErrorTags,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';

/**
 * Reports unexpected errors to Sentry when SENTRY_DSN is set, and nowhere otherwise (ADR-046).
 * Client errors and deliberate problem responses are never reported. Events carry the error,
 * its stack and allowlisted tags (request id, route template); never request data or users.
 */
@Injectable()
export class ErrorReporter {
  private readonly reporter: Reporter;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.reporter = config.SENTRY_DSN
      ? createSentryReporter({
          dsn: config.SENTRY_DSN,
          platform: 'node',
          service: 'api',
          release: config.SENTRY_RELEASE,
          environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
        })
      : noopErrorReporter;
  }

  /** Fire and forget; resolves when the report is sent or dropped (for shutdown paths). */
  capture(error: unknown, tags?: ErrorTags): Promise<void> {
    return this.reporter.capture(error, tags);
  }
}
