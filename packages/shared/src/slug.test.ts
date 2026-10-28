import { describe, expect, it } from 'vitest';

import { citySlug } from './slug';

describe('citySlug', () => {
  it('makes URL slugs from city names', () => {
    expect(citySlug('Lagos')).toBe('lagos');
    expect(citySlug('Port Harcourt')).toBe('port-harcourt');
    expect(citySlug('São Tomé')).toBe('sao-tome');
    expect(citySlug("  N'Djamena ")).toBe('n-djamena');
  });
});
