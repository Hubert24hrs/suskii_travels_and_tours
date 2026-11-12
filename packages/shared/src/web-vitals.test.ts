import { describe, expect, it } from 'vitest';

import { WEB_VITALS_PAGES, webVitalsPage } from './web-vitals';

describe('webVitalsPage', () => {
  it('maps pathnames to their template, literal segments first', () => {
    expect(webVitalsPage('/')).toBe('/');
    expect(webVitalsPage('/flights')).toBe('/flights');
    expect(webVitalsPage('/flights/search')).toBe('/flights/search');
    expect(webVitalsPage('/flights/lagos-to-london')).toBe('/flights/[route]');
    expect(webVitalsPage('/hotels/stay/abc123')).toBe('/hotels/stay/[hotelId]');
    expect(webVitalsPage('/hotels/lagos/')).toBe('/hotels/[city]');
    expect(webVitalsPage('/checkout/01a115b6-a055-75e1-8bba-d44e5aa54399')).toBe(
      '/checkout/[quoteId]',
    );
  });

  it('never keeps ids, slugs or queries and folds account pages into one', () => {
    expect(webVitalsPage('/bookings/01a1?x=1#access=secret')).toBe('/bookings/[bookingId]');
    expect(webVitalsPage('/account/security')).toBe('/account');
    expect(webVitalsPage('/bookings/abc/visa/def')).toBe('other');
    expect(webVitalsPage('/sign-in')).toBe('other');
    expect(webVitalsPage('/no/such/page/here')).toBe('other');
  });

  it('only ever answers a listed template', () => {
    for (const path of ['/', '/x', '/tours/y', '/a/b/c', '']) {
      expect(WEB_VITALS_PAGES).toContain(webVitalsPage(path));
    }
  });
});
