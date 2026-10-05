import type { NextConfig } from 'next';

const imageHosts = (process.env.IMAGE_REMOTE_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

/** Headers that never change per request; the nonce CSP is set in proxy.ts. */
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
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // The root CLAUDE.md is the single agent guide (as Turborepo's agentGuidance: false).
  agentRules: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@suskii/ui-web', '@suskii/i18n', '@suskii/api-client'],
  experimental: {
    optimizePackageImports: ['@suskii/ui-web'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    // Licensed photos come from the CMS/CDN hosts listed in IMAGE_REMOTE_HOSTS (ADR-010).
    remotePatterns: imageHosts.map((hostname) => ({ protocol: 'https' as const, hostname })),
  },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: SECURITY_HEADERS }]);
  },
};

export default nextConfig;
