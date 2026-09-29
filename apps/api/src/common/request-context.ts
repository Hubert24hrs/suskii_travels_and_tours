import type { Request } from 'express';

/** Who and where a request came from, for audit records and session metadata. */
export interface RequestContext {
  /** Client IP after trusted-proxy resolution. Hash it before storing. */
  ip: string;
  userAgent?: string;
  requestId?: string;
}

const MAX_USER_AGENT = 256;

export function requestContext(request: Request): RequestContext {
  const userAgent = request.headers['user-agent']?.slice(0, MAX_USER_AGENT);
  const requestId = (request as Request & { id?: unknown }).id;
  return {
    ip: request.ip ?? request.socket.remoteAddress ?? 'unknown',
    ...(userAgent ? { userAgent } : {}),
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}
