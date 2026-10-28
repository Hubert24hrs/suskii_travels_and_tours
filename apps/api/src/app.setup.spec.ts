import { compressible } from './app.setup';

describe('origin compression (ADR-075)', () => {
  it('compresses public search, catalog and content reads', () => {
    for (const path of [
      '/v1/flights/searches',
      '/v1/flights/searches/fs_0123456789abcdef/offers',
      '/v1/flights/offers/fs_0123456789abcdef.a1',
      '/v1/hotels/searches',
      '/v1/hotels/searches/hs_0123456789abcdef/hotels',
      '/v1/hotels/results/hs_0123456789abcdef.h1',
      '/v1/catalog/places',
      '/v1/content/home',
      '/v1/deals',
      '/v1/destinations/lagos',
    ])
      expect(compressible(path)).toBe(true);
  });

  it('never compresses answers that can hold a token or personal data', () => {
    for (const path of [
      '/v1/me',
      '/v1/auth/login',
      '/v1/auth/refresh',
      '/v1/bookings',
      '/v1/bookings/0192d3a0-7c1e-7b2a-9f00-000000000001',
      '/v1/flights/offers/fs_0123456789abcdef.a1/quote',
      '/v1/hotels/rates/hs_0123456789abcdef.h1.r1/quote',
      '/v1/payments/webhooks/paystack',
      '/v1/admin/bookings',
      '/v1/go/token',
      '/v1/catalog',
      '/v1/flights/searches/fs_0123456789abcdef/offers/extra',
    ])
      expect(compressible(path)).toBe(false);
  });
});
