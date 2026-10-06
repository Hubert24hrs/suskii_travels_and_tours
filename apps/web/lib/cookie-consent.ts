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
import { readCookie } from './session';

/** Fired on `window` after a new choice is recorded and stored. */
export const CONSENT_EVENT = 'suskii:consent';

/** The visitor's recorded choice under the current policy, or null. Client only. */
export function readCookieConsent(): CookieConsent | null {
  return parseCookieConsent(readCookie(COOKIE_CONSENT_COOKIE));
}

/**
 * Whether an optional category may run. Anything that would set an optional cookie must check
 * this first, and listen for CONSENT_EVENT to start later (ADR-042).
 */
export function hasCookieConsent(category: OptionalCookieCategory): boolean {
  return readCookieConsent()?.choices[category] === true;
}

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Plain-HTTP development hosts other than localhost lack randomUUID: build a version 4 UUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Records the choice with the API first and only then stores it in the consent cookie, so an
 * optional category is never enabled without a record. Returns null when recording failed (the
 * previous choice, or none, stays in force).
 */
export async function saveCookieConsent(choices: CookieChoices): Promise<CookieConsent | null> {
  const consent: CookieConsent = {
    version: COOKIE_POLICY_VERSION,
    consentId: readCookieConsent()?.consentId ?? randomId(),
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
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_CONSENT_COOKIE}=${formatCookieConsent(consent)}; Path=/; Max-Age=${
    COOKIE_CONSENT_MAX_AGE_DAYS * 86_400
  }; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(CONSENT_EVENT));
  return consent;
}
