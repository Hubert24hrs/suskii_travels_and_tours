/**
 * Environment for the admin console. NEXT_PUBLIC_* values are inlined at build time and public;
 * the console holds no secrets (staff authenticate with their own session).
 */
export const publicEnv = {
  /** Browser -> API origin. */
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  /** The console's own origin (only used to decide on upgrade-insecure-requests). */
  adminUrl: (process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
} as const;
