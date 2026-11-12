export interface CspOptions {
  nonce: string;
  apiOrigin: string;
  development: boolean;
  /** Only over HTTPS: upgrading plain-HTTP localhost calls would break local and CI runs. */
  upgradeInsecureRequests: boolean;
  /** Where error reports go (the Sentry DSN's origin), when reporting is on (ADR-046). */
  errorReportOrigin?: string | undefined;
}

/**
 * Strict nonce-based Content Security Policy for the console (ADR-010, ADR-033). Scripts run only
 * with the per-request nonce; the only other origins are the API and, when set, the error
 * reporting endpoint; nothing may frame the console.
 */
export function buildCsp(options: CspOptions): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    [
      'script-src',
      "'self'",
      `'nonce-${options.nonce}'`,
      "'strict-dynamic'",
      ...(options.development ? ["'unsafe-eval'"] : []),
    ],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['font-src', "'self'"],
    [
      'connect-src',
      "'self'",
      options.apiOrigin,
      ...(options.errorReportOrigin ? [options.errorReportOrigin] : []),
    ],
    ['frame-src', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  if (options.upgradeInsecureRequests) directives.push(['upgrade-insecure-requests']);
  return directives.map((parts) => parts.join(' ')).join('; ');
}
