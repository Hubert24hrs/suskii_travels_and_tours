import { describe, expect, it } from 'vitest';

import { VERTICALS, isVertical, verticalSchema } from './vertical';

describe('vertical', () => {
  it('covers every product vertical from the spec', () => {
    expect(VERTICALS).toEqual(['flights', 'hotels', 'packages', 'tours', 'visa', 'travel_addons']);
  });

  it('uses URL-safe snake_case identifiers', () => {
    for (const vertical of VERTICALS) {
      expect(vertical).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it('narrows known verticals and rejects everything else', () => {
    expect(isVertical('visa')).toBe(true);
    expect(isVertical('cruises')).toBe(false);
    expect(verticalSchema.safeParse('Flights').success).toBe(false);
  });
});
