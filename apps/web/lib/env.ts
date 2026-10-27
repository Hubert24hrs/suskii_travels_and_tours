/**
 * Environment for the web app. NEXT_PUBLIC_* values are inlined at build time and safe to expose;
 * API_INTERNAL_URL is read on the server only (server-to-server calls inside the platform).
 */
export const publicEnv = {
  /** Browser -> API origin (autocomplete, newsletter). */
  apiBaseUrl: setting(process.env.NEXT_PUBLIC_API_BASE_URL, 'http://localhost:4000'),
  /** Canonical site origin for metadata, sitemaps and Open Graph URLs. */
  siteUrl: setting(process.env.NEXT_PUBLIC_SITE_URL, 'http://localhost:3000').replace(/\/$/, ''),
  /** Cloudflare Turnstile site key; empty locally (the API then uses its mock verifier). */
  turnstileSiteKey: setting(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, ''),
  /** Sentry DSN for error reports from the browser and the server (public by design; ADR-046). */
  sentryDsn: setting(process.env.NEXT_PUBLIC_SENTRY_DSN, ''),
  sentryEnvironment: setting(process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT, process.env.NODE_ENV),
  /** The deployed version (the git SHA), so reports match the uploaded source maps. */
  sentryRelease: setting(process.env.NEXT_PUBLIC_SENTRY_RELEASE, ''),
  /** Google OAuth web client id for "Continue with Google" (public; empty: none, ADR-067). */
  googleClientId: setting(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID, ''),
  /** Apple Services ID for "Continue with Apple" on the web (public; empty: none). */
  appleServicesId: setting(process.env.NEXT_PUBLIC_APPLE_SERVICES_ID, ''),
  /** Share of page views that report field Core Web Vitals (0 to 1; ADR-044). */
  webVitalsSampleRate: sampleRate(process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE),
} as const;

/**
 * A value, or the fallback when it is missing or empty. An image built without a build argument
 * still gets the variable, as an empty string (`ENV NAME=${NAME}` in the Dockerfile).
 */
function setting(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value;
}

function sampleRate(value: string | undefined): number {
  const rate = Number(setting(value, '1'));
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1;
}

export function apiInternalUrl(): string {
  return process.env.API_INTERNAL_URL ?? publicEnv.apiBaseUrl;
}

/** Sent as X-Suskii-Client so the API applies web-channel pricing rules. */
export const CLIENT_ID = 'web/0.1';
