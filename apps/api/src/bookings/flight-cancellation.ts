import { add, compare, minOf, money, multiply, multiplyRatio, type Money } from '@suskii/shared';

import type { FlightSupplier } from '../suppliers/supplier.types';

import { itemPayload, itemServices, type BookingRecord } from './booking-presenter';
import { matchService, type FlightItemPayload } from './booking-pricing';

// Pure rules of online flight cancellation (ADR-064), shared by the service and the presenter.

/** What we paid the supplier for the booked flight: the fare and any extra bags. */
export function supplierPaid(payload: FlightItemPayload, item: { services: unknown }): Money {
  const fare = add(payload.offer.price.base, payload.offer.price.taxes);
  return itemServices(item).reduce((total, selection) => {
    const service = matchService(payload.offer.services, selection);
    return service ? add(total, multiply(service.price, selection.quantity)) : total;
  }, fare);
}

/**
 * The traveller's refund: the share of what they paid that the supplier refunds of what we paid
 * it (ADR-064). Rounded down and never more than they paid, whatever the exchange rate does.
 */
export function travellerRefund(paid: Money, supplierRefund: Money, supplierTotal: Money): Money {
  if (supplierTotal.minor <= 0n || compare(supplierRefund, supplierTotal) >= 0) return paid;
  if (supplierRefund.minor <= 0n) return money(0n, paid.currency);
  return minOf(multiplyRatio(paid, supplierRefund.minor, supplierTotal.minor, 'floor'), paid);
}

interface Cancellable {
  item: BookingRecord['items'][number];
  payload: FlightItemPayload;
  supplier: FlightSupplier;
  orderId: string;
}

/**
 * A confirmed, ticketed flight whose supplier cancels online and that has not departed. Shown as
 * `flightCancellable` on the booking; anything else is cancelled through support.
 */
export function cancellableFlight(
  booking: BookingRecord,
  suppliers: readonly FlightSupplier[],
  now: Date,
): Cancellable | null {
  const item = booking.items[0];
  if (booking.status !== 'CONFIRMED' || !item?.supplierOrderId || !item.bookedAt) return null;
  const payload = itemPayload(item);
  if (payload.kind !== 'flight') return null;
  const supplier = suppliers.find((candidate) => candidate.name === payload.offer.supplier);
  if (!supplier?.cancelsOnline) return null;
  const departure = payload.offer.slices[0]?.departureUtc;
  if (!departure || Date.parse(departure) <= now.getTime()) return null;
  return { item, payload, supplier, orderId: item.supplierOrderId };
}
