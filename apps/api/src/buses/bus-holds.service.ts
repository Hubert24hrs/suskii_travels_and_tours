import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { seatSelectionIssue, type BusSeatLayout } from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';
import type { BusSeatHold } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { busHolds } from '../telemetry/metrics';
import { seatTaken } from '../bookings/seat-inventory';

/** Departures stop selling this long before they leave. */
export const SALES_CLOSE_MINUTES = 30;

/**
 * Holds every seat or none (ADR-051): returns the 1-based index of the first seat already held,
 * or 0 once all seats are set to the hold id with the TTL. Keys share a hash tag (the trip), so
 * the script also runs on a Redis cluster.
 */
const HOLD_SEATS = `
for i, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then return i end
end
for _, key in ipairs(KEYS) do
  redis.call('SET', key, ARGV[1], 'PX', ARGV[2])
end
return 0`;

/** Deletes only the keys this hold still owns; a lapsed and re-taken seat is left alone. */
const RELEASE_SEATS = `
local released = 0
for _, key in ipairs(KEYS) do
  if redis.call('GET', key) == ARGV[1] then
    redis.call('DEL', key)
    released = released + 1
  end
end
return released`;

export const seatKey = (tripId: string, seat: string): string => `bus:hold:{${tripId}}:${seat}`;

export const tripClosed = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'trip-closed',
    'This departure is no longer on sale',
    'Choose another departure.',
  );

export const seatInvalid = (code: string): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'seat-invalid',
    'These seats cannot be selected',
    'Choose seats from the seat map, at most six at a time.',
    { code },
  );

export const holdLimit = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'hold-limit',
    'Too many seat holds',
    'Finish or release the seats you are holding before choosing more.',
  );

export interface HoldCaller {
  userId: string | null;
  ip: string;
  /** The guest's hold token (quotes and release). */
  holdToken?: string | null;
}

export interface CreatedHold {
  holdId: string;
  holdToken: string | null;
  tripId: string;
  seats: string[];
  expiresAt: Date;
}

/**
 * Bus seat holds (ADR-051): Redis decides who holds a seat while the hold lives, written by one
 * script for all seats; a `bus_seat_holds` row records it for audit, limits and the booking that
 * claims it. Guests get a random hold token (stored as an HMAC), accounts are matched by id.
 */
@Injectable()
export class BusHoldsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
  ) {}

  async create(
    tripId: string,
    seats: readonly string[],
    caller: HoldCaller,
    now = new Date(),
  ): Promise<CreatedHold> {
    try {
      const hold = await this.place(tripId, seats, caller, now);
      busHolds.add(1, { outcome: 'held' });
      return hold;
    } catch (error) {
      const slug = error instanceof ProblemDetailsException ? error.slug : null;
      if (slug === 'seat-taken' || slug === 'hold-limit') {
        busHolds.add(1, { outcome: slug === 'seat-taken' ? 'seat_taken' : 'hold_limit' });
      }
      throw error;
    }
  }

  private async place(
    tripId: string,
    seats: readonly string[],
    caller: HoldCaller,
    now: Date,
  ): Promise<CreatedHold> {
    const trip = await this.sellableTrip(tripId, now);
    const layout = trip.layout.layout as unknown as BusSeatLayout;
    const issue = seatSelectionIssue(layout, seats);
    if (issue) throw seatInvalid(issue);
    if (seats.some((seat) => trip.blockedSeats.includes(seat))) throw seatTaken();
    const sold = await this.prisma.busSeatAssignment.count({
      where: { tripId, active: true, seatNumber: { in: [...seats] } },
    });
    if (sold > 0) throw seatTaken();

    const ipHash = this.hmac.digest('ip', caller.ip);
    const live = await this.prisma.busSeatHold.count({
      where: {
        expiresAt: { gt: now },
        releasedAt: null,
        bookingItemId: null,
        ...(caller.userId ? { userId: caller.userId } : { userId: null, ipHash }),
      },
    });
    if (live >= this.config.BUS_MAX_ACTIVE_HOLDS) throw holdLimit();

    const holdId = uuidv7();
    const ttlMs = this.config.BUS_SEAT_HOLD_MINUTES * 60_000;
    const expiresAt = new Date(now.getTime() + ttlMs);
    const keys = seats.map((seat) => seatKey(tripId, seat));
    const taken = Number(await this.redis.eval(HOLD_SEATS, keys.length, ...keys, holdId, ttlMs));
    if (taken !== 0) throw seatTaken();

    const holdToken = caller.userId ? null : randomToken(24);
    try {
      await this.prisma.busSeatHold.create({
        data: {
          id: holdId,
          tripId,
          seats: [...seats],
          userId: caller.userId,
          guestTokenHash: holdToken ? this.hmac.digest('bus-hold', holdToken) : null,
          ipHash,
          expiresAt,
        },
      });
    } catch (error) {
      await this.redis.eval(RELEASE_SEATS, keys.length, ...keys, holdId);
      throw error;
    }
    return { holdId, holdToken, tripId, seats: [...seats], expiresAt };
  }

  /**
   * The caller's live, unused hold: 404 for anyone else's or a missing one, 409 `seat-taken`
   * once it has lapsed, been released or been booked.
   */
  async live(holdId: string, caller: HoldCaller, now = new Date()): Promise<BusSeatHold> {
    const hold = await this.prisma.busSeatHold.findUnique({ where: { id: holdId } });
    if (!hold || !this.owns(hold, caller)) throw new NotFoundException();
    if (hold.releasedAt || hold.bookingItemId || hold.expiresAt <= now) throw seatTaken();
    return hold;
  }

  async release(holdId: string, caller: HoldCaller, now = new Date()): Promise<void> {
    const hold = await this.prisma.busSeatHold.findUnique({ where: { id: holdId } });
    if (!hold || !this.owns(hold, caller)) throw new NotFoundException();
    // A booked hold belongs to its booking now; cancel the booking instead.
    if (hold.releasedAt || hold.bookingItemId) return;
    const keys = hold.seats.map((seat) => seatKey(hold.tripId, seat));
    await this.redis.eval(RELEASE_SEATS, keys.length, ...keys, hold.id);
    await this.prisma.busSeatHold.updateMany({
      where: { id: hold.id, releasedAt: null, bookingItemId: null },
      data: { releasedAt: now },
    });
  }

  /** Seats held right now, from Redis (the source of truth while holds live). */
  async heldSeats(tripId: string, seats: readonly string[]): Promise<Set<string>> {
    if (seats.length === 0) return new Set();
    const values = await this.redis.mget(...seats.map((seat) => seatKey(tripId, seat)));
    return new Set(seats.filter((_, index) => values[index] !== null));
  }

  async sellableTrip(tripId: string, now: Date) {
    const trip = await this.prisma.busTrip.findUnique({
      where: { id: tripId },
      include: {
        layout: true,
        route: { include: { operator: true, origin: true, destination: true } },
      },
    });
    if (trip?.route.operator.status !== 'published') throw new NotFoundException();
    if (
      trip.status !== 'scheduled' ||
      !trip.route.active ||
      trip.departsAt.getTime() <= now.getTime() + SALES_CLOSE_MINUTES * 60_000
    ) {
      throw tripClosed();
    }
    return trip;
  }

  private owns(hold: BusSeatHold, caller: HoldCaller): boolean {
    if (hold.userId) return hold.userId === caller.userId;
    return (
      !!caller.holdToken &&
      !!hold.guestTokenHash &&
      this.hmac.verify('bus-hold', caller.holdToken, hold.guestTokenHash)
    );
  }
}
