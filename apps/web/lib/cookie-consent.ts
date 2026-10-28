import {
  COOKIE_CONSENT_MAX_AGE_DAYS,
  COOKIE_POLICY_VERSION,
  formatCookieConsent,
  type CookieChoices,
  type CookieConsent,
} from '@suskii/shared/lite';

import { browserApi } from './browser-api';
import { CONSENT_COOKIE, CONSENT_EVENT, readCookieConsent } from './consent-cookie';
import { SECURE_COOKIES } from './cookie-names';
import { randomUuid } from './random-uuid';

export { CONSENT_EVENT, hasCookieConsent, readCookieConsent } from './consent-cookie';

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
