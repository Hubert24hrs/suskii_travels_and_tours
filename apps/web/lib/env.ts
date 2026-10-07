/**
 * Environment for the web app. NEXT_PUBLIC_* values are inlined at build time and safe to expose;
 * API_INTERNAL_URL is read on the server only (server-to-server calls inside the platform).
 */
export const publicEnv = {
  /** Browser -> API origin (autocomplete, newsletter). */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
  /** Canonical site origin for metadata, sitemaps and Open Graph URLs. */
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  /** Cloudflare Turnstile site key; empty locally (the API then uses its mock verifier). */
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
  /** Share of page views that report field Core Web Vitals (0 to 1; ADR-044). */
  webVitalsSampleRate: sampleRate(process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE),
} as const;

function sampleRate(value: string | undefined): number {
  const rate = Number(value ?? '1');
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1;
}

export function apiInternalUrl(): string {
  return process.env.API_INTERNAL_URL ?? publicEnv.apiBaseUrl;
}

/** Sent as X-Suskii-Client so the API applies web-channel pricing rules. */
export const CLIENT_ID = 'web/0.1';
