import { z } from './zod-setup';

import { iataCodeSchema, isoDateSchema } from './search';
import { CABIN_CLASSES, MAX_FLIGHT_SLICES, TRIP_TYPES } from './search-limits';
import {
  DEFAULT_SEARCH_TIME_ZONE,
  NATURAL_SEARCH_FIELDS,
  NATURAL_SEARCH_MAX_LENGTH,
  NATURAL_SEARCH_MIN_LENGTH,
} from './natural-search-limits';
import { isValidTimeZone } from './time';
import { travellerCountsSchema } from './travellers';

/**
 * Natural-language flight search (phase 13, ADR-061): the traveller describes a trip, the API
 * turns it into a draft of the flight form, and the client fills its form for the traveller to
 * check and submit. The result is never a search on its own.
 */

export const naturalSearchRequestSchema = z.object({
  text: z.string().trim().min(NATURAL_SEARCH_MIN_LENGTH).max(NATURAL_SEARCH_MAX_LENGTH),
  timeZone: z
    .string()
    .refine(isValidTimeZone, 'Use an IANA time zone')
    .default(DEFAULT_SEARCH_TIME_ZONE),
});
export type NaturalSearchRequest = z.output<typeof naturalSearchRequestSchema>;

/** Empty strings mean "not chosen yet", as in the forms' own drafts. */
const codeOrEmpty = z.union([z.literal(''), iataCodeSchema]);
const dateOrEmpty = z.union([z.literal(''), isoDateSchema]);

export const naturalSearchPlaceSchema = z.object({
  code: iataCodeSchema,
  name: z.string(),
  city: z.string(),
  countryCode: z.string().length(2),
});
export type NaturalSearchPlace = z.output<typeof naturalSearchPlaceSchema>;

/** Assignable to the forms' `FlightFormDraft` (`search-url.ts`). */
export const naturalSearchDraftSchema = z.object({
  tripType: z.enum(TRIP_TYPES),
  origin: codeOrEmpty,
  destination: codeOrEmpty,
  departureDate: dateOrEmpty,
  returnDate: dateOrEmpty,
  legs: z
    .array(z.object({ origin: codeOrEmpty, destination: codeOrEmpty, departureDate: dateOrEmpty }))
    .max(MAX_FLIGHT_SLICES),
  travellers: travellerCountsSchema,
  cabinClass: z.enum(CABIN_CLASSES),
  directOnly: z.boolean(),
  flexibleDates: z.boolean(),
});
export type NaturalSearchDraft = z.output<typeof naturalSearchDraftSchema>;

export const naturalSearchResultSchema = z.object({
  draft: naturalSearchDraftSchema,
  /** Name, city and country of every airport in the draft, for the fields' labels. */
  places: z.array(naturalSearchPlaceSchema),
  /** When the text names a month but no day ("in December"): the month to open the picker on. */
  departureMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable(),
  /** Fields the traveller still has to fill (the text did not say, or what it said was invalid). */
  missing: z.array(z.enum(NATURAL_SEARCH_FIELDS)),
});
export type NaturalSearchResult = z.output<typeof naturalSearchResultSchema>;

export const naturalSearchStatusSchema = z.object({
  enabled: z.boolean(),
  maxLength: z.number().int().positive(),
});
export type NaturalSearchStatus = z.output<typeof naturalSearchStatusSchema>;
