import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRAVELLERS,
  MAX_TRAVELLERS,
  TRAVELLER_ISSUES,
  canDecrement,
  canIncrement,
  stepTravellers,
  totalTravellers,
  travellerCountsSchema,
  type TravellerCounts,
} from './travellers';

const counts = (adults: number, children = 0, infants = 0): TravellerCounts => ({
  adults,
  children,
  infants,
});

describe('travellerCountsSchema', () => {
  it('accepts the default and the maximum valid party', () => {
    expect(travellerCountsSchema.safeParse(DEFAULT_TRAVELLERS).success).toBe(true);
    expect(travellerCountsSchema.safeParse(counts(5, 2, 2)).success).toBe(true);
  });

  it('requires at least one adult', () => {
    expect(travellerCountsSchema.safeParse(counts(0, 1)).success).toBe(false);
  });

  it('rejects more infants than adults with a machine-readable code', () => {
    const result = travellerCountsSchema.safeParse(counts(1, 0, 2));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      TRAVELLER_ISSUES.infantsExceedAdults,
    );
  });

  it('rejects parties over the total cap, infants included', () => {
    const result = travellerCountsSchema.safeParse(counts(5, 3, 2));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      TRAVELLER_ISSUES.tooManyTravellers,
    );
  });

  it('rejects fractional and negative counts', () => {
    expect(travellerCountsSchema.safeParse(counts(1.5)).success).toBe(false);
    expect(travellerCountsSchema.safeParse(counts(1, -1)).success).toBe(false);
  });
});

describe('stepper rules', () => {
  it('stops every increment at the total cap', () => {
    const full = counts(5, 2, 2);
    expect(totalTravellers(full)).toBe(MAX_TRAVELLERS);
    expect(canIncrement(full, 'adults')).toBe(false);
    expect(canIncrement(full, 'children')).toBe(false);
    expect(canIncrement(full, 'infants')).toBe(false);
  });

  it('allows one infant per adult', () => {
    expect(canIncrement(counts(1), 'infants')).toBe(true);
    expect(canIncrement(counts(1, 0, 1), 'infants')).toBe(false);
  });

  it('never removes the last adult, or an adult needed by an infant', () => {
    expect(canDecrement(counts(1), 'adults')).toBe(false);
    expect(canDecrement(counts(2, 0, 2), 'adults')).toBe(false);
    expect(canDecrement(counts(2, 0, 1), 'adults')).toBe(true);
  });

  it('never goes below zero children or infants', () => {
    expect(canDecrement(counts(1), 'children')).toBe(false);
    expect(canDecrement(counts(1), 'infants')).toBe(false);
  });

  it('stepTravellers applies allowed steps and ignores disallowed ones', () => {
    expect(stepTravellers(counts(1), 'children', 1)).toEqual(counts(1, 1));
    expect(stepTravellers(counts(1), 'adults', -1)).toEqual(counts(1));
  });

  it('keeps every reachable state valid (exhaustive walk from the default)', () => {
    const seen = new Set<string>();
    const queue: TravellerCounts[] = [DEFAULT_TRAVELLERS];
    for (let current = queue.pop(); current; current = queue.pop()) {
      const key = `${current.adults}-${current.children}-${current.infants}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expect(travellerCountsSchema.safeParse(current).success, key).toBe(true);
      for (const type of ['adults', 'children', 'infants'] as const) {
        for (const delta of [1, -1] as const) {
          queue.push(stepTravellers(current, type, delta));
        }
      }
    }
    expect(seen.size).toBeGreaterThan(50);
  });
});
