import type { PrimeBenefits } from '@suskii/shared';

import type { AuthenticatedRequest } from '../auth/auth-context';
import type { SalesChannel, UserTier } from '../generated/prisma/client';

export interface ClientContext {
  channel: SalesChannel | null;
  userTier: UserTier;
  userId: string | null;
  /** Suskii Prime benefits when `userTier` is `prime` (ADR-030). */
  benefits: PrimeBenefits | null;
}

/**
 * Pricing context from the request. Clients identify themselves with `X-Suskii-Client`
 * ("web/1.4.0", "mobile-ios/2.1.0"). The header is not a security control: channel-specific
 * pricing is a marketing lever, and a spoofed header only reveals another channel's price.
 * The Suskii Prime tier comes from the access token (ADR-030): searches price members without a
 * database read; quotes and bookings re-read it (`withCurrentTier`).
 */
export function clientContext(request: AuthenticatedRequest): ClientContext {
  const header = request.headers['x-suskii-client'];
  const value = (Array.isArray(header) ? header[0] : header)?.toLowerCase() ?? '';
  const channel: SalesChannel | null = value.startsWith('web')
    ? 'web'
    : value.startsWith('mobile')
      ? 'mobile'
      : null;
  const prime = request.auth?.prime;
  const isPrime = prime !== null && prime !== undefined && prime.until.getTime() > Date.now();
  return {
    channel,
    userTier: request.auth ? (isPrime ? 'prime' : 'member') : 'guest',
    userId: request.auth?.userId ?? null,
    benefits: isPrime ? prime.benefits : null,
  };
}
