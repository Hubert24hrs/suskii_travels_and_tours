import { resolve } from 'node:path';

import type { NextConfig } from 'next';

/**
 * Container builds (ADR-058) set NEXT_OUTPUT=standalone: a self-contained server with only the
 * files it needs, traced from the repository root (pnpm workspace). `next start` keeps working
 * for local runs and the e2e stack, which build without it.
 */
const standalone =
  process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: resolve(process.cwd(), '../..') }
    : {};

/** Headers that never change per request; the nonce CSP is set in proxy.ts (ADR-033). */
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // The admin console must never be indexed, including non-HTML responses.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  ...standalone,
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // The root CLAUDE.md is the single agent guide (as Turborepo's agentGuidance: false).
  agentRules: false,
  // ui-web ships TypeScript source.
  transpilePackages: ['@suskii/ui-web'],
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: SECURITY_HEADERS }]);
  },
  // Browsers still ask for /favicon.ico now and then (before the page's icon link is read, as
  // during a redirect); the icon is an SVG, so point them at it instead of answering 404.
  redirects() {
    return Promise.resolve([{ source: '/favicon.ico', destination: '/icon.svg', permanent: true }]);
  },
};

export default nextConfig;
