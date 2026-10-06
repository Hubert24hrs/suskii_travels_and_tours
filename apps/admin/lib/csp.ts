export interface CspOptions {
  nonce: string;
  apiOrigin: string;
  development: boolean;
  /** Only over HTTPS: upgrading plain-HTTP localhost calls would break local and CI runs. */
  upgradeInsecureRequests: boolean;
}

/**
 * Strict nonce-based Content Security Policy for the console (ADR-010, ADR-033). Scripts run only
 * with the per-request nonce; the only other origin is the API; nothing may frame the console.
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
    ['connect-src', "'self'", options.apiOrigin],
    ['frame-src', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  if (options.upgradeInsecureRequests) directives.push(['upgrade-insecure-requests']);
  return directives.map((parts) => parts.join(' ')).join('; ');
}
