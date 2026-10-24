import {
  haversineMetres,
  money,
  RIDE_LIVE_STATUSES,
  roundPoint,
  toWire,
  type GeoPoint,
  type RideStatus,
} from '@suskii/shared';

import type { RideItemPayload } from '../bookings/inhouse-items';
import type { Prisma } from '../generated/prisma/client';

import type { RideDto } from './rides.schemas';

/** City driving speed used for ETAs until a maps provider gives live traffic (ADR-053). */
const CITY_METRES_PER_SECOND = 25_000 / 3600;
/** Straight lines understate city routes; the mock routing uses the same factor. */
const ROUTE_FACTOR = 1.3;

export const RIDE_INCLUDE = {
  driver: {
    select: {
      givenNames: true,
      ratingSum: true,
      ratingCount: true,
      lastLat: true,
      lastLng: true,
      lastLocationAt: true,
      userId: true,
    },
  },
  vehicle: { select: { make: true, model: true, colour: true, plate: true } },
  ratings: { select: { raterKind: true } },
  shareLinks: {
    where: { revokedAt: null },
    select: { expiresAt: true },
    orderBy: { createdAt: 'desc' },
  },
  bookingItem: { select: { payload: true } },
} satisfies Prisma.RideInclude;

export type RideRecord = Prisma.RideGetPayload<{ include: typeof RIDE_INCLUDE }>;

const firstName = (names: string): string => names.trim().split(/\s+/)[0] ?? '';

export const rating = (driver: { ratingSum: number; ratingCount: number }): number | null =>
  driver.ratingCount > 0 ? Math.round((driver.ratingSum / driver.ratingCount) * 10) / 10 : null;

const isLive = (status: RideStatus): boolean => RIDE_LIVE_STATUSES.includes(status);

/** Seconds for the driver to reach `target` from their last position, by the city estimate. */
export function etaSeconds(from: GeoPoint | null, to: GeoPoint): number | null {
  if (!from) return null;
  return Math.round((haversineMetres(from, to) * ROUTE_FACTOR) / CITY_METRES_PER_SECOND);
}

/** A driver's last known position (null when offline or never reported). */
export function lastPosition(
  driver: { lastLat: number | null; lastLng: number | null } | null | undefined,
): GeoPoint | null {
  const lat = driver?.lastLat ?? null;
  const lng = driver?.lastLng ?? null;
  return lat === null || lng === null ? null : { lat, lng };
}

/** The driver's last position, rounded, while the ride is live (ADR-050). */
export function livePosition(ride: RideRecord): { lat: number; lng: number; at: string } | null {
  const position = lastPosition(ride.driver);
  const at = ride.driver?.lastLocationAt;
  if (!isLive(ride.status) || !position || !at) return null;
  return { ...roundPoint(position), at: at.toISOString() };
}

export function rideTarget(
  ride: Pick<RideRecord, 'status' | 'pickupLat' | 'pickupLng' | 'dropoffLat' | 'dropoffLng'>,
): GeoPoint {
  return ride.status === 'in_progress'
    ? { lat: ride.dropoffLat, lng: ride.dropoffLng }
    : { lat: ride.pickupLat, lng: ride.pickupLng };
}

const driverView = (ride: RideRecord): RideDto['driver'] =>
  ride.driver && ride.vehicle
    ? {
        firstName: firstName(ride.driver.givenNames),
        rating: rating(ride.driver),
        vehicle: { ...ride.vehicle },
      }
    : null;

/** A ride as its rider sees it; the PIN only until the trip starts. */
export function toRideDto(ride: RideRecord, pin: string | null, now: Date): RideDto {
  const position = livePosition(ride);
  const share = ride.shareLinks.find((link) => link.expiresAt > now);
  const showPin =
    pin !== null && ['scheduled', 'searching', 'assigned', 'arrived'].includes(ride.status);
  return {
    id: ride.id,
    bookingId: ride.bookingId,
    status: ride.status,
    category: ride.category,
    cityName: ride.cityName,
    pickup: { label: ride.pickupLabel, lat: ride.pickupLat, lng: ride.pickupLng },
    dropoff: { label: ride.dropoffLabel, lat: ride.dropoffLat, lng: ride.dropoffLng },
    scheduledFor: ride.scheduledFor?.toISOString() ?? null,
    polyline: ride.polyline,
    distanceMetres: ride.distanceMetres,
    durationSeconds: ride.durationSeconds,
    fare: toWire(money(ride.fareMinor, ride.currency)),
    pin: showPin ? pin : null,
    driver: driverView(ride),
    driverPosition: position,
    etaSeconds: position ? etaSeconds(position, rideTarget(ride)) : null,
    assignedAt: ride.assignedAt?.toISOString() ?? null,
    arrivedAt: ride.arrivedAt?.toISOString() ?? null,
    startedAt: ride.startedAt?.toISOString() ?? null,
    completedAt: ride.completedAt?.toISOString() ?? null,
    cancelledAt: ride.cancelledAt?.toISOString() ?? null,
    cancelledBy: (ride.cancelledBy as RideDto['cancelledBy']) ?? null,
    cancellationFee:
      ride.cancellationFeeMinor !== null
        ? toWire(money(ride.cancellationFeeMinor, ride.currency))
        : null,
    rated: ride.ratings.some((entry) => entry.raterKind === 'rider'),
    sharing: share ? { expiresAt: share.expiresAt.toISOString() } : null,
  };
}

/** What a share link shows (ADR-050): no rider data at all. */
export function toSharedRide(ride: RideRecord) {
  const position = livePosition(ride);
  return {
    status: ride.status,
    cityName: ride.cityName,
    pickupLabel: ride.pickupLabel,
    dropoffLabel: ride.dropoffLabel,
    driver: driverView(ride),
    driverPosition: position,
    etaSeconds: position ? etaSeconds(position, rideTarget(ride)) : null,
    updatedAt: ride.updatedAt.toISOString(),
  };
}

/** A ride as its driver sees it: the rider's first name only. */
export function toDriverRide(
  ride: RideRecord,
  riderName: string,
  earnings: { minor: bigint; currency: string },
) {
  return {
    id: ride.id,
    status: ride.status,
    category: ride.category,
    riderFirstName: firstName(riderName),
    pickup: { label: ride.pickupLabel, lat: ride.pickupLat, lng: ride.pickupLng },
    dropoff: { label: ride.dropoffLabel, lat: ride.dropoffLat, lng: ride.dropoffLng },
    polyline: ride.polyline,
    distanceMetres: ride.distanceMetres,
    earnings: toWire(money(earnings.minor, earnings.currency)),
    pinLocked: ride.pinLockedAt !== null,
    assignedAt: ride.assignedAt?.toISOString() ?? null,
    arrivedAt: ride.arrivedAt?.toISOString() ?? null,
    startedAt: ride.startedAt?.toISOString() ?? null,
  };
}

/** A driver's estimated share of a ride's fare, for offers and the driver's ride view. */
export function estimatedEarnings(payload: RideItemPayload, fareMinor: bigint, currency: string) {
  const total = payload.fare.total.minor;
  const metered = total - payload.fare.bookingFee.minor;
  if (total <= 0n || metered <= 0n) return { minor: 0n, currency };
  return {
    minor: (fareMinor * metered * BigInt(payload.rule.driverShareBps)) / (total * 10_000n),
    currency,
  };
}
