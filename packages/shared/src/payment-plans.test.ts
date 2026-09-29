import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { money } from './money';
import { defaultRefund, installmentSchedule, type InstallmentPolicy } from './payment-plans';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-01T10:00:30.000Z');
const POLICY: InstallmentPolicy = {
  depositBps: 3000,
  maxInstallments: 3,
  feeBps: 0,
  minSpacingHours: 24,
};

describe('installmentSchedule', () => {
  it('takes a round deposit now and splits the rest evenly before the deadline', () => {
    const schedule = installmentSchedule(
      money(100_000_00n, 'NGN'),
      NOW,
      new Date(NOW.getTime() + 9 * 24 * HOUR),
      POLICY,
    );
    expect(schedule).not.toBeNull();
    const payments = schedule?.payments ?? [];
    expect(payments.map((p) => p.amount.minor)).toEqual([
      30_000_00n,
      23_333_34n,
      23_333_33n,
      23_333_33n,
    ]);
    expect(payments[0]?.dueAt.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(payments[3]?.dueAt.toISOString()).toBe('2026-10-10T10:00:00.000Z');
    expect(schedule?.fee.minor).toBe(0n);
  });

  it('adds the installment fee to the total', () => {
    const schedule = installmentSchedule(
      money(1_000_00n, 'USD'),
      NOW,
      new Date(NOW.getTime() + 3 * 24 * HOUR),
      { ...POLICY, feeBps: 250 },
    );
    expect(schedule?.fee.minor).toBe(25_00n);
    expect(schedule?.total.minor).toBe(1_025_00n);
    // 30% of 1025.00 = 307.50, rounded up to whole dollars.
    expect(schedule?.payments[0]?.amount.minor).toBe(308_00n);
  });

  it('uses fewer installments when the window is short, and none when nothing fits', () => {
    const short = installmentSchedule(
      money(50_000_00n, 'NGN'),
      NOW,
      new Date(NOW.getTime() + 30 * HOUR),
      POLICY,
    );
    expect(short?.payments).toHaveLength(2);
    expect(
      installmentSchedule(
        money(50_000_00n, 'NGN'),
        NOW,
        new Date(NOW.getTime() + 20 * HOUR),
        POLICY,
      ),
    ).toBeNull();
  });

  it('is not offered when the deposit already covers everything', () => {
    expect(
      installmentSchedule(money(5_00n, 'USD'), NOW, new Date(NOW.getTime() + 72 * HOUR), {
        ...POLICY,
        depositBps: 10_000,
      }),
    ).toBeNull();
  });

  it('always adds up exactly, stays within the window and keeps due dates in order', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.constantFrom('NGN', 'USD', 'GHS'),
        fc.integer({ min: 1, max: 60 * 24 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 1_000 }),
        (minor, currency, windowHours, depositBps, maxInstallments, feeBps) => {
          const price = money(minor, currency);
          const lastDueBy = new Date(NOW.getTime() + windowHours * HOUR);
          const policy = { depositBps, maxInstallments, feeBps, minSpacingHours: 24 };
          const schedule = installmentSchedule(price, NOW, lastDueBy, policy);
          if (!schedule) return;
          const paid = schedule.payments.reduce((acc, p) => acc + p.amount.minor, 0n);
          expect(paid).toBe(schedule.total.minor);
          expect(schedule.total.minor).toBe(price.minor + schedule.fee.minor);
          expect(schedule.payments.length).toBeGreaterThanOrEqual(2);
          expect(schedule.payments.length - 1).toBeLessThanOrEqual(maxInstallments);
          for (const [index, payment] of schedule.payments.entries()) {
            expect(payment.amount.minor).toBeGreaterThan(0n);
            expect(payment.dueAt.getTime()).toBeLessThanOrEqual(lastDueBy.getTime());
            const previous = schedule.payments[index - 1];
            if (previous) expect(payment.dueAt.getTime()).toBeGreaterThan(previous.dueAt.getTime());
          }
        },
      ),
    );
  });
});

describe('defaultRefund', () => {
  it('refunds everything with no fee', () => {
    expect(defaultRefund(money(30_000_00n, 'NGN'), 0)).toEqual({
      refund: money(30_000_00n, 'NGN'),
      fee: money(0n, 'NGN'),
    });
  });

  it('rounds the fee down in the traveller favour and never refunds more than was paid', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 10_000 }),
        (minor, bps) => {
          const { refund, fee } = defaultRefund(money(minor, 'NGN'), bps);
          expect(refund.minor + fee.minor).toBe(minor);
          expect(refund.minor).toBeGreaterThanOrEqual(0n);
          expect(fee.minor * 10_000n).toBeLessThanOrEqual(minor * BigInt(bps));
        },
      ),
    );
  });
});
