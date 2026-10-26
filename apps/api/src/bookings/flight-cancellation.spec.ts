import { money } from '@suskii/shared';

import { toJsonValue } from '../common/json';
import { FlightSupplier, type SupplierFlightOffer } from '../suppliers/supplier.types';

import type { BookingRecord } from './booking-presenter';
import { cancellableFlight, supplierPaid, travellerRefund } from './flight-cancellation';

const usd = (minor: bigint) => money(minor, 'USD');
const ngn = (minor: bigint) => money(minor, 'NGN');

const offer = (departureUtc: string): SupplierFlightOffer =>
  ({
    supplier: 'duffel',
    supplierOfferId: 'off_1',
    price: { base: usd(20_000n), taxes: usd(4_441n) },
    slices: [{ departureUtc }],
    services: [
      { id: 'off_1.bag23', type: 'checked_bag', weightKg: 23, maxQuantity: 2, price: usd(2_000n) },
    ],
  }) as unknown as SupplierFlightOffer;

class Supplier extends FlightSupplier {
  readonly idempotentBooking = false;
  constructor(
    readonly name: string,
    override readonly cancelsOnline: boolean,
  ) {
    super();
  }
  search = () => Promise.resolve([]);
  reprice = (value: SupplierFlightOffer) => Promise.resolve(value);
  book = () => Promise.reject(new Error('not used'));
}

const booking = (patch: {
  status?: string;
  supplierOrderId?: string | null;
  bookedAt?: Date | null;
  departureUtc?: string;
}): BookingRecord =>
  ({
    status: patch.status ?? 'CONFIRMED',
    items: [
      {
        supplierOrderId: 'supplierOrderId' in patch ? patch.supplierOrderId : 'ord_1',
        bookedAt: 'bookedAt' in patch ? patch.bookedAt : new Date('2026-10-01T10:00:00Z'),
        payload: toJsonValue({
          kind: 'flight',
          offer: offer(patch.departureUtc ?? '2026-11-20T12:45:00Z'),
          request: {},
        }),
        services: [],
      },
    ],
  }) as unknown as BookingRecord;

describe('flight cancellation rules (ADR-064)', () => {
  it('refunds the traveller the share of what they paid that the airline refunds us', () => {
    const paid = ngn(36_000_000n);
    // The airline refunds everything: so do we.
    expect(travellerRefund(paid, usd(24_441n), usd(24_441n))).toEqual(paid);
    // Half back from the airline: half of what the traveller paid, rounded down.
    expect(travellerRefund(paid, usd(12_220n), usd(24_441n))).toEqual(ngn(17_999_263n));
    // Nothing back: nothing refunded.
    expect(travellerRefund(paid, usd(0n), usd(24_441n))).toEqual(ngn(0n));
    // More than we paid the airline still never refunds more than the traveller paid.
    expect(travellerRefund(paid, usd(30_000n), usd(24_441n))).toEqual(paid);
  });

  it('counts the fare and the paid bags as what we paid the supplier', () => {
    const payload = { kind: 'flight', offer: offer('2026-11-20T12:45:00Z') } as Parameters<
      typeof supplierPaid
    >[0];
    expect(supplierPaid(payload, { services: [] })).toEqual(usd(24_441n));
    expect(
      supplierPaid(payload, {
        services: [
          {
            serviceId: 'off_1.bag23',
            passengerIndex: 0,
            quantity: 2,
            type: 'checked_bag',
            weightKg: 23,
          },
        ],
      }),
    ).toEqual(usd(28_441n));
  });

  it('offers online cancellation only for ticketed flights of a supplier that cancels online', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    const duffel = [new Supplier('duffel', true)];
    expect(cancellableFlight(booking({}), duffel, now)).not.toBeNull();
    expect(cancellableFlight(booking({ status: 'PAID' }), duffel, now)).toBeNull();
    expect(cancellableFlight(booking({ supplierOrderId: null }), duffel, now)).toBeNull();
    expect(cancellableFlight(booking({ bookedAt: null }), duffel, now)).toBeNull();
    // Departed flights, and suppliers that cannot cancel online, go through support.
    expect(
      cancellableFlight(booking({ departureUtc: '2026-10-26T11:00:00Z' }), duffel, now),
    ).toBeNull();
    expect(cancellableFlight(booking({}), [new Supplier('duffel', false)], now)).toBeNull();
    expect(cancellableFlight(booking({}), [], now)).toBeNull();
  });
});
