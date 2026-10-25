import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CabinClass, NaturalSearchResult, TripType } from '@suskii/shared';

import type { TripQueryOutput } from '../../src/ai-search/trip-query';

/**
 * The AI trip search eval (ADR-061), shared by the e2e test (recorded model answers) and
 * `pnpm --filter @suskii/api eval:natural-search` (the configured model).
 */

export interface EvalLeg {
  origin: string;
  destination: string;
  departureDate: string;
}

/** What one message should become, compared field by field (exact match). */
export type EvalStruct =
  | { understood: false }
  | {
      understood: true;
      tripType: TripType;
      origin: string;
      destination: string;
      departureDate: string;
      returnDate: string;
      departureMonth: string | null;
      legs: EvalLeg[];
      adults: number;
      children: number;
      infants: number;
      cabinClass: CabinClass;
      directOnly: boolean;
      flexibleDates: boolean;
    };

type Understood = Extract<EvalStruct, { understood: true }>;

export interface EvalCase {
  id: string;
  query: string;
  /** Only the fields that differ from the form's defaults, or `{ understood: false }`. */
  expected: Partial<Omit<Understood, 'understood'>> | { understood: false };
  /** Record the model answer without codes, so places resolve by name through the catalog. */
  nameOnly?: boolean;
  /** Names to record instead of `places` (for misspellings). */
  recordedNames?: Record<string, string>;
}

export interface EvalSuite {
  now: string;
  today: string;
  timeZone: string;
  places: Record<string, string>;
  cases: EvalCase[];
}

const DEFAULTS: Omit<Understood, 'understood'> = {
  tripType: 'one_way',
  origin: '',
  destination: '',
  departureDate: '',
  returnDate: '',
  departureMonth: null,
  legs: [],
  adults: 1,
  children: 0,
  infants: 0,
  cabinClass: 'economy',
  directOnly: false,
  flexibleDates: false,
};

export function loadEvalSuite(): EvalSuite {
  return JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'natural-search-eval.json'), 'utf8'),
  ) as EvalSuite;
}

const understood = (expected: EvalCase['expected']): expected is Partial<Understood> =>
  !('understood' in expected && expected.understood === false);

/** The full expected struct, defaults filled in. */
export function expectedStruct(evalCase: EvalCase): EvalStruct {
  if (!understood(evalCase.expected)) return { understood: false };
  return { understood: true, ...DEFAULTS, ...evalCase.expected };
}

/** A parse result in the eval's shape; `null` means the API answered "not understood". */
export function actualStruct(result: NaturalSearchResult | null): EvalStruct {
  if (!result) return { understood: false };
  const { draft } = result;
  return {
    understood: true,
    tripType: draft.tripType,
    origin: draft.origin,
    destination: draft.destination,
    departureDate: draft.departureDate,
    returnDate: draft.returnDate,
    departureMonth: result.departureMonth,
    legs: draft.legs,
    adults: draft.travellers.adults,
    children: draft.travellers.children,
    infants: draft.travellers.infants,
    cabinClass: draft.cabinClass,
    directOnly: draft.directOnly,
    flexibleDates: draft.flexibleDates,
  };
}

/** Field names whose values differ (an empty list is an exact match). */
export function mismatches(expected: EvalStruct, actual: EvalStruct): string[] {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...keys].filter(
    (key) =>
      JSON.stringify((expected as Record<string, unknown>)[key]) !==
      JSON.stringify((actual as Record<string, unknown>)[key]),
  );
}

/**
 * The answer a model following the prompt would give for a case: the expected values, with each
 * airport named as `places` says (and its code unless `nameOnly`). Values the message does not
 * state stay null, as the prompt asks.
 */
export function recordedAnswer(suite: EvalSuite, evalCase: EvalCase): TripQueryOutput {
  const expected = evalCase.expected;
  if (!understood(expected)) {
    return {
      understood: false,
      tripType: null,
      legs: [],
      returnDate: null,
      departureMonth: null,
      adults: null,
      children: null,
      infants: null,
      cabinClass: null,
      directOnly: false,
      flexibleDates: false,
    };
  }
  const place = (code: string | undefined): TripQueryOutput['legs'][number]['from'] => {
    if (!code) return null;
    const name = evalCase.recordedNames?.[code] ?? suite.places[code];
    if (!name) throw new Error(`eval case ${evalCase.id}: no name for ${code} in places`);
    return { name, iata: evalCase.nameOnly ? null : code };
  };
  const legs =
    expected.tripType === 'multi_city'
      ? (expected.legs ?? []).map((leg) => ({
          from: place(leg.origin),
          to: place(leg.destination),
          date: leg.departureDate || null,
        }))
      : [
          {
            from: place(expected.origin),
            to: place(expected.destination),
            date: expected.departureDate ?? null,
          },
        ];
  return {
    understood: true,
    tripType: expected.tripType ?? 'one_way',
    legs,
    returnDate: expected.returnDate ?? null,
    departureMonth: expected.departureMonth ?? null,
    adults: expected.adults ?? null,
    children: expected.children ?? null,
    infants: expected.infants ?? null,
    cabinClass: expected.cabinClass ?? null,
    directOnly: expected.directOnly ?? false,
    flexibleDates: expected.flexibleDates ?? false,
  };
}
