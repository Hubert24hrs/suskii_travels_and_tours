import { allocate, type Money } from '@suskii/shared';

import type { ItemPayload } from './booking-pricing';

export const PRICE_LINE_CODES = [
  'ride_base',
  'ride_distance',
  'ride_time',
  'ride_surge',
  'ride_minimum',
  'ride_booking_fee',
  'bus_seats',
  'rental_vehicle',
  'rental_chauffeur',
  'rental_delivery',
] as const;
export type PriceLineCode = (typeof PRICE_LINE_CODES)[number];

export interface PriceLine {
  code: PriceLineCode;
  amount: Money;
  /** Seats or days the line covers, where that is how it is charged. */
  quantity: number | null;
}

interface Part {
  code: PriceLineCode;
  weight: bigint;
  quantity: number | null;
}

/**
 * The fare of a bus, ride or rental split into the parts it is made of (unified price breakdown,
 * Cars P9). The parts are the operator's own components, but the fare a customer pays may carry a
 * markup, which never leaves the API (CLAUDE.md, pricing). So the fare is allocated across the
 * parts in proportion to them (largest remainder): the lines always add up to the fare shown and
 * reveal no margin. Taxes, fees, discounts and a rental's deposit stay lines of their own.
 */
export function carsPriceBreakdown(payload: ItemPayload, fare: Money): PriceLine[] | null {
  let parts: Part[];
  switch (payload.kind) {
    case 'ride': {
      const { fare: components } = payload;
      parts = [
        { code: 'ride_base', weight: components.base.minor, quantity: null },
        { code: 'ride_distance', weight: components.distance.minor, quantity: null },
        { code: 'ride_time', weight: components.time.minor, quantity: null },
        { code: 'ride_surge', weight: components.surge.minor, quantity: null },
        { code: 'ride_minimum', weight: components.minimumTopUp.minor, quantity: null },
        { code: 'ride_booking_fee', weight: components.bookingFee.minor, quantity: null },
      ];
      break;
    }
    case 'bus':
      parts = [{ code: 'bus_seats', weight: 1n, quantity: payload.seats.length }];
      break;
    case 'rental':
      parts = [
        { code: 'rental_vehicle', weight: payload.charge.vehicle.minor, quantity: payload.days },
        {
          code: 'rental_chauffeur',
          weight: payload.charge.chauffeur.minor,
          quantity: payload.days,
        },
        { code: 'rental_delivery', weight: payload.charge.delivery.minor, quantity: null },
      ];
      break;
    case 'flight':
    case 'hotel':
    case 'package':
    case 'tour':
    case 'visa':
    case 'addon':
    case 'membership':
      return null;
  }
  const charged = parts.filter((part) => part.weight > 0n);
  if (charged.length === 0 || fare.minor <= 0n) return null;
  const amounts = allocate(
    fare,
    charged.map((part) => part.weight),
  );
  return charged.map((part, index) => ({
    code: part.code,
    amount: amounts[index] ?? fare,
    quantity: part.quantity,
  }));
}
