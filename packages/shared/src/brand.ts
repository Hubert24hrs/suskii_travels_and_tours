/** Brand identity: the logo's name, SUSKII T&T, is the short name (ADR-068). */
export const BRAND = {
  name: 'Suskii Travels and Tour',
  shortName: 'SUSKII T&T',
  slug: 'suskii-travels',
  membershipProgram: 'Suskii Prime',
} as const;

/**
 * Version of the deal-alert consent text shown next to the newsletter checkbox (ADR-012). Bump it
 * whenever that text changes; the API stores it with every consent.
 */
export const NEWSLETTER_CONSENT_VERSION = '2026-09-29';
