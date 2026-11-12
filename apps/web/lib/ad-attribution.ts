import {
  AD_CLICK_COOKIES,
  META_CLICK_ID,
  TIKTOK_CLICK_ID,
  type MarketingAttribution,
} from '@suskii/shared/lite';

import { TIKTOK_CLICK_STORAGE_KEY } from './ad-tags';
import { readCookieConsent } from './consent-cookie';
import { readCookie } from './read-cookie';

function storedTikTokClick(): string | null {
  try {
    return sessionStorage.getItem(TIKTOK_CLICK_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * What a booking carries for server-side ad events (ADR-079): only when the visitor allowed
 * marketing, and only well-formed click ids, so an odd cookie never fails a booking. The API
 * still checks the recorded consent itself.
 */
export function marketingAttribution(): MarketingAttribution | undefined {
  const consent = readCookieConsent();
  if (!consent?.choices.marketing) return undefined;
  const valid = (value: string | null, pattern: RegExp): string | undefined =>
    value && pattern.test(value) ? value : undefined;
  const attribution: MarketingAttribution = {
    consentId: consent.consentId,
    fbp: valid(readCookie(AD_CLICK_COOKIES.fbp), META_CLICK_ID),
    fbc: valid(readCookie(AD_CLICK_COOKIES.fbc), META_CLICK_ID),
    ttp: valid(readCookie(AD_CLICK_COOKIES.ttp), TIKTOK_CLICK_ID),
    ttclid: valid(storedTikTokClick(), TIKTOK_CLICK_ID),
  };
  return Object.fromEntries(
    Object.entries(attribution).filter(([, value]) => value !== undefined),
  ) as MarketingAttribution;
}
