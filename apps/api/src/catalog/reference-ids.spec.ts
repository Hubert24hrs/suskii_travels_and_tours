import { z } from 'zod';

import { stableCityId } from './reference-ids';

describe('stableCityId', () => {
  it('gives a city the same id every time, in every database', () => {
    // Pinned: changing the rule would strand every id a phone or a browser already keeps.
    expect(stableCityId('NG', 'Jos')).toBe(stableCityId('NG', 'Jos'));
    expect(stableCityId('NG', 'Jos')).toBe('7fe2e782-e113-57bb-8918-680c6f55b986');
  });

  it('tells cities of one name apart by country, and ignores the case of the country code', () => {
    expect(stableCityId('GB', 'London')).not.toBe(stableCityId('CA', 'London'));
    expect(stableCityId('gb', 'London')).toBe(stableCityId('GB', 'London'));
    expect(stableCityId('NG', 'Jos')).not.toBe(stableCityId('NG', 'Lagos'));
  });

  it('is a UUID the API contracts accept', () => {
    const id = stableCityId('NG', 'Lagos');
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(id[14]).toBe('5');
  });
});
