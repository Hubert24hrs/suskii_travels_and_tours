import { money } from '@suskii/shared';

import { stableDefaultMarkupId } from '../catalog/reference-ids';

import {
  DEFAULT_MARKUP_BPS,
  DEFAULT_MARKUP_NAME,
  DEFAULT_MARKUP_PRIORITY,
  defaultMarkupRules,
  seedDefaultMarkups,
} from './default-markups';
import { MOCK_FX_RATES } from './fx';
import { createConverter } from './fx.service';
import { priceOffer, type MarkupRuleData, type PricingContext } from './pricing-engine';

const fx = createConverter({
  base: 'USD',
  rates: MOCK_FX_RATES,
  asOf: '2026-11-17T00:00:00.000Z',
  provider: 'mock',
});

const context = (vertical: PricingContext['vertical']): PricingContext => ({
  vertical,
  supplier: 'mock',
  channel: 'web',
  userTier: 'guest',
  originCode: 'LOS',
  destinationCode: 'ABV',
  originCountry: 'NG',
  destinationCountry: 'NG',
  carrierCode: 'P4',
  cabinClass: 'economy',
  passengers: 1,
  now: new Date('2026-11-17T12:00:00Z'),
});

/** A default rule as the seed stores it, in the shape the engine reads. */
const asRule = (rule: ReturnType<typeof defaultMarkupRules>[number]): MarkupRuleData => ({
  id: rule.id,
  priority: DEFAULT_MARKUP_PRIORITY,
  active: true,
  vertical: rule.vertical,
  channel: null,
  userTier: null,
  supplier: null,
  originCode: null,
  destinationCode: null,
  originCountry: null,
  destinationCountry: null,
  carrierCode: null,
  cabinClass: null,
  type: 'percentage',
  value: BigInt(rule.valueBps),
  currency: null,
  minAmountMinor: null,
  maxAmountMinor: null,
  validFrom: null,
  validTo: null,
});

/** One NGN 100,000 price with NGN 30,000 of taxes, priced under the default rules. */
const priced = (vertical: PricingContext['vertical'], extra: MarkupRuleData[] = []) =>
  priceOffer({
    price: { base: money(10_000_000n, 'NGN'), taxes: money(3_000_000n, 'NGN') },
    context: context(vertical),
    displayCurrency: 'NGN',
    markupRules: [...extra, ...defaultMarkupRules().map(asRule)],
    feeRules: [],
    taxRules: [],
    fx,
  }).breakdown;

describe('default markups (ADR-124)', () => {
  it('are the owner’s: 2% on flights, 10% on hotels, Cars and everything else, none on Prime', () => {
    expect(DEFAULT_MARKUP_BPS).toEqual({
      flights: 200,
      hotels: 1_000,
      buses: 1_000,
      rides: 1_000,
      rentals: 1_000,
      packages: 1_000,
      tours: 1_000,
      visa: 1_000,
      travel_addons: 1_000,
      assisted: 1_000,
      prime: null,
    });
    expect(defaultMarkupRules().map((rule) => rule.vertical)).not.toContain('prime');
  });

  it('keep one id per vertical for ever, so a release never makes a second rule', () => {
    // Fixed values: a change to the namespace or the name would orphan every rule already seeded.
    expect(stableDefaultMarkupId('flights')).toBe('6a78b5b2-8cb1-5e40-a0b2-69c537a8d493');
    expect(stableDefaultMarkupId('hotels')).toBe('4e6bb892-16e7-5af8-9522-4e4512a9376d');
    const ids = defaultMarkupRules().map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mark up the fare before taxes; the taxes pass on as they are', () => {
    const flight = priced('flights');
    expect(flight.fare).toEqual({ minor: 10_200_000n, currency: 'NGN' });
    expect(flight.taxes).toEqual({ minor: 3_000_000n, currency: 'NGN' });
    expect(flight.total).toEqual({ minor: 13_200_000n, currency: 'NGN' });
    for (const vertical of ['hotels', 'rentals', 'buses', 'tours', 'travel_addons'] as const) {
      expect(priced(vertical).fare).toEqual({ minor: 11_000_000n, currency: 'NGN' });
    }
    // A membership is the owner's own price: nothing is added.
    expect(priced('prime').fare).toEqual({ minor: 10_000_000n, currency: 'NGN' });
  });

  it('give way to any rule staff add, which comes first by priority', () => {
    const [flights] = defaultMarkupRules();
    if (!flights) throw new Error('flights should have a default rule');
    const route = {
      ...asRule(flights),
      id: 'staff-route-rule',
      priority: 100,
      originCode: 'LOS',
      value: 500n,
    };
    expect(priced('flights', [route]).fare).toEqual({ minor: 10_500_000n, currency: 'NGN' });
  });

  describe('seeding', () => {
    /** Just enough of the client: rules by id, and a record of what was written. */
    const fakePrisma = () => {
      const rows = new Map<string, Record<string, unknown>>();
      const markupRule = {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(rows.has(where.id) ? { id: where.id } : null),
        upsert: ({
          where,
          create,
        }: {
          where: { id: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          if (!rows.has(where.id)) rows.set(where.id, { ...create });
          return Promise.resolve(rows.get(where.id));
        },
      };
      return { rows, client: { markupRule } as never };
    };

    it('creates each default once, at the lowest precedence', async () => {
      const { rows, client } = fakePrisma();
      expect(await seedDefaultMarkups(client)).toBe(10);
      const flights = rows.get(stableDefaultMarkupId('flights'));
      expect(flights).toMatchObject({
        name: DEFAULT_MARKUP_NAME,
        vertical: 'flights',
        priority: 10_000,
        active: true,
        type: 'percentage',
        value: 200n,
      });
      expect(await seedDefaultMarkups(client)).toBe(0);
      expect(rows.size).toBe(10);
    });

    it('never overwrites what staff set on a default', async () => {
      const { rows, client } = fakePrisma();
      await seedDefaultMarkups(client);
      const id = stableDefaultMarkupId('hotels');
      rows.set(id, { ...rows.get(id), value: 1_500n, active: false });
      await seedDefaultMarkups(client);
      expect(rows.get(id)).toMatchObject({ value: 1_500n, active: false });
    });
  });
});
