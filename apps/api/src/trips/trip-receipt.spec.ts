import { money } from '@suskii/shared';

import { tripReceipt } from './trip-receipt';
import type { TripDto } from './trips.schemas';
import type { TripReceiptPayment } from './trips.service';

const PAID_AT = new Date('2026-11-14T18:30:00Z');
const LATER = new Date('2026-11-15T09:00:00Z');

/** The trip as its answer lists the parts: the fields the receipt reads. */
function trip(parts: { component: string; id: string; reference: string }[]): TripDto {
  return {
    currency: 'NGN',
    parts: parts.map((part) => ({
      component: part.component,
      booking: { id: part.id, reference: part.reference },
    })),
  } as unknown as TripDto;
}

interface ShareInput {
  bookingId: string;
  reference: string;
  amount: number;
  requiresRefund?: boolean;
  tripComponent?: string | null;
  taxes?: { label: string; rateBps: number; amount: number }[];
}

function payment(input: {
  reference: string;
  amount: number;
  method?: string | null;
  succeededAt?: Date | null;
  shares: ShareInput[];
}): TripReceiptPayment {
  return {
    providerReference: input.reference,
    amountMinor: BigInt(input.amount),
    currency: 'NGN',
    method: input.method ?? null,
    succeededAt: input.succeededAt === undefined ? PAID_AT : input.succeededAt,
    updatedAt: LATER,
    shares: input.shares.map((share) => ({
      bookingId: share.bookingId,
      amountMinor: BigInt(share.amount),
      currency: 'NGN',
      requiresRefund: share.requiresRefund ?? false,
      booking: {
        reference: share.reference,
        tripComponent: share.tripComponent ?? null,
        price: {
          serviceTaxes: (share.taxes ?? []).map((tax) => ({
            code: 'vat',
            label: tax.label,
            rateBps: tax.rateBps,
            amount: { amountMinor: tax.amount, currency: 'NGN' },
            registrationNumber: 'TIN-0001',
          })),
        },
      },
    })),
  } as unknown as TripReceiptPayment;
}

const ngn = (minor: number) => money(BigInt(minor), 'NGN');

describe('tripReceipt', () => {
  const parts = trip([
    { component: 'car', id: 'b-car', reference: 'SK-CAR001' },
    { component: 'flight', id: 'b-flight', reference: 'SK-FLT001' },
    { component: 'hotel', id: 'b-hotel', reference: 'SK-HTL001' },
  ]);

  it('lists one payment and each part it paid, in the order of the trip parts', () => {
    const receipt = tripReceipt(parts, [
      payment({
        reference: 'PAY-1',
        amount: 600_000,
        method: 'card',
        shares: [
          { bookingId: 'b-car', reference: 'SK-CAR001', amount: 100_000 },
          {
            bookingId: 'b-hotel',
            reference: 'SK-HTL001',
            amount: 200_000,
            taxes: [{ label: 'VAT', rateBps: 750, amount: 1_500 }],
          },
          { bookingId: 'b-flight', reference: 'SK-FLT001', amount: 300_000 },
        ],
      }),
    ]);

    expect(receipt.payments).toEqual([
      { paidAt: PAID_AT, reference: 'PAY-1', method: 'card', amount: ngn(600_000), refunded: null },
    ]);
    expect(
      receipt.parts.map((line) => [line.component, line.bookingReference, line.amount]),
    ).toEqual([
      ['flight', 'SK-FLT001', ngn(300_000)],
      ['hotel', 'SK-HTL001', ngn(200_000)],
      ['car', 'SK-CAR001', ngn(100_000)],
    ]);
    expect(receipt.parts[1]?.taxes).toEqual([
      { label: 'VAT', rateBps: 750, amount: ngn(1_500), registrationNumber: 'TIN-0001' },
    ]);
    expect(receipt.parts[1]?.part?.booking.id).toBe('b-hotel');
    expect(receipt.total).toEqual(ngn(600_000));
  });

  it('leaves out money a part could not keep, and shows it as refunded on its payment', () => {
    const receipt = tripReceipt(parts, [
      payment({
        reference: 'PAY-1',
        amount: 500_000,
        shares: [
          { bookingId: 'b-flight', reference: 'SK-FLT001', amount: 300_000 },
          { bookingId: 'b-hotel', reference: 'SK-HTL001', amount: 200_000, requiresRefund: true },
        ],
      }),
    ]);

    expect(receipt.payments[0]).toMatchObject({ amount: ngn(500_000), refunded: ngn(200_000) });
    expect(receipt.parts.map((line) => line.bookingReference)).toEqual(['SK-FLT001']);
    expect(receipt.total).toEqual(ngn(300_000));
  });

  it('adds up every payment, and orders the parts across them', () => {
    const receipt = tripReceipt(parts, [
      payment({
        reference: 'PAY-1',
        amount: 100_000,
        shares: [{ bookingId: 'b-car', reference: 'SK-CAR001', amount: 100_000 }],
      }),
      payment({
        reference: 'PAY-2',
        amount: 300_000,
        succeededAt: LATER,
        shares: [{ bookingId: 'b-flight', reference: 'SK-FLT001', amount: 300_000 }],
      }),
    ]);

    expect(receipt.payments.map((line) => [line.reference, line.paidAt])).toEqual([
      ['PAY-1', PAID_AT],
      ['PAY-2', LATER],
    ]);
    expect(receipt.parts.map((line) => line.component)).toEqual(['flight', 'car']);
    expect(receipt.total).toEqual(ngn(400_000));
  });

  it('names a booking the trip no longer lists by its own reference and part', () => {
    const receipt = tripReceipt(trip([]), [
      payment({
        reference: 'PAY-1',
        amount: 150_000,
        method: null,
        shares: [
          {
            bookingId: 'b-gone',
            reference: 'SK-GONE01',
            amount: 100_000,
            tripComponent: 'transfer',
          },
          { bookingId: 'b-odd', reference: 'SK-ODD001', amount: 50_000, tripComponent: 'lounge' },
        ],
      }),
    ]);

    expect(receipt.parts).toEqual([
      expect.objectContaining({ component: null, bookingReference: 'SK-ODD001', part: null }),
      expect.objectContaining({ component: 'transfer', bookingReference: 'SK-GONE01', part: null }),
    ]);
    expect(receipt.payments[0]?.method).toBeNull();
  });

  it('dates a payment by when it went through, else when it last changed', () => {
    const receipt = tripReceipt(parts, [
      payment({
        reference: 'PAY-1',
        amount: 100_000,
        succeededAt: null,
        shares: [{ bookingId: 'b-car', reference: 'SK-CAR001', amount: 100_000 }],
      }),
    ]);

    expect(receipt.payments[0]?.paidAt).toEqual(LATER);
  });
});
