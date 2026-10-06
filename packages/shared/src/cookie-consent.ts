/**
 * Cookie consent (ADR-042). Strictly necessary cookies need no consent; every optional category
 * stays off until the visitor chooses it and the API has recorded that choice. Zod-free, so the
 * web's lite entry can read the consent cookie.
 */

/** Bump when the cookie list or its wording changes in a way that needs a fresh choice. */
export const COOKIE_POLICY_VERSION = 1;

/** First-party cookie holding the recorded choice (strictly necessary: it stores the choice). */
export const COOKIE_CONSENT_COOKIE = 'suskii_consent';

/** How long a choice lasts before the site asks again. */
export const COOKIE_CONSENT_MAX_AGE_DAYS = 365;

export const OPTIONAL_COOKIE_CATEGORIES = ['analytics', 'marketing'] as const;
export type OptionalCookieCategory = (typeof OPTIONAL_COOKIE_CATEGORIES)[number];
export type CookieChoices = Record<OptionalCookieCategory, boolean>;

export const NO_OPTIONAL_COOKIES: CookieChoices = { analytics: false, marketing: false };

export interface CookieConsent {
  version: number;
  /** Random id that links the cookie to the API's consent record; nothing personal. */
  consentId: string;
  choices: CookieChoices;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `1.<consentId>.10`: policy version, consent id, then one digit per optional category. */
export function formatCookieConsent({ version, consentId, choices }: CookieConsent): string {
  const flags = OPTIONAL_COOKIE_CATEGORIES.map((category) => (choices[category] ? '1' : '0'));
  return `${version}.${consentId}.${flags.join('')}`;
}

/**
 * Reads the consent cookie. Anything malformed, or a choice made under an older policy version,
 * counts as no choice, so optional categories stay off.
 */
export function parseCookieConsent(value: string | null | undefined): CookieConsent | null {
  const [version, consentId, flags, ...rest] = (value ?? '').split('.');
  if (rest.length > 0 || version !== String(COOKIE_POLICY_VERSION)) return null;
  if (!consentId || !UUID.test(consentId)) return null;
  if (!flags || !new RegExp(`^[01]{${OPTIONAL_COOKIE_CATEGORIES.length}}$`).test(flags)) {
    return null;
  }
  const choices = Object.fromEntries(
    OPTIONAL_COOKIE_CATEGORIES.map((category, index) => [category, flags[index] === '1']),
  ) as CookieChoices;
  return { version: COOKIE_POLICY_VERSION, consentId: consentId.toLowerCase(), choices };
}
