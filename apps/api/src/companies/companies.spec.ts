import { money, type Money } from '@suskii/shared';

import type { ItemPayload } from '../bookings/booking-pricing';
import type { Converter } from '../pricing/fx.service';

import { tripPolicyFacts, toTravelPolicy } from './company-policy';
import { csvCell, productLabel } from './company-trips.service';

const NOW = new Date('2026-11-01T10:00:00Z');

/** One USD is 1,500 NGN; converting rounds as asked. */
const fx = {
  convert(amount: Money, to: string): Money {
    if (amount.currency === to) return amount;
    if (amount.currency === 'NGN' && to === 'USD') {
      return money((amount.minor + 1499n) / 1500n, 'USD');
    }
    return money(amount.minor * 1500n, 'NGN');
  },
} as unknown as Converter;

const hotel = {
  kind: 'hotel',
  hotel: { name: 'Eko Hotel', countryCode: 'NG', cityName: 'Lagos' },
  request: { checkIn: '2026-11-10', checkOut: '2026-11-13', rooms: [{ adults: 1, childAges: [] }] },
} as unknown as ItemPayload;

const airport = (code: string) => ({ code, cityName: code, countryCode: 'NG' });
const flight = (cabins: string[]) =>
  ({
    kind: 'flight',
    offer: {
      slices: [
        {
          origin: airport('LOS'),
          destination: airport('ABV'),
          departureLocal: '2026-11-03T08:00',
          arrivalLocal: '2026-11-03T09:15',
          segments: cabins.map((cabinClass) => ({ cabinClass })),
        },
      ],
    },
  }) as unknown as ItemPayload;

describe('company travel policy facts (ADR-078)', () => {
  it('reads every flight cabin and the days before departure', () => {
    const facts = tripPolicyFacts(
      flight(['economy', 'business']),
      money(9_000_000n, 'NGN'),
      fx,
      null,
      NOW,
    );
    expect(facts).toEqual({
      cabins: ['economy', 'business'],
      nightlyMinor: null,
      daysInAdvance: 2,
    });
  });

  it("prices a stay per night in the cap's currency, rounded up", () => {
    // NGN 450,001.00 over 3 nights is NGN 150,000.34 a night.
    const inNaira = tripPolicyFacts(hotel, money(45_000_100n, 'NGN'), fx, 'NGN', NOW);
    expect(inNaira).toEqual({ cabins: [], nightlyMinor: 15_000_034, daysInAdvance: 9 });
    // The same stay against a dollar cap: USD 300.01 in total, USD 100.01 a night (rounded up).
    const inDollars = tripPolicyFacts(hotel, money(45_000_100n, 'NGN'), fx, 'USD', NOW);
    expect(inDollars.nightlyMinor).toBe(10_001);
  });

  it('has no nightly price without a cap to compare it with', () => {
    expect(tripPolicyFacts(hotel, money(100n, 'NGN'), fx, null, NOW).nightlyMinor).toBeNull();
  });

  it('applies nothing when the company has no policy row', () => {
    expect(toTravelPolicy(null)).toEqual({
      hotelNightlyCapMinor: null,
      hotelNightlyCurrency: null,
      maxCabin: null,
      minAdvanceDays: null,
      approvalMode: 'never',
    });
  });
});

describe('company report CSV', () => {
  it('quotes what needs quoting and never starts a cell with a formula', () => {
    expect(csvCell('LOS-ABV')).toBe('LOS-ABV');
    expect(csvCell('Bello, Funmi')).toBe('"Bello, Funmi"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+2348012345678')).toBe(`"'+2348012345678"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell(150_000)).toBe('150000');
    expect(csvCell(null)).toBe('');
  });

  it('names a trip by its route, hotel or product', () => {
    const base = {
      flight: null,
      hotel: null,
      product: null,
      vertical: 'tours',
    } as unknown as Parameters<typeof productLabel>[0];
    expect(
      productLabel({
        ...base,
        flight: {
          tripType: 'one_way',
          origin: { code: 'LOS', cityName: 'Lagos' },
          destination: { code: 'ABV', cityName: 'Abuja' },
          airline: 'Air Peace',
        },
      }),
    ).toBe('LOS-ABV Air Peace');
    expect(productLabel({ ...base, hotel: { name: 'Eko Hotel', cityName: 'Lagos' } })).toBe(
      'Eko Hotel, Lagos',
    );
    expect(
      productLabel({
        ...base,
        product: { title: 'Lagos walking tour', cityName: 'Lagos', countryCode: 'NG' },
      }),
    ).toBe('Lagos walking tour');
    expect(productLabel(base)).toBe('tours');
  });
});
