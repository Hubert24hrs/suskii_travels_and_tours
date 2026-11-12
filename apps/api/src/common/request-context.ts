import type { Request } from 'express';

/** Who and where a request came from, for audit records and session metadata. */
export interface RequestContext {
  /** Client IP after trusted-proxy resolution. Hash it before storing. */
  ip: string;
  userAgent?: string;
  requestId?: string;
  /**
   * `X-Suskii-Device`: an install id the apps generate and keep (spoofable; used only as a
   * hashed fraud signal for referrals, ADR-031).
   */
  device?: string;
  /** The client's country as the edge reported it (`ClientCountryMiddleware`), if configured. */
  country?: string;
}

const MAX_USER_AGENT = 256;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function requestContext(request: Request): RequestContext {
  const userAgent = request.headers['user-agent']?.slice(0, MAX_USER_AGENT);
  const requestId = (request as Request & { id?: unknown }).id;
  const device = request.headers['x-suskii-device'];
  const deviceId = typeof device === 'string' && DEVICE_ID.test(device) ? device : undefined;
  const country = (request as Request & { clientCountry?: string }).clientCountry;
  return {
    ip: request.ip ?? request.socket.remoteAddress ?? 'unknown',
    ...(userAgent ? { userAgent } : {}),
    ...(typeof requestId === 'string' ? { requestId } : {}),
    ...(deviceId ? { device: deviceId } : {}),
    ...(country ? { country } : {}),
  };
}
