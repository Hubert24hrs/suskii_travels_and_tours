import type { AuthenticatedRequest } from '../auth/auth-context';
import type { SalesChannel, UserTier } from '../generated/prisma/client';

export interface ClientContext {
  channel: SalesChannel | null;
  userTier: UserTier;
  userId: string | null;
}

/**
 * Pricing context from the request. Clients identify themselves with `X-Suskii-Client`
 * ("web/1.4.0", "mobile-ios/2.1.0"). The header is not a security control: channel-specific
 * pricing is a marketing lever, and a spoofed header only reveals another channel's price.
 * Suskii Prime (tier `prime`) arrives with memberships in phase 9.
 */
export function clientContext(request: AuthenticatedRequest): ClientContext {
  const header = request.headers['x-suskii-client'];
  const value = (Array.isArray(header) ? header[0] : header)?.toLowerCase() ?? '';
  const channel: SalesChannel | null = value.startsWith('web')
    ? 'web'
    : value.startsWith('mobile')
      ? 'mobile'
      : null;
  return {
    channel,
    userTier: request.auth ? 'member' : 'guest',
    userId: request.auth?.userId ?? null,
  };
}
