/** Brand identity. The wordmark is text-only until brand assets exist. */
export const BRAND = {
  name: 'Suskii Travels and Tour',
  shortName: 'Suskii Travels',
  slug: 'suskii-travels',
  membershipProgram: 'Suskii Prime',
} as const;

/**
 * Version of the deal-alert consent text shown next to the newsletter checkbox (ADR-012). Bump it
 * whenever that text changes; the API stores it with every consent.
 */
export const NEWSLETTER_CONSENT_VERSION = '2026-09-29';
