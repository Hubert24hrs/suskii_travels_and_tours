import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuses a well-formed upstream `X-Request-Id` (for tracing across services), else mints one. */
export function resolveRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();
}
