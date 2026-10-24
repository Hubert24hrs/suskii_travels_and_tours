import { money, sum } from '@suskii/shared';

import type { ItemPayload } from './booking-pricing';
import { carsPriceBreakdown } from './cars-breakdown';

const ngn = (minor: bigint) => money(minor, 'NGN');

const ride = {
  kind: 'ride',
  fare: {
    base: ngn(50_000n),
    distance: ngn(200_000n),
    time: ngn(50_000n),
    surge: ngn(0n),
    minimumTopUp: ngn(0n),
    bookingFee: ngn(20_000n),
    total: ngn(320_000n),
  },
} as unknown as ItemPayload;

const rental = {
  kind: 'rental',
  days: 3,
  charge: {
    vehicle: ngn(10_500_000n),
    chauffeur: ngn(4_500_000n),
    delivery: ngn(0n),
    deposit: ngn(10_000_000n),
  },
} as unknown as ItemPayload;

describe('carsPriceBreakdown', () => {
  it('shows a ride fare by its parts, leaving out the empty ones', () => {
    const lines = carsPriceBreakdown(ride, ngn(320_000n));
    expect(lines?.map((line) => [line.code, line.amount.minor])).toEqual([
      ['ride_base', 50_000n],
      ['ride_distance', 200_000n],
      ['ride_time', 50_000n],
      ['ride_booking_fee', 20_000n],
    ]);
  });

  it('spreads a marked-up fare across the parts so no margin shows and the lines add up', () => {
    // 7% on top of the operator's 320,000: nothing in the lines points at the difference.
    const fare = ngn(342_400n);
    const lines = carsPriceBreakdown(ride, fare) ?? [];
    expect(
      sum(
        'NGN',
        lines.map((line) => line.amount),
      ).minor,
    ).toBe(fare.minor);
    expect(lines.map((line) => line.amount.minor)).toEqual([53_500n, 214_000n, 53_500n, 21_400n]);
  });

  it('keeps every unit when the fare does not divide evenly', () => {
    const fare = ngn(320_003n);
    const lines = carsPriceBreakdown(ride, fare) ?? [];
    expect(
      sum(
        'NGN',
        lines.map((line) => line.amount),
      ).minor,
    ).toBe(320_003n);
  });

  it('follows a fare converted to another currency', () => {
    const lines = carsPriceBreakdown(ride, money(20_000n, 'USD')) ?? [];
    expect(lines.every((line) => line.amount.currency === 'USD')).toBe(true);
    expect(
      sum(
        'USD',
        lines.map((line) => line.amount),
      ).minor,
    ).toBe(20_000n);
  });

  it('charges bus seats as one line with the seat count', () => {
    const bus = { kind: 'bus', seats: ['1A', '2A'] } as unknown as ItemPayload;
    expect(carsPriceBreakdown(bus, ngn(1_700_000n))).toEqual([
      { code: 'bus_seats', amount: ngn(1_700_000n), quantity: 2 },
    ]);
  });

  it('splits a rental into car and chauffeur days; the deposit is not part of the fare', () => {
    const lines = carsPriceBreakdown(rental, ngn(15_000_000n));
    expect(lines).toEqual([
      { code: 'rental_vehicle', amount: ngn(10_500_000n), quantity: 3 },
      { code: 'rental_chauffeur', amount: ngn(4_500_000n), quantity: 3 },
    ]);
  });

  it('has nothing to say about other products or a free fare', () => {
    expect(carsPriceBreakdown({ kind: 'tour' } as unknown as ItemPayload, ngn(1n))).toBeNull();
    expect(carsPriceBreakdown(ride, ngn(0n))).toBeNull();
  });
});
