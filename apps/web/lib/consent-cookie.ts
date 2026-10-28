import {
  COOKIE_CONSENT_COOKIE,
  parseCookieConsent,
  type CookieConsent,
  type OptionalCookieCategory,
} from '@suskii/shared/lite';

import { hostCookie } from './cookie-names';
import { readCookie } from './read-cookie';

/**
 * Reading the recorded cookie choice (ADR-042). Kept apart from saving, which needs the API
 * client, so the ad tags and the first-visit prompt can check consent without loading it.
 */
export const CONSENT_COOKIE = hostCookie(COOKIE_CONSENT_COOKIE);

/** Fired on `window` after a new choice is recorded and stored. */
export const CONSENT_EVENT = 'suskii:consent';

/** The visitor's recorded choice under the current policy, or null. Client only. */
export function readCookieConsent(): CookieConsent | null {
  return parseCookieConsent(readCookie(CONSENT_COOKIE));
}

/**
 * Whether an optional category may run. Anything that would set an optional cookie must check
 * this first, and listen for CONSENT_EVENT to start later (ADR-042).
 */
export function hasCookieConsent(category: OptionalCookieCategory): boolean {
  return readCookieConsent()?.choices[category] === true;
}
