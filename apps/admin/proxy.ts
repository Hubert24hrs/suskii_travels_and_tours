import { NextResponse, type NextRequest } from 'next/server';

import { buildCsp } from './lib/csp';
import { publicEnv } from './lib/env';

/** Adds a fresh CSP nonce to every page request (Next.js applies it to its own scripts). */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({
    nonce,
    apiOrigin: new URL(publicEnv.apiBaseUrl).origin,
    development: process.env.NODE_ENV === 'development',
    upgradeInsecureRequests: publicEnv.adminUrl.startsWith('https://'),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
