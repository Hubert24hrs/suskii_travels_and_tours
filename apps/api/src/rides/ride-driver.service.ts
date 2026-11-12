import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  addDays,
  distanceToRouteMetres,
  decodePolyline,
  haversineMetres,
  localDate,
  localToUtc,
  money,
  RIDE_LIVE_STATUSES,
  RIDE_PIN_MAX_ATTEMPTS,
  roundPoint,
  toWire,
  withinBounds,
  type GeoPoint,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PasswordHasher } from '../crypto/password-hasher';
import { CarsFlags } from '../ground/cars-flags';
import type { Driver } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { driverEarningsPrefix } from '../ledger/ledger-accounts';
import { rideMatches } from '../telemetry/metrics';

import {
  implausibleLocation,
  notDriving,
  offerGone,
  pinInvalid,
  pinLocked,
  rideConflict,
  rideInProgress,
} from './ride-errors';
import { RideEventsPublisher } from './ride-events.publisher';
import { RideSettlementService } from './ride-settlement.service';
import { RideTransitions } from './ride-transitions';
import {
  driverEarnings,
  etaSeconds,
  lastPosition,
  RIDE_INCLUDE,
  rideTarget,
  toDriverRide,
  type RideRecord,
} from './ride-views';
import type {
  currentDriverRideSchema,
  driverEarningsSchema,
  driverRideSchema,
  rideOfferListSchema,
} from './rides.schemas';
import { rideItemPayload } from './rides.service';
import { SafetyService } from './safety.service';

/** Faster than this between two fixes is not a car (ADR-050). */
const MAX_SPEED_METRES_PER_SECOND = 50;

export interface DriverCaller {
  userId: string;
  context: RequestContext;
}

/**
 * Drivers on the road (ADR-050 to ADR-053): going online (approved, licence and insurance in
 * date, an approved vehicle), positions checked for plausibility, offers, acceptance (one winner,
 * enforced by the database), arrival, the PIN check that starts a trip, completion with the
 * earnings posting, and handing a ride back to matching. Every route checks that the ride is
 * the caller's own; anything else answers 404.
 */
/** Drivers' earnings days follow Lagos time (Cars operates in Nigeria first, ADR-053). */
const EARNINGS_TIME_ZONE = 'Africa/Lagos';

@Injectable()
export class RideDriverService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly transitions: RideTransitions,
    private readonly settlement: RideSettlementService,
    private readonly publisher: RideEventsPublisher,
    private readonly hasher: PasswordHasher,
    private readonly safety: SafetyService,
    private readonly flags: CarsFlags,
    private readonly audit: AuditService,
  ) {}

  async state(userId: string): Promise<{ online: boolean; currentRideId: string | null }> {
    const driver = await this.driver(userId);
    const ride = await this.liveRide(driver.id);
    return { online: driver.online, currentRideId: ride?.id ?? null };
  }

  async goOnline(userId: string, position: GeoPoint, now = new Date()) {
    const driver = await this.driver(userId);
    if (driver.status !== 'approved') throw notDriving('not_approved');
    if (driver.identityCheck !== 'verified' || driver.licenceCheck !== 'verified') {
      throw notDriving('checks_pending');
    }
    const today = localDate(now, 'Africa/Lagos');
    if (driver.licenceExpiresOn.toISOString().slice(0, 10) < today)
      throw notDriving('licence_expired');
    const vehicle = await this.prisma.driverVehicle.findFirst({
      where: { driverId: driver.id, active: true, status: 'approved' },
    });
    if (!vehicle) throw notDriving('no_vehicle');
    if (vehicle.insuranceExpiresOn.toISOString().slice(0, 10) < today) {
      throw notDriving('insurance_expired');
    }
    if (!withinBounds(position, this.flags.serviceArea)) throw implausibleLocation();
    await this.prisma.driver.update({
      where: { id: driver.id },
      data: { online: true, lastLat: position.lat, lastLng: position.lng, lastLocationAt: now },
    });
    return this.state(userId);
  }

  /** Offline clears the last position (ADR-053); not allowed during a ride. */
  async goOffline(userId: string) {
    const driver = await this.driver(userId);
    if (await this.liveRide(driver.id)) throw rideInProgress();
    await this.prisma.$transaction(async (tx) => {
      await tx.rideOffer.updateMany({
        where: { driverId: driver.id, status: 'open' },
        data: { status: 'withdrawn', respondedAt: new Date() },
      });
      await tx.driver.update({
        where: { id: driver.id },
        data: { online: false, lastLat: null, lastLng: null, lastLocationAt: null },
      });
    });
    return this.state(userId);
  }

  /**
   * A position from the driver's phone: inside the service area and no faster than a car from the
   * last one. During a live ride it is kept as a ping, checked against the planned route, and
   * published rounded to the rider (ADR-052, ADR-053). A fix the phone queued and sends late
   * (older than the last one) is judged over the real gap between the two and kept in the ride's
   * history, but never moves the driver back, re-runs the route check or reaches the rider.
   */
  async location(userId: string, position: GeoPoint, recordedAt?: string): Promise<void> {
    const driver = await this.driver(userId);
    const ride = await this.liveRide(driver.id);
    // Offline (or just suspended) drivers send no positions, except to finish a ride under way.
    if (!driver.online && !ride) throw notDriving('offline');
    if (!withinBounds(position, this.flags.serviceArea)) throw implausibleLocation();
    const now = new Date();
    const at = recordedAt ? new Date(recordedAt) : now;
    if (at.getTime() > now.getTime() + 60_000 || at.getTime() < now.getTime() - 5 * 60_000) {
      throw implausibleLocation();
    }
    const last = driver.lastLocationAt;
    if (driver.lastLat !== null && driver.lastLng !== null && last) {
      const seconds = Math.max(1, Math.abs(at.getTime() - last.getTime()) / 1000);
      const metres = haversineMetres({ lat: driver.lastLat, lng: driver.lastLng }, position);
      if (metres / seconds > MAX_SPEED_METRES_PER_SECOND) throw implausibleLocation();
    }
    const late = last !== null && at.getTime() < last.getTime();
    if (!late) {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { lastLat: position.lat, lastLng: position.lng, lastLocationAt: at },
      });
    }
    if (!ride) return;
    await this.prisma.rideLocationPing.create({
      data: { rideId: ride.id, lat: position.lat, lng: position.lng, recordedAt: at },
    });
    if (late) return;
    if (ride.status === 'in_progress') await this.checkRoute(ride, position, at);
    await this.publisher.toRide(ride.id, {
      type: 'ride.location',
      rideId: ride.id,
      position: { ...roundPoint(position), at: at.toISOString() },
      etaSeconds: etaSeconds(position, rideTarget(ride)),
    });
  }

  async offers(userId: string): Promise<z.infer<typeof rideOfferListSchema>> {
    const driver = await this.driver(userId);
    const rows = await this.prisma.rideOffer.findMany({
      where: { driverId: driver.id, status: 'open', expiresAt: { gt: new Date() } },
      include: {
        ride: {
          include: {
            bookingItem: { select: { payload: true } },
            booking: { select: { price: true, currency: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      offers: rows.map((offer) => {
        const payload = rideItemPayload(offer.ride);
        return {
          id: offer.id,
          rideId: offer.rideId,
          category: offer.ride.category,
          pickupLabel: offer.ride.pickupLabel,
          pickup: { lat: offer.ride.pickupLat, lng: offer.ride.pickupLng },
          dropoffLabel: offer.ride.dropoffLabel,
          distanceToPickupMetres: offer.distanceMetres,
          tripDistanceMetres: offer.ride.distanceMetres,
          earnings: toWire(driverEarnings(payload, offer.ride.booking)),
          expiresAt: offer.expiresAt.toISOString(),
        };
      }),
    };
  }

  /** Accepts an open offer: one acceptance wins (conditional updates and a unique index). */
  async accept(offerId: string, caller: DriverCaller): Promise<z.infer<typeof driverRideSchema>> {
    const driver = await this.driver(caller.userId);
    const rideId = await this.prisma.$transaction(async (tx) => {
      const [offer] = await tx.$queryRaw<
        { ride_id: string; driver_id: string; status: string; expires_at: Date }[]
      >`SELECT ride_id, driver_id, status, expires_at FROM ride_offers WHERE id = ${offerId}::uuid FOR UPDATE`;
      if (offer?.driver_id !== driver.id) throw new NotFoundException();
      if (offer.status !== 'open' || offer.expires_at <= new Date()) throw offerGone();
      const vehicle = await tx.driverVehicle.findFirst({
        where: { driverId: driver.id, active: true, status: 'approved' },
      });
      if (!vehicle) throw notDriving('no_vehicle');
      const ride = await tx.ride.findUniqueOrThrow({ where: { id: offer.ride_id } });
      try {
        await this.transitions.apply(
          tx,
          ride,
          'accept',
          { kind: 'driver', userId: caller.userId },
          {
            data: { driverId: driver.id, vehicleId: vehicle.id, assignedAt: new Date() },
            metadata: { offerId },
          },
        );
      } catch (error) {
        // Already driving another ride (unique live ride per driver) or the ride moved on.
        if ((error as { code?: string }).code === 'P2002') throw rideInProgress();
        throw error;
      }
      await tx.rideOffer.update({
        where: { id: offerId },
        data: { status: 'accepted', respondedAt: new Date() },
      });
      return ride.id;
    });
    rideMatches.add(1, { outcome: 'assigned' });
    await this.publisher.toRide(rideId, { type: 'ride.updated', rideId, status: 'assigned' });
    return this.driverRide(rideId, driver.id);
  }

  async decline(offerId: string, userId: string): Promise<void> {
    const driver = await this.driver(userId);
    const offer = await this.prisma.rideOffer.findUnique({ where: { id: offerId } });
    if (offer?.driverId !== driver.id) throw new NotFoundException();
    const { count } = await this.prisma.rideOffer.updateMany({
      where: { id: offerId, status: 'open' },
      data: { status: 'declined', respondedAt: new Date() },
    });
    if (count === 0) throw offerGone();
  }

  async arrive(rideId: string, caller: DriverCaller) {
    const { driver, ride } = await this.assigned(rideId, caller.userId);
    await this.prisma.$transaction((tx) =>
      this.transitions.apply(
        tx,
        ride,
        'arrive',
        { kind: 'driver', userId: caller.userId },
        {
          data: { arrivedAt: new Date() },
        },
      ),
    );
    await this.publisher.toRide(rideId, { type: 'ride.updated', rideId, status: 'arrived' });
    return this.driverRide(rideId, driver.id);
  }

  /**
   * Starts the trip with the rider's PIN (ADR-050). A wrong PIN counts an attempt; the fifth
   * locks the ride and raises a safety incident. The attempt is kept even though the call fails.
   * Guesses are checked one at a time under the ride's row lock, so parallel calls cannot get
   * past the lockout or start a ride that another call has just locked.
   */
  async start(rideId: string, pin: string, caller: DriverCaller) {
    const { driver } = await this.assigned(rideId, caller.userId);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rides WHERE id = ${rideId}::uuid FOR UPDATE`;
      const ride = await tx.ride.findUniqueOrThrow({
        where: { id: rideId },
        select: { id: true, status: true, driverId: true, pinHash: true, pinLockedAt: true },
      });
      if (ride.driverId !== driver.id) return { kind: 'gone' } as const;
      if (ride.pinLockedAt) return { kind: 'locked' } as const;
      if (ride.status !== 'arrived') return { kind: 'conflict' } as const;
      if (await this.hasher.verify(ride.pinHash, pin)) {
        await this.transitions.apply(
          tx,
          ride,
          'start',
          { kind: 'driver', userId: caller.userId },
          { data: { startedAt: new Date() } },
        );
        return { kind: 'started' } as const;
      }
      const updated = await tx.ride.update({
        where: { id: rideId },
        data: { pinAttempts: { increment: 1 } },
        select: { pinAttempts: true, driver: { select: { lastLat: true, lastLng: true } } },
      });
      if (updated.pinAttempts >= RIDE_PIN_MAX_ATTEMPTS) {
        await tx.ride.update({ where: { id: rideId }, data: { pinLockedAt: new Date() } });
        await this.safety.raise('pin_lockout', rideId, lastPosition(updated.driver), tx);
        await this.audit.record(
          {
            action: 'ride.pin_locked',
            actorUserId: caller.userId,
            targetType: 'ride',
            targetId: rideId,
            context: caller.context,
          },
          tx,
        );
      }
      return { kind: 'wrong', attempts: updated.pinAttempts } as const;
    });
    switch (outcome.kind) {
      case 'gone':
        throw new NotFoundException();
      case 'locked':
        throw pinLocked();
      case 'conflict':
        throw rideConflict();
      case 'started':
        await this.publisher.toRide(rideId, {
          type: 'ride.updated',
          rideId,
          status: 'in_progress',
        });
        return this.driverRide(rideId, driver.id);
      case 'wrong':
        if (outcome.attempts >= RIDE_PIN_MAX_ATTEMPTS) throw pinLocked();
        throw pinInvalid(RIDE_PIN_MAX_ATTEMPTS - outcome.attempts);
    }
  }

  async complete(rideId: string, caller: DriverCaller) {
    const { driver, ride } = await this.assigned(rideId, caller.userId);
    const payload = rideItemPayload(ride);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${ride.bookingId}::uuid FOR UPDATE`;
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: ride.bookingId } });
      await this.transitions.apply(
        tx,
        ride,
        'complete',
        { kind: 'driver', userId: caller.userId },
        {
          data: { completedAt: new Date(), offRouteSince: null },
        },
      );
      const earnings = await this.settlement.complete(tx, ride, payload, booking);
      await this.audit.record(
        {
          action: 'ride.completed',
          actorUserId: caller.userId,
          targetType: 'ride',
          targetId: rideId,
          context: caller.context,
          metadata: { earningsMinor: earnings.minor.toString(), currency: earnings.currency },
        },
        tx,
      );
    });
    await this.publisher.toRide(rideId, { type: 'ride.updated', rideId, status: 'completed' });
    return this.driverRide(rideId, driver.id);
  }

  /** The driver hands the ride back: it searches again, never offered to them a second time. */
  async cancel(rideId: string, caller: DriverCaller): Promise<void> {
    const { ride } = await this.assigned(rideId, caller.userId);
    await this.prisma.$transaction((tx) =>
      this.transitions.apply(
        tx,
        ride,
        'driver_cancel',
        { kind: 'driver', userId: caller.userId },
        {
          data: {
            driverId: null,
            vehicleId: null,
            assignedAt: null,
            arrivedAt: null,
            searchStartedAt: new Date(),
            // The lockout was this driver's; the next one starts with the rider's PIN afresh.
            pinAttempts: 0,
            pinLockedAt: null,
          },
        },
      ),
    );
    await this.publisher.toRide(rideId, { type: 'ride.updated', rideId, status: 'searching' });
  }

  async current(userId: string): Promise<z.infer<typeof currentDriverRideSchema>> {
    const driver = await this.driver(userId);
    const ride = await this.liveRide(driver.id);
    return { ride: ride ? await this.driverRide(ride.id, driver.id) : null };
  }

  async earnings(userId: string): Promise<z.infer<typeof driverEarningsSchema>> {
    const driver = await this.driver(userId);
    const [accounts, rides, payouts] = await Promise.all([
      this.prisma.ledgerAccount.findMany({
        where: { code: { startsWith: driverEarningsPrefix(driver.id) } },
      }),
      this.prisma.ride.findMany({
        where: { driverId: driver.id, status: 'completed' },
        include: {
          bookingItem: { select: { payload: true } },
          booking: { select: { price: true, currency: true } },
        },
        orderBy: { completedAt: 'desc' },
        take: 50,
      }),
      this.prisma.driverPayout.findMany({
        where: { driverId: driver.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const ngn = accounts.find((account) => account.currency === 'NGN') ?? accounts[0];
    const currency = ngn?.currency ?? 'NGN';
    const earned = ngn ? await this.earnedSince(ngn.id, new Date()) : { today: 0n, week: 0n };
    return {
      balance: toWire(money(ngn?.balanceMinor ?? 0n, currency)),
      summary: {
        timeZone: EARNINGS_TIME_ZONE,
        today: toWire(money(earned.today, currency)),
        last7Days: toWire(money(earned.week, currency)),
      },
      rides: rides.map((ride) => ({
        rideId: ride.id,
        completedAt: ride.completedAt?.toISOString() ?? null,
        earnings: toWire(driverEarnings(rideItemPayload(ride), ride.booking)),
      })),
      payouts: payouts.map((payout) => ({
        id: payout.id,
        amount: toWire(money(payout.amountMinor, payout.currency)),
        status: payout.status,
        createdAt: payout.createdAt.toISOString(),
        settledAt: payout.settledAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Fares and cancellation-fee shares credited today and over the last seven days (today
   * included), by Lagos calendar day. Payouts and their reversals are not earnings.
   */
  private async earnedSince(
    accountId: string,
    now: Date,
  ): Promise<{ today: bigint; week: bigint }> {
    const today = localDate(now, EARNINGS_TIME_ZONE);
    const todayStart = localToUtc(`${today}T00:00`, EARNINGS_TIME_ZONE);
    const weekStart = localToUtc(`${addDays(today, -6)}T00:00`, EARNINGS_TIME_ZONE);
    const [row] = await this.prisma.$queryRaw<{ today: bigint; week: bigint }[]>`
      SELECT COALESCE(SUM(e.amount_minor) FILTER (WHERE e.created_at >= ${todayStart}), 0)::bigint AS today,
             COALESCE(SUM(e.amount_minor), 0)::bigint AS week
      FROM ledger_entries e
      JOIN ledger_transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ${accountId}::uuid
        AND e.direction = 'credit'
        AND e.created_at >= ${weekStart}
        AND t.kind IN ('ride_earnings', 'cancellation_fee')`;
    return row ?? { today: 0n, week: 0n };
  }

  /** The caller's driver record; 404 for accounts that never applied. */
  async driver(userId: string): Promise<Driver> {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException();
    return driver;
  }

  private liveRide(driverId: string): Promise<RideRecord | null> {
    return this.prisma.ride.findFirst({
      where: { driverId, status: { in: [...RIDE_LIVE_STATUSES] } },
      include: RIDE_INCLUDE,
    });
  }

  private async assigned(
    rideId: string,
    userId: string,
  ): Promise<{ driver: Driver; ride: RideRecord }> {
    const driver = await this.driver(userId);
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: RIDE_INCLUDE,
    });
    if (ride?.driverId !== driver.id) throw new NotFoundException();
    return { driver, ride };
  }

  private async driverRide(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUniqueOrThrow({
      where: { id: rideId },
      include: RIDE_INCLUDE,
    });
    if (ride.driverId !== driverId) throw new NotFoundException();
    const rider = await this.prisma.bookingPassenger.findFirst({
      where: { bookingId: ride.bookingId },
      orderBy: { position: 'asc' },
      select: { givenNames: true },
    });
    return toDriverRide(
      ride,
      rider?.givenNames ?? '',
      driverEarnings(rideItemPayload(ride), ride.booking),
    );
  }

  /**
   * Route deviation (ADR-053, safety suite): off the planned route by more than
   * RIDE_DEVIATION_METRES for longer than RIDE_DEVIATION_SECONDS raises one incident per ride.
   */
  private async checkRoute(ride: RideRecord, position: GeoPoint, at: Date): Promise<void> {
    if (!this.flags.enabled('safety_suite') || !ride.polyline) return;
    const off =
      distanceToRouteMetres(position, decodePolyline(ride.polyline)) >
      this.config.RIDE_DEVIATION_METRES;
    if (!off) {
      if (ride.offRouteSince) {
        await this.prisma.ride.update({ where: { id: ride.id }, data: { offRouteSince: null } });
      }
      return;
    }
    if (!ride.offRouteSince) {
      await this.prisma.ride.update({ where: { id: ride.id }, data: { offRouteSince: at } });
      return;
    }
    if (at.getTime() - ride.offRouteSince.getTime() >= this.config.RIDE_DEVIATION_SECONDS * 1000) {
      await this.safety.raise('route_deviation', ride.id, position);
    }
  }
}
