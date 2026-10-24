import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { RideCategory } from '@suskii/shared';

import { SYSTEM_ACTOR } from '../bookings/booking-transitions';
import { RefundsService } from '../bookings/refunds.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { randomToken } from '../crypto/random';
import { CarsFlags } from '../ground/cars-flags';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { rideMatches } from '../telemetry/metrics';

import { RideEventsPublisher } from './ride-events.publisher';
import { RideSettlementService } from './ride-settlement.service';
import { RideTransitions } from './ride-transitions';

const LOCK_KEY = 'lock:ride-dispatch';
const LOCK_TTL_MS = 30_000;
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
/** Rides matched per run; the worker runs every few seconds, so a backlog drains quickly. */
const BATCH = 200;

export interface DispatchRun {
  started: number;
  offered: number;
  expired: number;
  timedOut: number;
}

interface Candidate {
  id: string;
  distance: number;
}

/**
 * Matching (ADR-053), run by the worker every few seconds through `/v1/internal/rides/dispatch`:
 * scheduled rides start searching shortly before pickup, unanswered offers expire, rides nobody
 * accepts in time end as `no_driver` with a full refund, and every searching ride without an
 * open offer is offered to the nearest eligible driver.
 *
 * Proximity uses Postgres `earthdistance` with a GiST index on the drivers' last positions
 * (`earth_box` narrows, `earth_distance` orders), so no PostGIS is needed. Offers are exclusive
 * on both sides (one open offer per ride and per driver, partial unique indexes): two replicas
 * racing to offer the same driver or ride cannot both succeed. One run at a time holds a Redis
 * lock; a run that cannot take it does nothing.
 */
@Injectable()
export class RideDispatchService {
  private readonly logger = new Logger(RideDispatchService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly transitions: RideTransitions,
    private readonly settlement: RideSettlementService,
    private readonly refunds: RefundsService,
    private readonly publisher: RideEventsPublisher,
    private readonly flags: CarsFlags,
  ) {}

  async run(now = new Date()): Promise<DispatchRun> {
    if (!this.flags.enabled('rides')) return { started: 0, offered: 0, expired: 0, timedOut: 0 };
    const token = randomToken(16);
    const acquired = await this.redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') return { started: 0, offered: 0, expired: 0, timedOut: 0 };
    try {
      const started = await this.startScheduled(now);
      const expired = await this.expireOffers(now);
      const timedOut = await this.timeOut(now);
      const offered = await this.match(now);
      return { started, offered, expired, timedOut };
    } finally {
      await this.redis.eval(RELEASE_LOCK, 1, LOCK_KEY, token);
    }
  }

  /** Scheduled rides begin searching RIDE_SCHEDULE_LEAD_MINUTES before pickup. */
  private async startScheduled(now: Date): Promise<number> {
    const due = await this.prisma.ride.findMany({
      where: {
        status: 'scheduled',
        scheduledFor: {
          lte: new Date(now.getTime() + this.config.RIDE_SCHEDULE_LEAD_MINUTES * 60_000),
        },
      },
      select: { id: true, status: true },
      take: BATCH,
    });
    let started = 0;
    for (const ride of due) {
      try {
        await this.prisma.$transaction((tx) =>
          this.transitions.apply(
            tx,
            ride,
            'dispatch',
            { kind: 'system' },
            { data: { searchStartedAt: now } },
          ),
        );
        started += 1;
        await this.publisher.toRide(ride.id, {
          type: 'ride.updated',
          rideId: ride.id,
          status: 'searching',
        });
      } catch (error) {
        // Cancelled meanwhile: the conditional update lost, nothing to do.
        this.logger.debug(
          { rideId: ride.id, reason: (error as Error).name },
          'scheduled ride not started',
        );
      }
    }
    return started;
  }

  private async expireOffers(now: Date): Promise<number> {
    const stale = await this.prisma.rideOffer.findMany({
      where: { status: 'open', expiresAt: { lte: now } },
      select: { id: true, rideId: true, driverId: true },
    });
    if (stale.length === 0) return 0;
    const { count } = await this.prisma.rideOffer.updateMany({
      where: { id: { in: stale.map((offer) => offer.id) }, status: 'open' },
      data: { status: 'expired', respondedAt: now },
    });
    for (const offer of stale) {
      await this.publisher.toDriver(offer.driverId, {
        type: 'offer.closed',
        offerId: offer.id,
        rideId: offer.rideId,
        reason: 'expired',
      });
    }
    return count;
  }

  /** Searching for longer than RIDE_MATCH_TIMEOUT_SECONDS: no driver, everything refunded. */
  private async timeOut(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.RIDE_MATCH_TIMEOUT_SECONDS * 1000);
    const due = await this.prisma.ride.findMany({
      where: { status: 'searching', searchStartedAt: { lte: cutoff } },
      select: { id: true, bookingId: true },
      take: BATCH,
    });
    let timedOut = 0;
    for (const { id, bookingId } of due) {
      try {
        const refundIds = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
          const ride = await tx.ride.findUniqueOrThrow({ where: { id } });
          await this.transitions.apply(
            tx,
            ride,
            'timeout',
            { kind: 'system' },
            {
              data: { cancelledAt: now, cancelledBy: 'system' },
            },
          );
          await tx.rideOffer.updateMany({
            where: { rideId: id, status: 'open' },
            data: { status: 'withdrawn', respondedAt: now },
          });
          const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
          return this.settlement.refundInFull(tx, booking, 'no_driver_found', SYSTEM_ACTOR);
        });
        this.refunds.executeLater(refundIds);
        timedOut += 1;
        rideMatches.add(1, { outcome: 'no_driver' });
        await this.publisher.toRide(id, { type: 'ride.updated', rideId: id, status: 'no_driver' });
      } catch (error) {
        this.logger.debug({ rideId: id, reason: (error as Error).name }, 'ride timeout skipped');
      }
    }
    return timedOut;
  }

  /** Offers each searching ride without an open offer to its nearest eligible driver. */
  private async match(now: Date): Promise<number> {
    const rides = await this.prisma.ride.findMany({
      where: { status: 'searching', offers: { none: { status: 'open' } } },
      select: {
        id: true,
        riderUserId: true,
        category: true,
        pickupLat: true,
        pickupLng: true,
      },
      orderBy: { searchStartedAt: 'asc' },
      take: BATCH,
    });
    let offered = 0;
    for (const ride of rides) {
      const candidate = await this.nearest(ride, now);
      if (!candidate) continue;
      const expiresAt = new Date(now.getTime() + this.config.RIDE_OFFER_SECONDS * 1000);
      try {
        const offer = await this.prisma.rideOffer.create({
          data: {
            rideId: ride.id,
            driverId: candidate.id,
            distanceMetres: candidate.distance,
            expiresAt,
          },
        });
        offered += 1;
        await this.publisher.toDriver(candidate.id, {
          type: 'offer.created',
          offerId: offer.id,
          rideId: ride.id,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error) {
        // Another replica offered this driver or ride first; the next run retries.
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }
    return offered;
  }

  /**
   * The nearest driver who can take the ride now: online, approved, a recent position inside the
   * match radius, an approved active vehicle of the ride's category, not on a live ride, not
   * holding another open offer, never offered this ride before, and not the rider themselves.
   */
  private async nearest(
    ride: {
      id: string;
      riderUserId: string;
      category: RideCategory;
      pickupLat: number;
      pickupLng: number;
    },
    now: Date,
  ): Promise<Candidate | null> {
    const radius = this.config.RIDE_MATCH_RADIUS_METRES;
    const fresh = new Date(now.getTime() - this.config.RIDE_LOCATION_FRESH_SECONDS * 1000);
    const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT d.id,
             earth_distance(ll_to_earth(d.last_lat, d.last_lng), ll_to_earth(${ride.pickupLat}, ${ride.pickupLng}))::int AS distance
        FROM drivers d
        JOIN driver_vehicles v
          ON v.driver_id = d.id AND v.active AND v.status = 'approved'
         AND v.category = ${ride.category}::"RideCategory"
       WHERE d.online
         AND d.status = 'approved'
         AND d.last_lat IS NOT NULL
         AND d.last_location_at >= ${fresh}
         AND d.user_id <> ${ride.riderUserId}::uuid
         AND earth_box(ll_to_earth(${ride.pickupLat}, ${ride.pickupLng}), ${radius}::float8)
             @> ll_to_earth(d.last_lat, d.last_lng)
         AND earth_distance(ll_to_earth(d.last_lat, d.last_lng), ll_to_earth(${ride.pickupLat}, ${ride.pickupLng})) <= ${radius}::float8
         AND NOT EXISTS (
               SELECT 1 FROM rides r
                WHERE r.driver_id = d.id AND r.status IN ('assigned', 'arrived', 'in_progress'))
         AND NOT EXISTS (
               SELECT 1 FROM ride_offers o
                WHERE o.driver_id = d.id AND (o.status = 'open' OR o.ride_id = ${ride.id}::uuid))
       ORDER BY distance
       LIMIT 1`;
    return rows[0] ?? null;
  }
}
