import { parseDsn } from '@suskii/shared/lite';
import { NextResponse, type NextRequest } from 'next/server';

import { buildCsp } from './lib/csp';
import { publicEnv } from './lib/env';

const reportDsn = parseDsn(publicEnv.sentryDsn);
const errorReportOrigin = reportDsn ? new URL(reportDsn.url).origin : undefined;

/** Same rule as the API: an upstream id is reused only when it is short and plain. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Adds a fresh CSP nonce to every page request (Next.js applies it to its own scripts) and a
 * request id (from the load balancer when well formed), which server error reports carry.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({
    nonce,
    apiOrigin: new URL(publicEnv.apiBaseUrl).origin,
    development: process.env.NODE_ENV === 'development',
    upgradeInsecureRequests: publicEnv.adminUrl.startsWith('https://'),
    errorReportOrigin,
  });
  const upstreamId = request.headers.get('x-request-id');
  const requestId =
    upstreamId && SAFE_REQUEST_ID.test(upstreamId) ? upstreamId : crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Request-Id', requestId);
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
