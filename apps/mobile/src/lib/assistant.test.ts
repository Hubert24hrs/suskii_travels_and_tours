import { assistantCardTarget } from './assistant';

const ID = '0192D3A0-7C1E-7B2A-9F00-00000000A501';
const id = ID.toLowerCase();
const WEB = 'https://www.suskii.test';
const target = (href: string) => assistantCardTarget(href, WEB);

describe('assistantCardTarget', () => {
  it("opens the app's own screen for a thing the assistant found or prepared", () => {
    expect(target(`/checkout/${ID}`)).toEqual({ screen: `/checkout/${id}` });
    // A combined trip is the app's trip screen; the app's `/trips/{id}` is a booking.
    expect(target(`/trips/${ID}`)).toEqual({ screen: `/trips/built/${id}` });
    expect(target(`/bookings/${ID}`)).toEqual({ screen: `/trips/${id}` });
    expect(target(`/buses/trips/${ID}`)).toEqual({ screen: `/buses/trips/${id}` });
    expect(target(`/support/${ID}`)).toEqual({ screen: `/support/${id}` });
    expect(target(`/quotes/${ID}`)).toEqual({ screen: `/account/quotes/${id}` });
    expect(target('/packages/zanzibar-beach-escape')).toEqual({
      screen: '/packages/zanzibar-beach-escape',
    });
    expect(target('/tours/lagos-food-walk')).toEqual({ screen: '/tours/lagos-food-walk' });
  });

  it('keeps the dates a rental card carries, and nothing else of its query', () => {
    expect(
      target(
        '/rentals/toyota-corolla?pickupAt=2026-12-10T10%3A00&returnAt=2026-12-17T10%3A00&chauffeur=true&x=1',
      ),
    ).toEqual({
      screen:
        '/rentals/toyota-corolla?pickupAt=2026-12-10T10%3A00&returnAt=2026-12-17T10%3A00&chauffeur=true',
    });
    expect(target('/rentals/toyota-corolla')).toEqual({ screen: '/rentals/toyota-corolla' });
  });

  it('opens Home and the sections of the app for the pages Ask Suskii names', () => {
    // The page that once opened the website in a browser tab.
    expect(target('/')).toEqual({ screen: '/' });
    for (const [href, screen] of [
      ['/flights', '/'],
      ['/hotels', '/'],
      ['/deals', '/deals'],
      ['/prime', '/prime'],
      ['/account', '/account'],
      ['/account/company', '/account/company'],
      ['/account/travellers', '/account'],
      ['/assistant', '/assistant'],
      ['/assistant/preferences', '/assistant/preferences'],
      ['/sign-in', '/sign-in'],
      ['/status', '/status'],
      ['/support', '/support'],
      ['/trips', '/trips/plan'],
      ['/manage-booking', '/trips'],
      ['/quotes', '/account/quotes'],
      ['/flights/groups', '/search/groups'],
      ['/buses', '/buses'],
      ['/rides', '/rides'],
      ['/rentals', '/rentals'],
      ['/packages', '/packages'],
      ['/tours', '/tours'],
      ['/support/', '/support'],
    ] as const) {
      expect([href, target(href)]).toEqual([href, { screen }]);
    }
  });

  it('runs a search the card carries on the app, checked by its own forms', () => {
    const flights = target(
      '/flights/search?trip=one_way&from=LOS&to=ABV&depart=2026-12-10&adults=1',
    );
    expect(flights && 'screen' in flights ? flights.screen : null).toMatch(/^\/search\/flights\?/);
    // A search the forms cannot read opens Home rather than a broken results screen.
    expect(target('/flights/search?from=nowhere')).toEqual({ screen: '/' });
  });

  it('opens the website only for a page the app has no screen for', () => {
    expect(target('/visa/schengen-tourist')).toEqual({ web: `${WEB}/visa/schengen-tourist` });
    expect(target('/travel-add-ons?type=esim')).toEqual({ web: `${WEB}/travel-add-ons?type=esim` });
    expect(target('/flights/lagos-to-london')).toEqual({ web: `${WEB}/flights/lagos-to-london` });
  });

  it('is no link at all for anything that is not a path of the site', () => {
    for (const href of [
      `https://example.com/checkout/${ID}`,
      `//example.com/checkout/${ID}`,
      'javascript:alert(1)',
      'checkout/abc',
      '/sign in',
      '',
    ]) {
      expect([href, target(href)]).toEqual([href, null]);
    }
  });
});
