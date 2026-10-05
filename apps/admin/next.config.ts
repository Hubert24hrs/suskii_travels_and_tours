import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // The root CLAUDE.md is the single agent guide (as Turborepo's agentGuidance: false).
  agentRules: false,
  // ui-web ships TypeScript source.
  transpilePackages: ['@suskii/ui-web'],
  // The admin console must never be indexed, including non-HTML responses.
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ]);
  },
};

export default nextConfig;
