import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addonUnits,
  cancellationRefund,
  coveredDays,
  formatVoucherCode,
  parseVoucherCode,
  perPersonTotal,
  refundBpsFor,
  safeFileName,
  sniffDocumentType,
  VOUCHER_QR_PREFIX,
  type CancellationTier,
} from './inhouse';
import {
  cancellationPolicySchema,
  perPersonPricesSchema,
  visaChecklistSchema,
} from './inhouse-schemas';
import { money } from './money';
import { addDays } from './time';

const POLICY: CancellationTier[] = [
  { daysBefore: 7, refundBps: 5_000 },
  { daysBefore: 30, refundBps: 10_000 },
  { daysBefore: 2, refundBps: 0 },
];

describe('cancellation policies', () => {
  it('applies the first tier whose notice period is covered', () => {
    const start = '2026-12-10';
    expect(refundBpsFor(POLICY, start, '2026-11-01')).toBe(10_000);
    expect(refundBpsFor(POLICY, start, '2026-11-10')).toBe(10_000);
    expect(refundBpsFor(POLICY, start, '2026-11-11')).toBe(5_000);
    expect(refundBpsFor(POLICY, start, '2026-12-03')).toBe(5_000);
    expect(refundBpsFor(POLICY, start, '2026-12-04')).toBe(0);
    expect(refundBpsFor(POLICY, start, '2026-12-10')).toBe(0);
    expect(refundBpsFor(POLICY, start, '2026-12-11')).toBe(0);
  });

  it('never refunds more than was paid, and more notice never refunds less', () => {
    const tiers = fc
      .uniqueArray(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 6 })
      .chain((days) =>
        fc
          .array(fc.integer({ min: 0, max: 10_000 }), {
            minLength: days.length,
            maxLength: days.length,
          })
          .map((shares) => {
            // A valid policy: sorted shares assigned to sorted notice periods.
            const sortedDays = [...days].sort((a, b) => b - a);
            const sortedShares = [...shares].sort((a, b) => b - a);
            return sortedDays.map((daysBefore, index) => ({
              daysBefore,
              refundBps: sortedShares[index] ?? 0,
            }));
          }),
      );
    fc.assert(
      fc.property(
        tiers,
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 1, max: 5_000_000_00 }),
        (policy, noticeDays, paidMinor) => {
          expect(cancellationPolicySchema.safeParse(policy).success).toBe(true);
          const start = '2027-03-01';
          const earlier = refundBpsFor(policy, start, addDays(start, -(noticeDays + 1)));
          const later = refundBpsFor(policy, start, addDays(start, -noticeDays));
          expect(earlier).toBeGreaterThanOrEqual(later);
          const paid = money(paidMinor, 'NGN');
          const refund = cancellationRefund(paid, later);
          expect(refund.minor).toBeLessThanOrEqual(paid.minor);
          expect(refund.minor).toBeGreaterThanOrEqual(0n);
        },
      ),
    );
  });

  it('rounds refunds down and ignores nonsense shares', () => {
    expect(cancellationRefund(money(999, 'NGN'), 5_000).minor).toBe(499n);
    expect(cancellationRefund(money(1_000, 'NGN'), 20_000).minor).toBe(1_000n);
    expect(cancellationRefund(money(1_000, 'NGN'), -5).minor).toBe(0n);
  });

  it('rejects policies where later cancellation refunds more, or tiers repeat', () => {
    expect(
      cancellationPolicySchema.safeParse([
        { daysBefore: 30, refundBps: 5_000 },
        { daysBefore: 7, refundBps: 8_000 },
      ]).success,
    ).toBe(false);
    expect(
      cancellationPolicySchema.safeParse([
        { daysBefore: 7, refundBps: 5_000 },
        { daysBefore: 7, refundBps: 0 },
      ]).success,
    ).toBe(false);
  });
});

describe('per-person prices', () => {
  const prices = {
    adult: money(100_000_00, 'NGN'),
    child: money(60_000_00, 'NGN'),
    infant: null,
  };

  it('adds up each traveller type', () => {
    expect(perPersonTotal(prices, { adults: 2, children: 1, infants: 0 })).toEqual({
      total: money(260_000_00, 'NGN'),
    });
  });

  it('says why a group cannot book', () => {
    expect(perPersonTotal(prices, { adults: 1, children: 0, infants: 1 })).toEqual({
      issue: 'infants_not_allowed',
    });
    expect(
      perPersonTotal({ ...prices, child: null }, { adults: 1, children: 1, infants: 0 }),
    ).toEqual({ issue: 'children_not_allowed' });
    expect(perPersonTotal(prices, { adults: 0, children: 0, infants: 0 })).toEqual({
      issue: 'no_travellers',
    });
  });

  it('validates stored price tables', () => {
    const wire = { adult: { amountMinor: 100, currency: 'NGN' }, child: null, infant: null };
    expect(perPersonPricesSchema.safeParse(wire).success).toBe(true);
    expect(
      perPersonPricesSchema.safeParse({ ...wire, child: { amountMinor: 50, currency: 'USD' } })
        .success,
    ).toBe(false);
    expect(
      perPersonPricesSchema.safeParse({ ...wire, adult: { amountMinor: 0, currency: 'NGN' } })
        .success,
    ).toBe(false);
  });
});

describe('add-on units', () => {
  it('counts people, days or both', () => {
    expect(coveredDays('2026-12-10', '2026-12-10')).toBe(1);
    expect(coveredDays('2026-12-10', '2026-12-17')).toBe(8);
    expect(addonUnits('per_person', 3, '2026-12-10', '2026-12-17')).toBe(3);
    expect(addonUnits('per_booking', 3, '2026-12-10', '2026-12-17')).toBe(1);
    expect(addonUnits('per_day', 3, '2026-12-10', '2026-12-17')).toBe(8);
    expect(addonUnits('per_person_per_day', 3, '2026-12-10', '2026-12-17')).toBe(24);
  });
});

describe('visa documents', () => {
  const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0]);

  it('recognises PDF, JPEG and PNG from their bytes only', () => {
    expect(sniffDocumentType(new TextEncoder().encode('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffDocumentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffDocumentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    );
    expect(sniffDocumentType(new TextEncoder().encode('<html><script>'))).toBeNull();
    expect(sniffDocumentType(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(sniffDocumentType(new Uint8Array())).toBeNull();
  });

  it('keeps file names safe to show and to send in headers', () => {
    expect(safeFileName('Passport scan (1).PDF', 'application/pdf')).toBe('Passport-scan-1.pdf');
    expect(safeFileName('../../etc/passwd', 'image/png')).toBe('etc-passwd.png');
    expect(safeFileName('"; filename=evil.exe', 'image/jpeg')).toBe('filename-evil.jpg');
    expect(safeFileName('Ọ̀ṣun.jpg', 'image/jpeg')).toBe('Osun.jpg');
    expect(safeFileName('', 'application/pdf')).toBe('document.pdf');
  });

  it('validates checklists', () => {
    const item = { key: 'passport', label: 'Passport', description: '', required: true };
    expect(visaChecklistSchema.safeParse([item]).success).toBe(true);
    expect(visaChecklistSchema.safeParse([item, item]).success).toBe(false);
    expect(visaChecklistSchema.safeParse([{ ...item, key: 'Bad Key' }]).success).toBe(false);
  });
});

describe('voucher codes', () => {
  const code = 'ABCDEFGHJKMNPQRSTUVW';

  it('reads typed codes and scanned QR payloads', () => {
    expect(parseVoucherCode(code)).toBe(code);
    expect(parseVoucherCode(formatVoucherCode(code).toLowerCase())).toBe(code);
    expect(parseVoucherCode(`${VOUCHER_QR_PREFIX}${code}`)).toBe(code);
    expect(parseVoucherCode('ABCD')).toBeNull();
    expect(parseVoucherCode('ABCDEFGHJKMNPQRSTUV0')).toBeNull();
  });

  it('groups codes for display', () => {
    expect(formatVoucherCode(code)).toBe('ABCD-EFGH-JKMN-PQRS-TUVW');
  });
});
