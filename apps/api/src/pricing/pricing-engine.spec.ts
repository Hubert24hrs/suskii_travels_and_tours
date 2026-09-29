import fc from 'fast-check';

import { add, money, subtract, sum, type Money } from '@suskii/shared';

import { MOCK_FX_RATES } from './fx';
import { createConverter } from './fx.service';
import {
  priceOffer,
  type FeeRuleData,
  type MarkupRuleData,
  type PricingContext,
  type PromoData,
} from './pricing-engine';

const fx = createConverter({
  base: 'USD',
  rates: MOCK_FX_RATES,
  asOf: '2026-09-29T00:00:00.000Z',
  provider: 'mock',
});
const NOW = new Date('2026-10-01T12:00:00Z');

const context = (overrides: Partial<PricingContext> = {}): PricingContext => ({
  vertical: 'flights',
  supplier: 'mock',
  channel: 'web',
  userTier: 'guest',
  originCode: 'LOS',
  destinationCode: 'LHR',
  originCountry: 'NG',
  destinationCountry: 'GB',
  carrierCode: 'BA',
  cabinClass: 'economy',
  passengers: 2,
  now: NOW,
  ...overrides,
});

const markup = (overrides: Partial<MarkupRuleData> = {}): MarkupRuleData => ({
  id: 'markup-1',
  priority: 100,
  active: true,
  vertical: 'flights',
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
  value: 500n,
  currency: null,
  minAmountMinor: null,
  maxAmountMinor: null,
  validFrom: null,
  validTo: null,
  ...overrides,
});

const fee = (overrides: Partial<FeeRuleData> = {}): FeeRuleData => ({
  id: 'fee-1',
  code: 'service_fee',
  label: 'Service fee',
  sortOrder: 0,
  active: true,
  vertical: 'flights',
  channel: null,
  userTier: null,
  type: 'fixed',
  value: 250_000n,
  currency: 'NGN',
  basis: 'per_booking',
  minAmountMinor: null,
  maxAmountMinor: null,
  validFrom: null,
  validTo: null,
  ...overrides,
});

const promo = (overrides: Partial<PromoData> = {}): PromoData => ({
  id: 'promo-1',
  code: 'SAVE10',
  type: 'percentage',
  value: 1000n,
  currency: 'NGN',
  maxDiscountMinor: null,
  minSpendMinor: null,
  verticals: [],
  validFrom: null,
  validTo: null,
  maxRedemptions: null,
  maxRedemptionsPerUser: null,
  requiresAccount: false,
  active: true,
  ...overrides,
});

// USD 400.00 base + USD 100.00 taxes. Mock rate: 1 USD = 1550 NGN.
const usdPrice = { base: money(40_000n, 'USD'), taxes: money(10_000n, 'USD') };
const ngn = (major: number): Money => money(BigInt(Math.round(major * 100)), 'NGN');

const run = (overrides: Partial<Parameters<typeof priceOffer>[0]> = {}) =>
  priceOffer({
    price: usdPrice,
    context: context(),
    displayCurrency: 'NGN',
    markupRules: [],
    feeRules: [],
    fx,
    ...overrides,
  });

describe('priceOffer', () => {
  it('converts supplier prices line by line with no rules', () => {
    const { breakdown, promo: promoResult } = run();
    expect(breakdown.fare).toEqual(ngn(620_000));
    expect(breakdown.taxes).toEqual(ngn(155_000));
    expect(breakdown.total).toEqual(ngn(775_000));
    expect(breakdown.fees).toEqual([]);
    expect(breakdown.markup).toBeNull();
    expect(breakdown.supplierTotal).toEqual(money(50_000n, 'USD'));
    expect(breakdown.fx).toEqual({
      from: 'USD',
      to: 'NGN',
      rate: '1550',
      asOf: '2026-09-29T00:00:00.000Z',
      provider: 'mock',
    });
    expect(promoResult).toBeNull();
  });

  it('applies the first matching markup by priority and never stacks', () => {
    const rules = [
      markup({ id: 'other-route', priority: 1, destinationCode: 'JFK', value: 5000n }),
      markup({ id: 'ba-5pct', priority: 10, carrierCode: 'BA', value: 500n }),
      markup({ id: 'catch-all', priority: 50, value: 1000n }),
    ];
    const { breakdown } = run({ markupRules: rules });
    expect(breakdown.markup?.ruleId).toBe('ba-5pct');
    // 5% of USD 400 = USD 20 = NGN 31,000.
    expect(breakdown.fare).toEqual(ngn(651_000));
    expect(breakdown.markup?.amount).toEqual(ngn(31_000));
  });

  it('matches channel, tier, cabin, countries, supplier and validity windows', () => {
    const cases: [Partial<MarkupRuleData>, boolean][] = [
      [{ channel: 'mobile' }, false],
      [{ channel: 'web' }, true],
      [{ userTier: 'member' }, false],
      [{ cabinClass: 'business' }, false],
      [{ originCountry: 'NG', destinationCountry: 'GB' }, true],
      [{ supplier: 'duffel' }, false],
      [{ validFrom: new Date('2026-10-02T00:00:00Z') }, false],
      [{ validTo: new Date('2026-10-01T12:00:00Z') }, false],
      [{ validTo: new Date('2026-10-01T12:00:01Z') }, true],
      [{ active: false }, false],
      [{ vertical: 'hotels' }, false],
    ];
    for (const [overrides, applies] of cases) {
      const { breakdown } = run({ markupRules: [markup(overrides)] });
      expect([overrides, breakdown.markup !== null]).toEqual([overrides, applies]);
    }
  });

  it('converts fixed markups and clamps percentage markups to their caps', () => {
    const fixed = run({
      markupRules: [markup({ type: 'fixed', value: 1_550_000n, currency: 'NGN' })],
    });
    // NGN 15,500 = USD 10.
    expect(fixed.breakdown.fare).toEqual(ngn(635_500));

    const capped = run({
      markupRules: [markup({ value: 5000n, currency: 'USD', maxAmountMinor: 2500n })],
    });
    expect(capped.breakdown.markup?.amount).toEqual(ngn(38_750)); // capped at USD 25

    const floored = run({
      markupRules: [markup({ value: 1n, currency: 'NGN', minAmountMinor: 775_000n })],
    });
    expect(floored.breakdown.markup?.amount).toEqual(ngn(7_750)); // at least NGN 7,750
  });

  it('never lets a negative markup push the fare below zero', () => {
    const { breakdown } = run({ markupRules: [markup({ value: -20_000n })] });
    expect(breakdown.fare).toEqual(ngn(0));
    expect(breakdown.total).toEqual(breakdown.taxes);
  });

  it('adds every matching fee, per booking or per passenger, with caps', () => {
    const { breakdown } = run({
      feeRules: [
        fee({ id: 'svc', code: 'service_fee', value: 250_000n }),
        fee({
          id: 'pax',
          code: 'ticketing_fee',
          label: 'Ticketing fee',
          value: 100_000n,
          basis: 'per_passenger',
          sortOrder: 1,
        }),
        fee({
          id: 'pct',
          code: 'card_fee',
          label: 'Card fee',
          type: 'percentage',
          value: 150n,
          currency: 'NGN',
          maxAmountMinor: 500_000n,
          sortOrder: 2,
        }),
        fee({ id: 'app', code: 'app_only', channel: 'mobile' }),
      ],
    });
    expect(breakdown.fees.map((f) => [f.code, f.amount.minor])).toEqual([
      ['service_fee', 250_000n],
      ['ticketing_fee', 200_000n], // NGN 1,000 x 2 passengers
      ['card_fee', 500_000n], // 1.5% of NGN 775,000 = 11,625, capped at 5,000
    ]);
    expect(breakdown.total).toEqual(ngn(775_000 + 2500 + 2000 + 5000));
  });

  it('applies percentage and fixed promos to fare and fees but never to taxes', () => {
    const percentage = run({
      feeRules: [fee()],
      promo: { data: promo({ maxDiscountMinor: 5_000_000n }), usage: { total: 0, byUser: 0 } },
    });
    // 10% of (620,000 + 2,500) = 62,250, under the NGN 50,000 cap? No: capped at 50,000.
    expect(percentage.promo).toEqual({ status: 'applied' });
    expect(percentage.breakdown.discount).toEqual({ code: 'SAVE10', amount: ngn(50_000) });

    const fixed = run({
      promo: {
        data: promo({ type: 'fixed', value: 10_000_000_000n }),
        usage: { total: 0, byUser: 0 },
      },
    });
    // A huge fixed promo is capped at fare + fees; taxes are still paid.
    expect(fixed.breakdown.discount?.amount).toEqual(ngn(620_000));
    expect(fixed.breakdown.total).toEqual(ngn(155_000));
  });

  it('rejects promos that are not eligible, with a reason', () => {
    const usage = { total: 0, byUser: 0 };
    const reason = (
      data: Partial<PromoData>,
      extra: Partial<Parameters<typeof priceOffer>[0]> = {},
      u = usage,
    ) => run({ promo: { data: promo(data), usage: u }, ...extra }).promo;
    expect(reason({ active: false })).toEqual({ status: 'rejected', reason: 'inactive' });
    expect(reason({ validFrom: new Date('2026-11-01') })).toEqual({
      status: 'rejected',
      reason: 'not_started',
    });
    expect(reason({ validTo: new Date('2026-09-01') })).toEqual({
      status: 'rejected',
      reason: 'expired',
    });
    expect(reason({ verticals: ['hotels'] })).toEqual({ status: 'rejected', reason: 'vertical' });
    expect(reason({ requiresAccount: true })).toEqual({
      status: 'rejected',
      reason: 'account_required',
    });
    expect(reason({ requiresAccount: true }, { context: context({ userTier: 'member' }) })).toEqual(
      { status: 'applied' },
    );
    expect(reason({ minSpendMinor: 100_000_000n })).toEqual({
      status: 'rejected',
      reason: 'min_spend',
    });
    expect(reason({ maxRedemptions: 5 }, {}, { total: 5, byUser: 0 })).toEqual({
      status: 'rejected',
      reason: 'exhausted',
    });
    expect(reason({ maxRedemptionsPerUser: 1 }, {}, { total: 1, byUser: 1 })).toEqual({
      status: 'rejected',
      reason: 'user_limit',
    });
    expect(run({ promo: { data: promo({ active: false }), usage } }).breakdown.discount).toBeNull();
  });

  it('prices in the supplier currency without an FX line', () => {
    const { breakdown } = run({ displayCurrency: 'USD' });
    expect(breakdown.total).toEqual(money(50_000n, 'USD'));
    expect(breakdown.fx).toBeNull();
  });
});

describe('priceOffer properties', () => {
  const currency = fc.constantFrom('NGN', 'USD', 'GBP', 'EUR', 'KES', 'GHS', 'ZAR');
  const scenario = fc.record({
    base: fc.bigInt({ min: 0n, max: 10n ** 9n }),
    taxes: fc.bigInt({ min: 0n, max: 10n ** 8n }),
    supplierCurrency: currency,
    displayCurrency: currency,
    markupBps: fc.bigInt({ min: -5000n, max: 5000n }),
    markupCap: fc.option(fc.bigInt({ min: 0n, max: 10n ** 7n }), { nil: null }),
    feeFixed: fc.bigInt({ min: 0n, max: 10n ** 7n }),
    feeBps: fc.bigInt({ min: 0n, max: 1000n }),
    passengers: fc.integer({ min: 1, max: 9 }),
    promoType: fc.constantFrom<'percentage' | 'fixed'>('percentage', 'fixed'),
    promoValue: fc.bigInt({ min: 0n, max: 10n ** 9n }),
    promoCap: fc.option(fc.bigInt({ min: 0n, max: 10n ** 8n }), { nil: null }),
  });

  it('always adds up, never discounts taxes, and never goes negative', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { breakdown } = priceOffer({
          price: {
            base: money(s.base, s.supplierCurrency),
            taxes: money(s.taxes, s.supplierCurrency),
          },
          context: context({ passengers: s.passengers }),
          displayCurrency: s.displayCurrency,
          markupRules: [
            markup({
              value: s.markupBps,
              currency: s.supplierCurrency,
              maxAmountMinor: s.markupCap,
            }),
          ],
          feeRules: [
            fee({ value: s.feeFixed, currency: s.displayCurrency, basis: 'per_passenger' }),
            fee({ id: 'pct', code: 'pct', type: 'percentage', value: s.feeBps }),
          ],
          promo: {
            data: promo({
              type: s.promoType,
              value: s.promoType === 'percentage' ? s.promoValue % 10_001n : s.promoValue,
              currency: s.displayCurrency,
              maxDiscountMinor: s.promoCap,
            }),
            usage: { total: 0, byUser: 0 },
          },
          fx,
        });
        const all = [
          breakdown.fare,
          breakdown.taxes,
          breakdown.total,
          ...breakdown.fees.map((f) => f.amount),
        ];
        expect(all.every((amount) => amount.currency === s.displayCurrency)).toBe(true);
        const feeTotal = sum(
          s.displayCurrency,
          breakdown.fees.map((f) => f.amount),
        );
        const discount = breakdown.discount?.amount ?? money(0n, s.displayCurrency);
        expect(breakdown.total).toEqual(
          subtract(add(add(breakdown.fare, breakdown.taxes), feeTotal), discount),
        );
        expect(discount.minor >= 0n).toBe(true);
        expect(breakdown.fare.minor >= 0n).toBe(true);
        expect(breakdown.total.minor >= breakdown.taxes.minor).toBe(true);
        if (s.markupCap !== null && breakdown.markup) {
          expect(
            breakdown.markup.amount.minor <=
              fx.convert(money(s.markupCap, s.supplierCurrency), s.displayCurrency).minor,
          ).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });
});
