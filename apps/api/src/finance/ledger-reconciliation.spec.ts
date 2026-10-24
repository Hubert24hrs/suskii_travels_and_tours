import { money } from '@suskii/shared';

import { paymentFindings, postingFindings } from './ledger-reconciliation.service';

const payment = {
  id: '0192f0e0-0000-7000-8000-0000000000a1',
  bookingId: '0192f0e0-0000-7000-8000-0000000000b1',
  amountMinor: 1_000_000n,
  currency: 'NGN',
  requiresRefund: false,
  failureReason: null,
};
const ngn = (minor: bigint) => money(minor, 'NGN');
const succeeded = (minor: bigint, currency = 'NGN') => ({
  status: 'succeeded' as const,
  amount: money(minor, currency),
  providerTransactionId: 'tx',
  method: 'card',
  failureReason: null,
});

describe('paymentFindings', () => {
  it('finds nothing when the payment, its posting and the provider agree', () => {
    expect(paymentFindings(payment, ngn(1_000_000n), succeeded(1_000_000n))).toEqual([]);
    // Not asked, or not able to say: no provider finding either.
    expect(paymentFindings(payment, ngn(1_000_000n), null)).toEqual([]);
    expect(
      paymentFindings(payment, ngn(1_000_000n), {
        status: 'pending',
        amount: null,
        providerTransactionId: null,
        method: null,
        failureReason: null,
      }),
    ).toEqual([]);
  });

  it('flags a missing or different capture posting', () => {
    expect(paymentFindings(payment, null, null)).toEqual([
      expect.objectContaining({ kind: 'ledger_missing', expected: ngn(1_000_000n), actual: null }),
    ]);
    expect(paymentFindings(payment, ngn(900_000n), null)).toEqual([
      expect.objectContaining({
        kind: 'ledger_amount',
        subjectType: 'payment',
        subjectId: payment.id,
        bookingId: payment.bookingId,
        expected: ngn(1_000_000n),
        actual: ngn(900_000n),
      }),
    ]);
    // A different currency is a different amount.
    expect(paymentFindings(payment, money(1_000_000n, 'USD'), null)[0]?.kind).toBe('ledger_amount');
  });

  it('compares the provider with what the ledger booked', () => {
    expect(paymentFindings(payment, ngn(1_000_000n), succeeded(950_000n))).toEqual([
      expect.objectContaining({
        kind: 'provider_amount',
        expected: ngn(1_000_000n),
        actual: ngn(950_000n),
      }),
    ]);
    expect(
      paymentFindings(payment, ngn(1_000_000n), {
        status: 'failed',
        amount: null,
        providerTransactionId: null,
        method: null,
        failureReason: 'card_declined',
      }),
    ).toEqual([expect.objectContaining({ kind: 'provider_status', actual: null })]);
  });

  it('only checks presence for a payment already refunded as charged differently', () => {
    const mismatch = { ...payment, requiresRefund: true, failureReason: 'amount_mismatch' };
    // The provider charged 1,200,000; the ledger booked that as unapplied and it is refunded.
    expect(paymentFindings(mismatch, ngn(1_200_000n), succeeded(1_200_000n))).toEqual([]);
    expect(paymentFindings(mismatch, null, null)[0]?.kind).toBe('ledger_missing');
    // Any other refund reason still compares amounts.
    const late = { ...payment, requiresRefund: true, failureReason: 'booking_not_payable' };
    expect(paymentFindings(late, ngn(1_200_000n), null)[0]?.kind).toBe('ledger_amount');
  });
});

describe('postingFindings', () => {
  const subject = {
    subjectType: 'payout' as const,
    subjectId: '0192f0e0-0000-7000-8000-0000000000c1',
    bookingId: null,
  };

  it('needs every posting, each with the record amount', () => {
    expect(postingFindings(subject, ngn(500n), [ngn(500n), ngn(500n)])).toEqual([]);
    expect(postingFindings(subject, ngn(500n), [ngn(500n), null])).toEqual([
      { ...subject, kind: 'ledger_missing', expected: ngn(500n), actual: null },
    ]);
    expect(postingFindings(subject, ngn(500n), [ngn(500n), ngn(400n)])).toEqual([
      { ...subject, kind: 'ledger_amount', expected: ngn(500n), actual: ngn(400n) },
    ]);
  });
});
