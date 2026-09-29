const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export interface CspOptions {
  nonce: string;
  apiOrigin: string;
  /** Extra image origins (licensed photos from the CMS). */
  imageOrigins?: readonly string[];
  development: boolean;
  /** Only over HTTPS: upgrading plain-HTTP localhost calls would break local and CI runs. */
  upgradeInsecureRequests: boolean;
}

/**
 * Strict nonce-based Content Security Policy (ADR-010). Scripts run only with the per-request
 * nonce (`strict-dynamic` lets them load their own chunks); styles allow inline attributes, which
 * React and next/image emit and nonces cannot cover.
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
    ['img-src', "'self'", 'data:', 'blob:', ...(options.imageOrigins ?? [])],
    ['font-src', "'self'"],
    ['connect-src', "'self'", options.apiOrigin, TURNSTILE_ORIGIN],
    ['frame-src', TURNSTILE_ORIGIN],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['manifest-src', "'self'"],
  ];
  if (options.upgradeInsecureRequests) directives.push(['upgrade-insecure-requests']);
  return directives.map((parts) => parts.join(' ')).join('; ');
}
