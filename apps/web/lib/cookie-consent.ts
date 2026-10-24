import {
  COOKIE_CONSENT_COOKIE,
  COOKIE_CONSENT_MAX_AGE_DAYS,
  COOKIE_POLICY_VERSION,
  formatCookieConsent,
  parseCookieConsent,
  type CookieChoices,
  type CookieConsent,
  type OptionalCookieCategory,
} from '@suskii/shared/lite';

import { browserApi } from './browser-api';
import { hostCookie, SECURE_COOKIES } from './cookie-names';
import { randomUuid } from './random-uuid';
import { readCookie } from './session';

const CONSENT_COOKIE = hostCookie(COOKIE_CONSENT_COOKIE);

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

/**
 * Records the choice with the API first and only then stores it in the consent cookie, so an
 * optional category is never enabled without a record. Returns null when recording failed (the
 * previous choice, or none, stays in force).
 */
export async function saveCookieConsent(choices: CookieChoices): Promise<CookieConsent | null> {
  const consent: CookieConsent = {
    version: COOKIE_POLICY_VERSION,
    consentId: readCookieConsent()?.consentId ?? randomUuid(),
    choices,
  };
  try {
    const { data } = await browserApi().POST('/v1/privacy/cookie-consents', {
      body: { consentId: consent.consentId, policyVersion: consent.version, choices },
    });
    if (!data) return null;
  } catch {
    return null;
  }
  const secure = SECURE_COOKIES ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${formatCookieConsent(consent)}; Path=/; Max-Age=${
    COOKIE_CONSENT_MAX_AGE_DAYS * 86_400
  }; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(CONSENT_EVENT));
  return consent;
}
