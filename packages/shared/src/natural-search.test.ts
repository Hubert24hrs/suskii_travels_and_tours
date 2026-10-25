import { describe, expect, it } from 'vitest';

import {
  naturalSearchDraftSchema,
  naturalSearchRequestSchema,
  naturalSearchResultSchema,
} from './natural-search';
import { DEFAULT_SEARCH_TIME_ZONE, NATURAL_SEARCH_MAX_LENGTH } from './natural-search-limits';
import { emptyFlightDraft, type FlightFormDraft } from './search-url';

describe('natural search request', () => {
  it('trims the text and defaults the time zone to the primary market', () => {
    expect(naturalSearchRequestSchema.parse({ text: '  Lagos to Accra  ' })).toEqual({
      text: 'Lagos to Accra',
      timeZone: DEFAULT_SEARCH_TIME_ZONE,
    });
  });

  it('refuses text that is too short or too long, and unknown time zones', () => {
    expect(naturalSearchRequestSchema.safeParse({ text: ' a ' }).success).toBe(false);
    expect(
      naturalSearchRequestSchema.safeParse({ text: 'x'.repeat(NATURAL_SEARCH_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(
      naturalSearchRequestSchema.safeParse({ text: 'Lagos to Accra', timeZone: 'Mars/Olympus' })
        .success,
    ).toBe(false);
    expect(
      naturalSearchRequestSchema.parse({ text: 'Lagos to Accra', timeZone: 'Europe/London' })
        .timeZone,
    ).toBe('Europe/London');
  });
});

describe('natural search result', () => {
  it('accepts a partial draft with the fields left to fill', () => {
    const draft = { ...emptyFlightDraft(), destination: 'DXB', legs: [] };
    const result = naturalSearchResultSchema.parse({
      draft,
      places: [{ code: 'DXB', name: 'Dubai International', city: 'Dubai', countryCode: 'AE' }],
      departureMonth: '2026-12',
      missing: ['origin', 'departureDate', 'returnDate'],
    });
    // The draft drops straight into the forms' own draft type.
    const formDraft: FlightFormDraft = result.draft;
    expect(formDraft.destination).toBe('DXB');
  });

  it('refuses malformed codes, dates and months', () => {
    const base = { ...emptyFlightDraft(), legs: [] };
    expect(naturalSearchDraftSchema.safeParse({ ...base, origin: 'LAGOS' }).success).toBe(false);
    expect(
      naturalSearchDraftSchema.safeParse({ ...base, departureDate: '2026-13-01' }).success,
    ).toBe(false);
    expect(
      naturalSearchResultSchema.safeParse({
        draft: base,
        places: [],
        departureMonth: '2026-12-01',
        missing: [],
      }).success,
    ).toBe(false);
  });
});
