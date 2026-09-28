import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // ui-web ships TypeScript source.
  transpilePackages: ['@suskii/ui-web'],
};

export default nextConfig;
