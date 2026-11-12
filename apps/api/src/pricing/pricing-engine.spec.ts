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
  type TaxRuleData,
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

const tax = (overrides: Partial<TaxRuleData> = {}): TaxRuleData => ({
  id: 'tax-1',
  code: 'vat',
  label: 'VAT',
  rateBps: 750,
  basis: 'margin',
  vertical: null,
  active: true,
  registrationNumber: 'TIN 01234567-0001',
  validFrom: null,
  validTo: null,
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
    taxBps: fc.integer({ min: 0, max: 3000 }),
    taxBasis: fc.constantFrom<'margin' | 'full'>('margin', 'full'),
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
          taxRules: [tax({ rateBps: s.taxBps, basis: s.taxBasis })],
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
        const serviceTax = sum(
          s.displayCurrency,
          breakdown.serviceTaxes.map((line) => line.amount),
        );
        expect(breakdown.serviceTaxes.every((line) => line.amount.minor > 0n)).toBe(true);
        expect(breakdown.total).toEqual(
          subtract(add(add(add(breakdown.fare, breakdown.taxes), feeTotal), serviceTax), discount),
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

describe('service taxes (ADR-072)', () => {
  // Markup 5% of USD 400 = USD 20 (NGN 31,000); fare NGN 651,000; supplier taxes NGN 155,000;
  // service fee NGN 2,500.
  const priced = (taxRules: TaxRuleData[], extra: Partial<Parameters<typeof priceOffer>[0]> = {}) =>
    run({ markupRules: [markup()], feeRules: [fee()], taxRules, ...extra }).breakdown;

  it('leaves every price as it was without tax rules', () => {
    const breakdown = priced([]);
    expect(breakdown.serviceTaxes).toEqual([]);
    expect(breakdown.total).toEqual(ngn(808_500));
  });

  it('taxes only the margin and fees of an agent booking, inside the total', () => {
    const breakdown = priced([tax()]);
    // 7.5% of NGN 33,500 (markup 31,000 + fee 2,500).
    expect(breakdown.serviceTaxes).toEqual([
      {
        code: 'vat',
        label: 'VAT',
        rateBps: 750,
        amount: ngn(2_512.5),
        registrationNumber: 'TIN 01234567-0001',
      },
    ]);
    expect(breakdown.total).toEqual(ngn(811_012.5));
    expect(breakdown.taxes).toEqual(ngn(155_000));
  });

  it('taxes fare and fees of what Suskii sells as principal, never the supplier taxes', () => {
    const breakdown = priced([tax({ basis: 'full' })]);
    // 7.5% of NGN 653,500 (fare 651,000 + fee 2,500).
    expect(breakdown.serviceTaxes[0]?.amount).toEqual(ngn(49_012.5));
    expect(breakdown.total).toEqual(ngn(857_512.5));
  });

  it('taxes what is left after a promo, and drops a line with nothing to tax', () => {
    const withPromo = { promo: { data: promo(), usage: { total: 0, byUser: 0 } } };
    // 10% off NGN 653,500 = NGN 65,350: more than the margin, so no margin tax.
    expect(priced([tax()], withPromo).serviceTaxes).toEqual([]);
    const full = priced([tax({ basis: 'full' })], withPromo);
    expect(full.discount?.amount).toEqual(ngn(65_350));
    expect(full.serviceTaxes[0]?.amount).toEqual(ngn(44_111.25));
    expect(full.total).toEqual(ngn(808_500 - 65_350 + 44_111.25));
  });

  it('applies every rule in force for the vertical, and only those', () => {
    const breakdown = priced([
      tax(),
      tax({ id: 'levy', code: 'levy', label: 'Tourism levy', rateBps: 100, basis: 'full' }),
      tax({ id: 'hotels', code: 'hotel_vat', vertical: 'hotels' }),
      tax({ id: 'flights', code: 'flight_vat', vertical: 'flights', rateBps: 0 }),
      tax({ id: 'old', code: 'old', validTo: new Date('2026-09-30T00:00:00Z') }),
      tax({ id: 'later', code: 'later', validFrom: new Date('2026-12-01T00:00:00Z') }),
    ]);
    expect(breakdown.serviceTaxes.map((line) => [line.code, line.amount])).toEqual([
      ['vat', ngn(2_512.5)],
      ['levy', ngn(6_535)],
    ]);
    expect(breakdown.total).toEqual(ngn(808_500 + 2_512.5 + 6_535));
  });

  it('rounds each line half up to the minor unit', () => {
    // A fee of NGN 0.07 alone: 7.5% of 7 kobo is 0.525 kobo, so 1 kobo.
    const breakdown = run({
      feeRules: [fee({ value: 7n })],
      taxRules: [tax()],
    }).breakdown;
    expect(breakdown.serviceTaxes[0]?.amount).toEqual(money(1n, 'NGN'));
  });
});

describe('Suskii Prime member pricing (ADR-030)', () => {
  const benefits = {
    markupShareBps: 5_000,
    waivedFeeCodes: ['service_fee'],
    prioritySupport: true,
  };
  const rules = {
    markupRules: [markup({ value: 1_000n })], // 10% of USD 400 = USD 40
    feeRules: [fee(), fee({ id: 'fee-2', code: 'card_fee', label: 'Card fee', value: 50_000n })],
  };

  it('gives back the share of the markup, waives listed fees and reports the saving', () => {
    const member = run({ ...rules, context: context({ userTier: 'member' }) });
    const prime = run({ ...rules, context: context({ userTier: 'prime', benefits }) });
    // USD 440 for members, USD 420 for Prime (half the USD 40 markup back).
    expect(member.breakdown.fare).toEqual(ngn(682_000));
    expect(prime.breakdown.fare).toEqual(ngn(651_000));
    expect(prime.breakdown.fees.map((f) => f.code)).toEqual(['card_fee']);
    expect(prime.breakdown.memberSaving).toEqual(ngn(31_000 + 2_500));
    expect(subtract(member.breakdown.total, prime.breakdown.total)).toEqual(
      prime.breakdown.memberSaving,
    );
    expect(member.breakdown.memberSaving).toBeNull();
    // The margin kept is internal and smaller by the saving.
    expect(prime.breakdown.markup?.amount).toEqual(ngn(31_000));
  });

  it('ignores benefits without the prime tier and counts member-only rules as savings', () => {
    const notPrime = run({ ...rules, context: context({ userTier: 'member', benefits }) });
    expect(notPrime.breakdown.fees).toHaveLength(2);
    expect(notPrime.breakdown.memberSaving).toBeNull();

    // A Prime-only markup of 5% (instead of 10%) with no share and no waivers.
    const tiered = run({
      markupRules: [markup({ id: 'prime', priority: 1, userTier: 'prime', value: 500n }), markup()],
      context: context({
        userTier: 'prime',
        benefits: { markupShareBps: 0, waivedFeeCodes: [], prioritySupport: false },
      }),
    });
    const regular = run({
      markupRules: [markup({ id: 'prime', priority: 1, userTier: 'prime', value: 500n }), markup()],
      context: context({ userTier: 'member' }),
    });
    expect(tiered.breakdown.memberSaving).toEqual(
      subtract(regular.breakdown.total, tiered.breakdown.total),
    );
  });

  it('applies promos after member pricing and leaves the saving pre-promo', () => {
    const prime = run({
      ...rules,
      context: context({ userTier: 'prime', benefits }),
      promo: { data: promo(), usage: { total: 0, byUser: 0 } },
    });
    expect(prime.promo).toEqual({ status: 'applied' });
    // 10% off fare + remaining fees.
    expect(prime.breakdown.discount?.amount).toEqual(ngn((651_000 + 500) / 10));
    expect(prime.breakdown.memberSaving).toEqual(ngn(33_500));
  });

  it('never prices a member below the supplier cost, whatever the plan says', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.bigInt({ min: -5_000n, max: 5_000n }),
        fc.integer({ min: 0, max: 10_000 }),
        (base, markupBps, shareBps) => {
          const prime = priceOffer({
            price: { base: money(base, 'NGN'), taxes: money(0n, 'NGN') },
            context: context({
              userTier: 'prime',
              benefits: { markupShareBps: shareBps, waivedFeeCodes: [], prioritySupport: false },
            }),
            displayCurrency: 'NGN',
            markupRules: [markup({ value: markupBps })],
            feeRules: [],
            fx,
          });
          const member = priceOffer({
            price: { base: money(base, 'NGN'), taxes: money(0n, 'NGN') },
            context: context({ userTier: 'member' }),
            displayCurrency: 'NGN',
            markupRules: [markup({ value: markupBps })],
            feeRules: [],
            fx,
          });
          // A positive markup is shared; a discount (negative markup) is never deepened.
          expect(prime.breakdown.fare.minor >= (markupBps >= 0n ? base : 0n)).toBe(true);
          expect(prime.breakdown.fare.minor <= member.breakdown.fare.minor).toBe(true);
          expect(prime.breakdown.memberSaving?.minor).toBe(
            member.breakdown.total.minor - prime.breakdown.total.minor,
          );
        },
      ),
    );
  });
});
