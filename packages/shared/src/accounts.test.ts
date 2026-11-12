import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  alertEndsOn,
  defaultPreference,
  isMandatoryChannel,
  memberMarkupSaving,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  parseReferralCode,
  primeTermEnd,
  resolvePreferences,
  shouldNotifyPrice,
} from './accounts';
import { priceAlertInputSchema, primeBenefitsSchema } from './accounts-schemas';
import { money } from './money';

describe('memberMarkupSaving', () => {
  it('gives back the share of the markup, rounded down', () => {
    expect(memberMarkupSaving(money(10_001n, 'NGN'), 5_000)).toEqual(money(5_000n, 'NGN'));
    expect(memberMarkupSaving(money(10_000n, 'NGN'), 10_000)).toEqual(money(10_000n, 'NGN'));
    expect(memberMarkupSaving(money(10_000n, 'NGN'), 0)).toEqual(money(0n, 'NGN'));
    expect(memberMarkupSaving(money(0n, 'NGN'), 5_000)).toEqual(money(0n, 'NGN'));
  });

  it('never exceeds the markup or goes negative, so a member never pays below cost', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000_000n, max: 10n ** 12n }),
        fc.integer({ min: -5_000, max: 20_000 }),
        (markupMinor, shareBps) => {
          const saving = memberMarkupSaving(money(markupMinor, 'NGN'), shareBps);
          expect(saving.minor >= 0n).toBe(true);
          expect(saving.minor <= (markupMinor > 0n ? markupMinor : 0n)).toBe(true);
        },
      ),
    );
  });
});

describe('primeTermEnd', () => {
  it('adds a calendar month or year at the same instant', () => {
    expect(primeTermEnd(new Date('2026-10-05T12:00:00Z'), 'month').toISOString()).toBe(
      '2026-11-05T12:00:00.000Z',
    );
    expect(primeTermEnd(new Date('2026-10-05T12:00:00Z'), 'year').toISOString()).toBe(
      '2027-10-05T12:00:00.000Z',
    );
  });

  it('clamps to the end of shorter months', () => {
    expect(primeTermEnd(new Date('2026-01-31T08:00:00Z'), 'month').toISOString()).toBe(
      '2026-02-28T08:00:00.000Z',
    );
    expect(primeTermEnd(new Date('2028-02-29T08:00:00Z'), 'year').toISOString()).toBe(
      '2029-02-28T08:00:00.000Z',
    );
  });
});

describe('notification preferences', () => {
  it('defaults: email but not marketing, push for what travellers wait on, SMS off', () => {
    expect(defaultPreference('booking', 'email')).toBe(true);
    expect(defaultPreference('price_alert', 'push')).toBe(true);
    expect(defaultPreference('booking', 'sms')).toBe(false);
    expect(defaultPreference('marketing', 'email')).toBe(false);
    expect(defaultPreference('prime', 'push')).toBe(false);
  });

  it('keeps booking and payment email on whatever is stored', () => {
    const matrix = resolvePreferences([
      { category: 'booking', channel: 'email', enabled: false },
      { category: 'payment', channel: 'email', enabled: false },
      { category: 'price_alert', channel: 'email', enabled: false },
      { category: 'booking', channel: 'whatsapp', enabled: true },
    ]);
    expect(matrix.booking.email).toBe(true);
    expect(matrix.payment.email).toBe(true);
    expect(matrix.price_alert.email).toBe(false);
    expect(matrix.booking.whatsapp).toBe(true);
    expect(matrix.marketing.email).toBe(false);
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const channel of NOTIFICATION_CHANNELS) {
        if (isMandatoryChannel(category, channel)) expect(matrix[category][channel]).toBe(true);
      }
    }
  });
});

describe('referral codes', () => {
  it('normalises typed codes and refuses look-alike characters', () => {
    expect(parseReferralCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(parseReferralCode('ABCD EFG2')).toBe('ABCDEFG2');
    expect(parseReferralCode('ABCDEFG0')).toBeNull();
    expect(parseReferralCode('ABCDEFGL')).toBeNull();
    expect(parseReferralCode('ABCDEFG')).toBeNull();
  });
});

describe('price alerts', () => {
  const day = 86_400_000;
  const now = new Date('2026-10-05T12:00:00Z');
  const base = {
    targetMinor: null,
    lastNotifiedMinor: null,
    lastNotifiedAt: null,
    minDropBps: 500,
    now,
  };

  it('watches until the departure date or the end of the month', () => {
    expect(alertEndsOn({ departureDate: '2026-12-10' })).toBe('2026-12-10');
    expect(alertEndsOn({ departureMonth: '2027-02' })).toBe('2027-02-28');
  });

  it('notifies at the target, then only on a further drop', () => {
    expect(shouldNotifyPrice({ ...base, priceMinor: 90_000n, targetMinor: 100_000n })).toBe(true);
    expect(
      shouldNotifyPrice({
        ...base,
        priceMinor: 90_000n,
        targetMinor: 100_000n,
        lastNotifiedMinor: 90_000n,
        lastNotifiedAt: new Date(now.getTime() - 2 * day),
      }),
    ).toBe(false);
    expect(shouldNotifyPrice({ ...base, priceMinor: 110_000n, targetMinor: 100_000n })).toBe(false);
  });

  it('notifies on a big enough drop since the last notice, at most once a day', () => {
    const last = { lastNotifiedMinor: 100_000n, lastNotifiedAt: new Date(now.getTime() - 2 * day) };
    expect(shouldNotifyPrice({ ...base, ...last, priceMinor: 95_000n })).toBe(true);
    expect(shouldNotifyPrice({ ...base, ...last, priceMinor: 96_000n })).toBe(false);
    expect(
      shouldNotifyPrice({
        ...base,
        lastNotifiedMinor: 100_000n,
        lastNotifiedAt: new Date(now.getTime() - day / 2),
        priceMinor: 50_000n,
      }),
    ).toBe(false);
    // The first check of an alert without a target only records the price.
    expect(shouldNotifyPrice({ ...base, priceMinor: 50_000n })).toBe(false);
  });

  it('validates the route and exactly one of a date or a month', () => {
    const ok = priceAlertInputSchema.safeParse({
      origin: 'los',
      destination: 'LHR',
      departureMonth: '2026-12',
      currency: 'NGN',
    });
    expect(ok.success && ok.data).toMatchObject({
      origin: 'LOS',
      departureDate: null,
      cabinClass: 'economy',
      targetMinor: null,
    });
    for (const bad of [
      { origin: 'LOS', destination: 'LOS', departureMonth: '2026-12', currency: 'NGN' },
      { origin: 'LOS', destination: 'LHR', currency: 'NGN' },
      {
        origin: 'LOS',
        destination: 'LHR',
        departureMonth: '2026-12',
        departureDate: '2026-12-10',
        currency: 'NGN',
      },
    ]) {
      expect(priceAlertInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('caps plan benefits to sane values', () => {
    expect(
      primeBenefitsSchema.safeParse({
        markupShareBps: 2_500,
        waivedFeeCodes: ['service'],
        prioritySupport: true,
      }).success,
    ).toBe(true);
    expect(
      primeBenefitsSchema.safeParse({
        markupShareBps: 12_000,
        waivedFeeCodes: [],
        prioritySupport: false,
      }).success,
    ).toBe(false);
  });
});
