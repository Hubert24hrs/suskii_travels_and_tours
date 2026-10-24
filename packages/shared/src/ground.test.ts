import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  boardingWindow,
  decodePolyline,
  distanceToRouteMetres,
  driverShare,
  encodePolyline,
  haversineMetres,
  layoutSeats,
  NIGERIA_BOUNDS,
  nextRideStatus,
  rentalCharge,
  rentalDays,
  RIDE_EVENTS,
  RIDE_STATUSES,
  rideCancellationFee,
  rideFare,
  roundPoint,
  seatSelectionIssue,
  WEST_AFRICA_BOUNDS,
  withinBounds,
  type BusSeatLayout,
  type GeoPoint,
  type RideFareRule,
} from './ground';
import {
  busSeatLayoutSchema,
  emergencyContactsSchema,
  geoPointSchema,
  ninSchema,
  plateSchema,
  seatSelectionSchema,
} from './ground-schemas';
import { add, money, sum, type Money } from './money';

const IKEJA: GeoPoint = { lat: 6.6018, lng: 3.3515 };
const LEKKI: GeoPoint = { lat: 6.4698, lng: 3.5852 };
const ACCRA: GeoPoint = { lat: 5.6037, lng: -0.187 };

const RULE: RideFareRule = {
  currency: 'NGN',
  baseMinor: 50_000n,
  perKmMinor: 15_000n,
  perMinuteMinor: 2_000n,
  bookingFeeMinor: 20_000n,
  minimumMinor: 150_000n,
  cancellationFeeMinor: 50_000n,
  freeCancelSeconds: 120,
  waitGraceSeconds: 300,
  driverShareBps: 8_000,
};

const LAYOUT: BusSeatLayout = {
  rows: [
    ['1A', null, '1C', '1D'],
    ['2A', '2B', null, '2D'],
  ],
};

describe('geography', () => {
  it('checks the service area', () => {
    expect(withinBounds(IKEJA, NIGERIA_BOUNDS)).toBe(true);
    expect(withinBounds(ACCRA, NIGERIA_BOUNDS)).toBe(false);
    expect(withinBounds(ACCRA, WEST_AFRICA_BOUNDS)).toBe(true);
    expect(withinBounds({ lat: Number.NaN, lng: 3 }, NIGERIA_BOUNDS)).toBe(false);
  });

  it('measures Ikeja to Lekki at about 30 km', () => {
    const metres = haversineMetres(IKEJA, LEKKI);
    expect(metres).toBeGreaterThan(29_000);
    expect(metres).toBeLessThan(31_000);
    expect(haversineMetres(IKEJA, IKEJA)).toBe(0);
  });

  it('measures the distance to a route', () => {
    const route = [IKEJA, LEKKI];
    expect(distanceToRouteMetres(IKEJA, route)).toBeLessThan(1);
    const midpoint = { lat: (IKEJA.lat + LEKKI.lat) / 2, lng: (IKEJA.lng + LEKKI.lng) / 2 };
    expect(distanceToRouteMetres(midpoint, route)).toBeLessThan(5);
    // A point 0.01 degrees of latitude north of Ikeja, past the start of the route.
    const north = { lat: IKEJA.lat + 0.01, lng: IKEJA.lng };
    expect(distanceToRouteMetres(north, route)).toBeCloseTo(haversineMetres(north, IKEJA), -1);
    expect(distanceToRouteMetres(IKEJA, [])).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToRouteMetres(north, [IKEJA])).toBeCloseTo(haversineMetres(north, IKEJA));
  });

  it('rounds positions to about 110 metres', () => {
    expect(roundPoint({ lat: 6.60184, lng: 3.35156 })).toEqual({ lat: 6.602, lng: 3.352 });
  });

  it('round-trips polylines', () => {
    const point = fc.record({
      lat: fc.double({ min: 4, max: 14, noNaN: true }),
      lng: fc.double({ min: 2.6, max: 14.8, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(point, { maxLength: 50 }), (points) => {
        const decoded = decodePolyline(encodePolyline(points));
        expect(decoded).toHaveLength(points.length);
        decoded.forEach((p, index) => {
          expect(Math.abs(p.lat - (points[index]?.lat ?? 0))).toBeLessThanOrEqual(0.000006);
          expect(Math.abs(p.lng - (points[index]?.lng ?? 0))).toBeLessThanOrEqual(0.000006);
        });
      }),
    );
    expect(encodePolyline([{ lat: 38.5, lng: -120.2 }])).toBe('_p~iF~ps|U');
    expect(() => decodePolyline('_p~iF~ps|')).toThrow(RangeError);
    expect(() => decodePolyline(' ')).toThrow(RangeError);
  });
});

describe('bus seats', () => {
  it('lists seats and validates selections', () => {
    expect(layoutSeats(LAYOUT)).toEqual(['1A', '1C', '1D', '2A', '2B', '2D']);
    expect(seatSelectionIssue(LAYOUT, ['1A', '2B'])).toBeNull();
    expect(seatSelectionIssue(LAYOUT, [])).toBe('none_selected');
    expect(seatSelectionIssue(LAYOUT, ['1A', '1A'])).toBe('duplicate');
    expect(seatSelectionIssue(LAYOUT, ['1B'])).toBe('unknown_seat');
    expect(seatSelectionIssue(LAYOUT, ['1A', '1C', '1D', '2A', '2B', '2D', '3A'])).toBe('too_many');
  });

  it('validates layouts and selections at the boundary', () => {
    expect(busSeatLayoutSchema.safeParse(LAYOUT).success).toBe(true);
    expect(busSeatLayoutSchema.safeParse({ rows: [['1A', '1A']] }).success).toBe(false);
    expect(busSeatLayoutSchema.safeParse({ rows: [[null]] }).success).toBe(false);
    expect(seatSelectionSchema.safeParse(['1A', '1A']).success).toBe(false);
    expect(seatSelectionSchema.safeParse(['1Z']).success).toBe(false);
  });

  it('opens boarding three hours before and closes six hours after departure', () => {
    const departs = new Date('2026-11-02T07:00:00Z');
    const { notBefore, notAfter } = boardingWindow(departs);
    expect(notBefore.toISOString()).toBe('2026-11-02T04:00:00.000Z');
    expect(notAfter.toISOString()).toBe('2026-11-02T13:00:00.000Z');
  });
});

describe('ride fares', () => {
  it('adds base, distance, time and the booking fee', () => {
    const fare = rideFare(RULE, 12_500, 1_800, 0, 5_000);
    expect(fare.distance).toEqual(money(187_500n, 'NGN'));
    expect(fare.time).toEqual(money(60_000n, 'NGN'));
    expect(fare.surge.minor).toBe(0n);
    expect(fare.minimumTopUp.minor).toBe(0n);
    expect(fare.total).toEqual(money(50_000n + 187_500n + 60_000n + 20_000n, 'NGN'));
  });

  it('caps surge and tops short trips up to the minimum', () => {
    const capped = rideFare(RULE, 10_000, 600, 20_000, 5_000);
    const metered = 50_000n + 150_000n + 20_000n;
    expect(capped.surge).toEqual(money(metered / 2n, 'NGN'));
    const short = rideFare(RULE, 500, 60, 0, 5_000);
    expect(short.total).toEqual(money(150_000n + 20_000n, 'NGN'));
    expect(short.minimumTopUp.minor).toBeGreaterThan(0n);
  });

  it('always adds up to its parts and never goes below the minimum plus the fee', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 30_000 }),
        (metres, seconds, surge) => {
          const fare = rideFare(RULE, metres, seconds, surge, 5_000);
          const parts = sum('NGN', [
            fare.base,
            fare.distance,
            fare.time,
            fare.surge,
            fare.minimumTopUp,
            fare.bookingFee,
          ]);
          expect(parts).toEqual(fare.total);
          expect(fare.total.minor).toBeGreaterThanOrEqual(RULE.minimumMinor + RULE.bookingFeeMinor);
        },
      ),
    );
  });

  it('charges a cancellation fee only after the free window', () => {
    const paid = money(300_000n, 'NGN');
    const assigned = new Date('2026-11-02T07:00:00Z');
    const at = (seconds: number) => new Date(assigned.getTime() + seconds * 1000);
    expect(rideCancellationFee(RULE, 'searching', null, paid, at(0)).minor).toBe(0n);
    expect(rideCancellationFee(RULE, 'assigned', assigned, paid, at(120)).minor).toBe(0n);
    expect(rideCancellationFee(RULE, 'assigned', assigned, paid, at(121)).minor).toBe(50_000n);
    expect(rideCancellationFee(RULE, 'arrived', assigned, money(30_000n, 'NGN'), at(900))).toEqual(
      money(30_000n, 'NGN'),
    );
  });

  it('converts the fee into the currency the ride was paid in, and never mixes the two', () => {
    const assigned = new Date('2026-11-02T07:00:00Z');
    const late = new Date(assigned.getTime() + 900_000);
    // NGN 500 at NGN 1,500 to the dollar is 33 cents, not 50,000 cents capped at the fare.
    const toUsd = (fee: Money) => money((fee.minor * 100n) / 150_000n, 'USD');
    expect(
      rideCancellationFee(RULE, 'assigned', assigned, money(1_500n, 'USD'), late, toUsd),
    ).toEqual(money(33n, 'USD'));
    expect(() =>
      rideCancellationFee(RULE, 'assigned', assigned, money(1_500n, 'USD'), late),
    ).toThrow(RangeError);
  });

  it('splits fares between driver and platform without losing a kobo', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 10_000 }),
        (minor, bps) => {
          const fare = money(minor, 'NGN');
          const share = driverShare(fare, bps);
          expect(share.minor).toBeLessThanOrEqual(minor);
          expect(add(share, money(minor - share.minor, 'NGN'))).toEqual(fare);
        },
      ),
    );
  });
});

describe('ride state machine', () => {
  it('follows the allowed moves', () => {
    expect(nextRideStatus('searching', 'accept')).toBe('assigned');
    expect(nextRideStatus('assigned', 'driver_cancel')).toBe('searching');
    expect(nextRideStatus('arrived', 'start')).toBe('in_progress');
    expect(nextRideStatus('in_progress', 'rider_cancel')).toBeNull();
    expect(nextRideStatus('in_progress', 'staff_cancel')).toBe('cancelled');
    expect(nextRideStatus('searching', 'timeout')).toBe('no_driver');
  });

  it('allows exactly the moves in the table, from every status, for every event', () => {
    // status -> event -> next status; anything missing must be refused.
    const allowed: Partial<
      Record<(typeof RIDE_STATUSES)[number], Partial<Record<(typeof RIDE_EVENTS)[number], string>>>
    > = {
      scheduled: { dispatch: 'searching', rider_cancel: 'cancelled', staff_cancel: 'cancelled' },
      searching: {
        accept: 'assigned',
        rider_cancel: 'cancelled',
        staff_cancel: 'cancelled',
        timeout: 'no_driver',
      },
      assigned: {
        arrive: 'arrived',
        driver_cancel: 'searching',
        rider_cancel: 'cancelled',
        staff_cancel: 'cancelled',
      },
      arrived: {
        start: 'in_progress',
        driver_cancel: 'searching',
        rider_cancel: 'cancelled',
        staff_cancel: 'cancelled',
      },
      in_progress: { complete: 'completed', staff_cancel: 'cancelled' },
    };
    for (const status of RIDE_STATUSES) {
      for (const event of RIDE_EVENTS) {
        expect({ status, event, next: nextRideStatus(status, event) }).toEqual({
          status,
          event,
          next: allowed[status]?.[event] ?? null,
        });
      }
    }
  });

  it('never leaves a finished ride', () => {
    for (const status of ['completed', 'cancelled', 'no_driver'] as const) {
      for (const event of RIDE_EVENTS) expect(nextRideStatus(status, event)).toBeNull();
    }
    expect(RIDE_STATUSES).toContain('scheduled');
  });
});

describe('rentals', () => {
  const rates = {
    daily: money(4_500_000n, 'NGN'),
    chauffeurDaily: money(1_500_000n, 'NGN'),
    deposit: money(10_000_000n, 'NGN'),
  };

  it('charges started 24-hour periods', () => {
    const pickup = new Date('2026-11-02T09:00:00Z');
    expect(rentalDays(pickup, new Date('2026-11-02T10:00:00Z'))).toBe(1);
    expect(rentalDays(pickup, new Date('2026-11-03T09:00:00Z'))).toBe(1);
    expect(rentalDays(pickup, new Date('2026-11-03T09:01:00Z'))).toBe(2);
  });

  it('adds the chauffeur and takes a deposit only for self-drive', () => {
    const pickup = new Date('2026-11-02T09:00:00Z');
    const back = new Date('2026-11-04T09:00:00Z');
    const selfDrive = rentalCharge(rates, pickup, back, false);
    expect(selfDrive).toEqual({
      days: 2,
      vehicle: money(9_000_000n, 'NGN'),
      chauffeur: money(0n, 'NGN'),
      deposit: rates.deposit,
    });
    const chauffeured = rentalCharge(rates, pickup, back, true);
    expect(chauffeured?.chauffeur).toEqual(money(3_000_000n, 'NGN'));
    expect(chauffeured?.deposit.minor).toBe(0n);
    expect(rentalCharge({ ...rates, chauffeurDaily: null }, pickup, back, true)).toBeNull();
  });
});

describe('input schemas', () => {
  it('rejects points outside the service area', () => {
    expect(geoPointSchema().safeParse(IKEJA).success).toBe(true);
    expect(geoPointSchema().safeParse(ACCRA).success).toBe(false);
    expect(geoPointSchema(WEST_AFRICA_BOUNDS).safeParse(ACCRA).success).toBe(true);
    expect(geoPointSchema().safeParse({ lat: Number.POSITIVE_INFINITY, lng: 3 }).success).toBe(
      false,
    );
  });

  it('validates NINs, plates and emergency contacts', () => {
    expect(ninSchema.safeParse('12345678901').success).toBe(true);
    expect(ninSchema.safeParse('1234567890').success).toBe(false);
    expect(plateSchema.parse(' lnd-123-ab ')).toBe('LND-123-AB');
    expect(plateSchema.safeParse('!!').success).toBe(false);
    const contact = { name: 'Ada', phone: '+2348012345678' };
    expect(emergencyContactsSchema.safeParse([contact]).success).toBe(true);
    expect(emergencyContactsSchema.safeParse([contact, contact, contact, contact]).success).toBe(
      false,
    );
  });
});
