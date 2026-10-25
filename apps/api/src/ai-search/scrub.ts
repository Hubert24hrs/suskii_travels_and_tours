/**
 * Removes personal data a traveller might type into the search box before the text leaves for
 * the model (ADR-061): e-mail addresses, phone numbers, card numbers and identity-document-like
 * codes. Dates, times, prices and small counts stay, because the search needs them.
 */

const REMOVED = '[removed]';

const PATTERNS: readonly RegExp[] = [
  // E-mail addresses.
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  // International phone numbers: a plus sign and at least 7 more digits (before cards, whose
  // pattern would otherwise take the digits after the plus).
  /\+\d(?:[\s().-]*\d){6,}/g,
  // Card numbers: 13-19 digits, optionally grouped by spaces or dashes.
  /\b\d(?:[ -]?\d){12,18}\b/g,
  // Nigerian mobile numbers written locally (0803 123 4567).
  /\b0[789][01]\d(?:[\s-]?\d){7}\b/g,
  // Passport and ID-like codes: one or two letters, then 6-9 digits.
  /\b[A-Za-z]{1,2}\d{6,9}\b/g,
  // Any other run of 7 or more digits (no date or count is that long).
  /\b\d{7,}\b/g,
];

/**
 * ISO dates are set aside first (two side by side look like a card number), behind private-use
 * characters that no traveller types.
 */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const SET_ASIDE = /\uE000(\d+)\uE001/g;

export function scrubQuery(text: string): string {
  const dates: string[] = [];
  const withoutDates = text
    .replace(SET_ASIDE, ' ')
    .replace(ISO_DATE, (date) => `\uE000${dates.push(date) - 1}\uE001`);
  return PATTERNS.reduce((current, pattern) => current.replace(pattern, REMOVED), withoutDates)
    .replace(SET_ASIDE, (_, index: string) => dates[Number(index)] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
