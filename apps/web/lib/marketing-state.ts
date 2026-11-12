import { parseCookieConsent } from '@suskii/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { CONSENT_COOKIE } from './consent-cookie';

/**
 * The visitor's marketing choice under the current policy, read from the consent cookie with the
 * request (ADR-079): `ask` without a choice, then `allowed` or `refused`. The browser then loads
 * the prompt or the tags only when they are needed, and nothing for a visitor who said no.
 */
export type MarketingState = 'ask' | 'allowed' | 'refused';

export const getMarketingState = cache(async (): Promise<MarketingState> => {
  const consent = parseCookieConsent((await cookies()).get(CONSENT_COOKIE)?.value);
  if (!consent) return 'ask';
  return consent.choices.marketing ? 'allowed' : 'refused';
});
