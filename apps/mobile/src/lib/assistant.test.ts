import { assistantCardPath } from './assistant';

const ID = '0192D3A0-7C1E-7B2A-9F00-00000000A501';
const id = ID.toLowerCase();

describe('assistantCardPath', () => {
  it("opens the app's own screen for a card it has one for", () => {
    expect(assistantCardPath(`/checkout/${ID}`)).toBe(`/checkout/${id}`);
    // A combined trip is the app's trip screen; the app's `/trips/{id}` is a booking.
    expect(assistantCardPath(`/trips/${ID}`)).toBe(`/trips/built/${id}`);
    expect(assistantCardPath(`/buses/trips/${ID}`)).toBe(`/buses/trips/${id}`);
    expect(assistantCardPath('/packages/zanzibar-beach-escape')).toBe(
      '/packages/zanzibar-beach-escape',
    );
    expect(assistantCardPath('/tours/lagos-food-walk')).toBe('/tours/lagos-food-walk');
  });

  it('leaves every other link to the allowlist of incoming links or the website', () => {
    for (const href of [
      '/checkout/not-a-quote',
      `/trips/${ID}/extra`,
      `/buses/trips/${ID}?seats=2`,
      '/packages/Bad_Slug',
      '/packages/a/b',
      '/tours/',
      `https://example.com/checkout/${ID}`,
      `//example.com/checkout/${ID}`,
      '/rentals/toyota-corolla',
      '/assistant/preferences',
    ]) {
      expect(assistantCardPath(href)).toBeNull();
    }
  });
});
