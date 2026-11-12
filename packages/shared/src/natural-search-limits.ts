/**
 * Zod-free constants of natural-language flight search (ADR-061), shared by the schemas in
 * `natural-search.ts` and by browser code that renders the box before any validation.
 */

export const NATURAL_SEARCH_MIN_LENGTH = 3;
export const NATURAL_SEARCH_MAX_LENGTH = 280;
/** Dates such as "tomorrow" are read in the visitor's zone; this is the primary market's. */
export const DEFAULT_SEARCH_TIME_ZONE = 'Africa/Lagos';

/** Problem slugs the clients answer by showing the form with a notice. */
export const NATURAL_SEARCH_PROBLEMS = {
  notUnderstood: 'ai-search-not-understood',
  budgetExceeded: 'ai-search-budget-exceeded',
  unavailable: 'ai-search-unavailable',
} as const;

/** Form fields a draft can leave for the traveller to fill. */
export const NATURAL_SEARCH_FIELDS = [
  'origin',
  'destination',
  'departureDate',
  'returnDate',
  'legs',
] as const;
export type NaturalSearchField = (typeof NATURAL_SEARCH_FIELDS)[number];
