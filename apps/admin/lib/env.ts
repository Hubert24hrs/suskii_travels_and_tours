/**
 * Environment for the admin console. NEXT_PUBLIC_* values are inlined at build time and public;
 * the console holds no secrets (staff authenticate with their own session).
 */
export const publicEnv = {
  /** Browser -> API origin. */
  apiBaseUrl: setting(process.env.NEXT_PUBLIC_API_BASE_URL, 'http://localhost:4000').replace(
    /\/$/,
    '',
  ),
  /** The console's own origin (only used to decide on upgrade-insecure-requests). */
  adminUrl: setting(process.env.NEXT_PUBLIC_ADMIN_URL, 'http://localhost:3001').replace(/\/$/, ''),
  /** Sentry DSN for the console's error reports (public by design; ADR-046). */
  sentryDsn: setting(process.env.NEXT_PUBLIC_SENTRY_DSN, ''),
  sentryEnvironment: setting(process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT, process.env.NODE_ENV),
  sentryRelease: setting(process.env.NEXT_PUBLIC_SENTRY_RELEASE, ''),
} as const;

/**
 * A value, or the fallback when it is missing or empty. An image built without a build argument
 * still gets the variable, as an empty string (`ENV NAME=${NAME}` in the Dockerfile).
 */
function setting(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value;
}
