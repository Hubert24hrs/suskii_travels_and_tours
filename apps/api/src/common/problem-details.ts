import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ErrorReporter } from '../telemetry/error-reporter';

/** RFC 9457 problem details. Extension members (e.g. `errors`) are allowed. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

const problemType = (slug: string): string => `urn:suskii:problem:${slug}`;

/** Throw for client errors that need a stable machine-readable type and optional extensions. */
export class ProblemDetailsException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly slug: string,
    readonly title: string,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
    /** Response headers, e.g. Retry-After. Never part of the body. */
    readonly headers: Record<string, string> = {},
  ) {
    super({ slug, title, detail, ...extensions }, status);
  }
}

const TITLES: Partial<Record<number, string>> = {
  400: 'Bad request',
  401: 'Authentication required',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable content',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

const slugify = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function toProblemDetails(exception: unknown): ProblemDetails {
  if (exception instanceof ProblemDetailsException) {
    const status = exception.getStatus();
    return {
      type: problemType(exception.slug),
      title: exception.title,
      status,
      ...(exception.detail ? { detail: exception.detail } : {}),
      ...exception.extensions,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const title = TITLES[status] ?? (status >= 500 ? 'Internal server error' : 'Request failed');
    // Framework messages for 4xx are safe to show; 5xx details never leave the server.
    const response = exception.getResponse();
    const message =
      typeof response === 'object' && 'message' in response && typeof response.message === 'string'
        ? response.message
        : undefined;
    const detail = status < 500 && status !== 404 ? message : undefined;
    return { type: problemType(slugify(title)), title, status, ...(detail ? { detail } : {}) };
  }
  if (isClientHttpError(exception)) {
    // body-parser and other Express middleware (malformed JSON, payload too large): the status is
    // meaningful, the message is not needed.
    const title = TITLES[exception.status] ?? 'Bad request';
    return { type: problemType(slugify(title)), title, status: exception.status };
  }
  return {
    type: problemType('internal-server-error'),
    title: 'Internal server error',
    status: 500,
  };
}

/** `http-errors` objects that are safe to expose (4xx raised by Express middleware). */
function isClientHttpError(value: unknown): value is { status: number } {
  if (typeof value !== 'object' || value === null) return false;
  const { status, expose } = value as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

/**
 * Renders every error as `application/problem+json`. Unexpected errors are logged with their
 * stack; clients only ever see a generic 500 with the request id for support.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(@Optional() private readonly errors?: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const problem = toProblemDetails(exception);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, requestId: request.id },
        exception instanceof Error ? exception.message : 'Unhandled exception',
      );
      // Deliberate 5xx problems (a supplier or provider is down) are metrics, not bugs.
      if (!(exception instanceof ProblemDetailsException)) {
        const route = (request as unknown as { route?: { path?: unknown } }).route?.path;
        void this.errors?.capture(exception, {
          ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
          route: typeof route === 'string' ? route : 'unmatched',
          method: request.method,
          status: problem.status,
        });
      }
    }

    if (exception instanceof ProblemDetailsException) {
      for (const [name, value] of Object.entries(exception.headers))
        response.setHeader(name, value);
    }

    response
      .status(problem.status)
      .type(PROBLEM_CONTENT_TYPE)
      .json({
        ...problem,
        // Path only: query strings may carry tokens.
        instance: request.path,
        ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
      });
  }
}
