import {
  decodePolyline,
  haversineMetres,
  RIDE_LIVE_STATUSES,
  ridePinSchema,
  type GeoPoint,
  type RideCategory,
} from '@suskii/shared';

import type { RequestContext } from '../src/common/request-context';
import type { AppConfig } from '../src/config/config';
import type { PrismaService } from '../src/infra/prisma.service';
import type { RideDispatchService } from '../src/rides/ride-dispatch.service';
import type { DriverCaller, RideDriverService } from '../src/rides/ride-driver.service';

/** Close enough to a pick-up or drop-off to stop there. */
const ARRIVAL_METRES = 25;
/** How far from a waiting pick-up a summoned driver comes online. */
const SUMMON_METRES = { min: 700, max: 1300 };
/** Idle drivers re-send their position this often, well inside RIDE_LOCATION_FRESH_SECONDS. */
const IDLE_PING_MS = 20_000;
/** A skipped PIN prompt comes back after this long. */
const PIN_RETRY_MS = 30_000;
/** The longest step after a pause: a driver never jumps further than this much driving. */
const MAX_STEP_SECONDS = 30;
/** Under the API's 50 m/s plausibility limit, so no fix is refused as "not a car". */
export const MAX_DEMO_SPEED = 45;

const CONTEXT: RequestContext = {
  ip: '127.0.0.1',
  userAgent: 'suskii-demo-drivers',
  requestId: 'demo-drivers',
};

/** Where the rider's PIN comes from: the person testing reads it off the rider's screen. */
export interface PinSource {
  /** The PIN to try, or null to keep the driver waiting at the pick-up for now. */
  pinFor(ride: { id: string; pickupLabel: string }): Promise<string | null>;
}

export interface SimulatorOptions {
  prisma: PrismaService;
  drivers: RideDriverService;
  dispatch: RideDispatchService;
  config: Pick<AppConfig, 'NODE_ENV' | 'RIDE_MATCH_RADIUS_METRES'>;
  pins: PinSource;
  report: (line: string) => void;
  /** Metres per second on the road (at most MAX_DEMO_SPEED). */
  speed: number;
  now?: () => Date;
  random?: () => number;
}

/** Moves `metres` along `path` from `from`, dropping waypoints as they are reached. */
export function advance(
  from: GeoPoint,
  path: readonly GeoPoint[],
  metres: number,
): { position: GeoPoint; path: GeoPoint[] } {
  let position = from;
  let budget = metres;
  const rest = [...path];
  while (budget > 0) {
    const next = rest[0];
    if (!next) break;
    const gap = haversineMetres(position, next);
    if (gap <= budget) {
      budget -= gap;
      position = next;
      rest.shift();
      continue;
    }
    const share = budget / gap;
    position = {
      lat: position.lat + (next.lat - position.lat) * share,
      lng: position.lng + (next.lng - position.lng) * share,
    };
    budget = 0;
  }
  return { position, path: rest };
}

/** A point `metres` from `origin` on a compass bearing (flat-earth approximation, fine in a city). */
export function offset(origin: GeoPoint, metres: number, bearingDegrees: number): GeoPoint {
  const bearing = (bearingDegrees * Math.PI) / 180;
  const metresPerDegree = 111_320;
  return {
    lat: origin.lat + (metres * Math.cos(bearing)) / metresPerDegree,
    lng:
      origin.lng +
      (metres * Math.sin(bearing)) / (metresPerDegree * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

const short = (id: string): string => id.slice(-6);

interface Leg {
  phase: 'pickup' | 'dropoff';
  path: GeoPoint[];
}

interface WaitingRide {
  id: string;
  category: RideCategory;
  pickupLabel: string;
  pickupLat: number;
  pickupLng: number;
  riderUserId: string;
}

interface LiveRide {
  id: string;
  status: string;
  pickupLabel: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLabel: string;
  dropoffLat: number;
  dropoffLng: number;
  polyline: string;
  pinLockedAt: Date | null;
  driver: {
    userId: string;
    givenNames: string;
    lastLat: number | null;
    lastLng: number | null;
    lastLocationAt: Date | null;
  } | null;
}

/**
 * Sample drivers for trying rides on a local or test stack (ADR-056). Each tick it brings an idle
 * sample driver of the right category online near every ride still waiting for one, runs the
 * dispatcher (the API's lock makes this safe beside a worker), accepts their offers, drives them
 * to the pick-up and then along the planned route, and completes the ride. Every change goes
 * through `RideDriverService`, the same rules a driver's phone meets: state machine, position
 * plausibility, the PIN check, settlement and the realtime events the rider's app shows.
 *
 * It never reads the rider's PIN: like a real driver, it asks for the code the rider reads out
 * (`PinSource`). Only drivers flagged `sample` (from `db:seed:demo`) are touched, and it refuses
 * to exist in production.
 */
export class DemoDriverSimulator {
  private readonly legs = new Map<string, Leg>();
  private readonly summoned = new Set<string>();
  private readonly asking = new Set<string>();
  private readonly pinRetryAt = new Map<string, number>();
  private readonly reported = new Set<string>();
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly speed: number;

  constructor(private readonly options: SimulatorOptions) {
    if (options.config.NODE_ENV === 'production') {
      throw new Error('Demo drivers drive sample accounts and never run in production');
    }
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.speed = Math.min(Math.max(options.speed, 1), MAX_DEMO_SPEED);
  }

  async tick(): Promise<void> {
    const now = this.now();
    await this.summon(now);
    await this.options.dispatch.run(now);
    await this.answerOffers(now);
    await this.drive(now);
    await this.keepIdleFresh(now);
  }

  /** Takes the idle sample drivers offline again (drivers on a ride finish it first). */
  async stop(): Promise<number> {
    const online = await this.options.prisma.driver.findMany({
      where: { sample: true, online: true },
      select: { userId: true },
    });
    let stopped = 0;
    for (const driver of online) {
      try {
        await this.options.drivers.goOffline(driver.userId);
        stopped += 1;
      } catch {
        // On a live ride: it stays online until the ride ends.
      }
    }
    return stopped;
  }

  /**
   * For each ride waiting without an open offer, an idle sample driver of its category comes
   * online about a kilometre away, unless a free one is already within the match radius (then the
   * dispatcher offers it the ride; if it does not, the next tick looks again).
   */
  private async summon(now: Date): Promise<void> {
    const waiting = await this.options.prisma.ride.findMany({
      where: { status: 'searching', offers: { none: { status: 'open' } } },
      select: {
        id: true,
        category: true,
        pickupLabel: true,
        pickupLat: true,
        pickupLng: true,
        riderUserId: true,
      },
      orderBy: { searchStartedAt: 'asc' },
      take: 10,
    });
    for (const ride of waiting) {
      if (this.summoned.has(ride.id)) continue;
      try {
        await this.summonFor(ride, now);
      } catch (error) {
        this.options.report(
          `Could not place a driver for ride ${short(ride.id)}: ${describeError(error)}`,
        );
      }
    }
  }

  private async summonFor(ride: WaitingRide, now: Date): Promise<void> {
    const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };
    if (await this.idleNearby(ride.category, pickup, ride.riderUserId, now)) return;
    const driver = await this.options.prisma.driver.findFirst({
      where: {
        sample: true,
        status: 'approved',
        userId: { not: ride.riderUserId },
        vehicles: { some: { active: true, status: 'approved', category: ride.category } },
        rides: { none: { status: { in: [...RIDE_LIVE_STATUSES] } } },
        offers: { none: { status: 'open' } },
      },
      orderBy: [{ online: 'asc' }, { lastLocationAt: 'asc' }],
      select: { userId: true, givenNames: true, online: true },
    });
    if (!driver) {
      this.once(`busy:${ride.category}`, `No free sample driver for a ${ride.category} ride yet`);
      return;
    }
    // Offline first: the API only places a driver freely when they come online.
    if (driver.online) await this.options.drivers.goOffline(driver.userId);
    const distance = SUMMON_METRES.min + this.random() * (SUMMON_METRES.max - SUMMON_METRES.min);
    const start = offset(pickup, distance, this.random() * 360);
    await this.options.drivers.goOnline(driver.userId, start, now);
    this.summoned.add(ride.id);
    this.options.report(
      `${driver.givenNames} is online ${Math.round(distance)} m from ${ride.pickupLabel} (ride ${short(ride.id)})`,
    );
  }

  private async idleNearby(
    category: RideCategory,
    pickup: GeoPoint,
    riderUserId: string,
    now: Date,
  ): Promise<boolean> {
    const fresh = new Date(now.getTime() - IDLE_PING_MS * 2);
    const idle = await this.options.prisma.driver.findMany({
      where: {
        sample: true,
        online: true,
        userId: { not: riderUserId },
        lastLocationAt: { gte: fresh },
        vehicles: { some: { active: true, status: 'approved', category } },
        rides: { none: { status: { in: [...RIDE_LIVE_STATUSES] } } },
        offers: { none: { status: 'open' } },
      },
      select: { lastLat: true, lastLng: true },
    });
    return idle.some(
      (driver) =>
        driver.lastLat !== null &&
        driver.lastLng !== null &&
        haversineMetres({ lat: driver.lastLat, lng: driver.lastLng }, pickup) <=
          this.options.config.RIDE_MATCH_RADIUS_METRES,
    );
  }

  private async answerOffers(now: Date): Promise<void> {
    const offers = await this.options.prisma.rideOffer.findMany({
      where: { status: 'open', expiresAt: { gt: now }, driver: { sample: true } },
      select: {
        id: true,
        rideId: true,
        driver: { select: { userId: true, givenNames: true } },
        ride: { select: { pickupLabel: true, dropoffLabel: true } },
      },
    });
    for (const offer of offers) {
      try {
        await this.options.drivers.accept(offer.id, this.caller(offer.driver.userId));
        this.options.report(
          `${offer.driver.givenNames} accepted ride ${short(offer.rideId)}: ${offer.ride.pickupLabel} to ${offer.ride.dropoffLabel}`,
        );
      } catch (error) {
        // Withdrawn, expired or cancelled in the meantime: the next tick sees the new state.
        this.options.report(
          `Offer for ride ${short(offer.rideId)} lapsed (${describeError(error)})`,
        );
      }
    }
  }

  private async drive(now: Date): Promise<void> {
    const rides = await this.options.prisma.ride.findMany({
      where: { status: { in: [...RIDE_LIVE_STATUSES] }, driver: { sample: true } },
      select: {
        id: true,
        status: true,
        pickupLabel: true,
        pickupLat: true,
        pickupLng: true,
        dropoffLabel: true,
        dropoffLat: true,
        dropoffLng: true,
        polyline: true,
        pinLockedAt: true,
        driver: {
          select: {
            userId: true,
            givenNames: true,
            lastLat: true,
            lastLng: true,
            lastLocationAt: true,
          },
        },
      },
    });
    const live = new Set(rides.map((ride) => ride.id));
    for (const id of this.legs.keys()) if (!live.has(id)) this.legs.delete(id);
    for (const ride of rides) {
      try {
        await this.driveRide(ride, now);
      } catch (error) {
        this.options.report(`Ride ${short(ride.id)}: ${describeError(error)}`);
      }
    }
  }

  private async driveRide(ride: LiveRide, now: Date): Promise<void> {
    const driver = ride.driver;
    if (!driver) return;
    const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };
    const dropoff = { lat: ride.dropoffLat, lng: ride.dropoffLng };
    const here =
      driver.lastLat !== null && driver.lastLng !== null
        ? { lat: driver.lastLat, lng: driver.lastLng }
        : pickup;
    const caller = this.caller(driver.userId);
    // Steps are timed from the driver's last fix, the same clock the API's speed check uses.
    const seconds = driver.lastLocationAt
      ? Math.min(
          Math.max((now.getTime() - driver.lastLocationAt.getTime()) / 1000, 0),
          MAX_STEP_SECONDS,
        )
      : 0;
    if (ride.status === 'assigned') {
      const at = await this.move(ride.id, 'pickup', [pickup], here, seconds, driver.userId);
      if (haversineMetres(at, pickup) <= ARRIVAL_METRES) {
        await this.options.drivers.arrive(ride.id, caller);
        this.options.report(
          `${driver.givenNames} arrived at ${ride.pickupLabel} (ride ${short(ride.id)}): read the PIN from the rider's app`,
        );
        this.askForPin({ ...ride, pinLockedAt: null }, caller, now);
      }
    } else if (ride.status === 'arrived') {
      this.askForPin(ride, caller, now);
    } else if (ride.status === 'in_progress') {
      const route = ride.polyline ? decodePolyline(ride.polyline) : [];
      const at = await this.move(
        ride.id,
        'dropoff',
        [...route, dropoff],
        here,
        seconds,
        driver.userId,
      );
      if (haversineMetres(at, dropoff) <= ARRIVAL_METRES) {
        await this.options.drivers.complete(ride.id, caller);
        this.options.report(
          `${driver.givenNames} completed ride ${short(ride.id)} at ${ride.dropoffLabel}`,
        );
      }
    }
  }

  /** One step along the leg, reported as the driver's position (route checks included). */
  private async move(
    rideId: string,
    phase: Leg['phase'],
    plan: GeoPoint[],
    here: GeoPoint,
    seconds: number,
    userId: string,
  ): Promise<GeoPoint> {
    const current = this.legs.get(rideId);
    const leg = current?.phase === phase ? current : { phase, path: plan };
    const step = advance(here, leg.path, this.speed * seconds);
    this.legs.set(rideId, { phase, path: step.path });
    await this.options.drivers.location(userId, step.position);
    return step.position;
  }

  private askForPin(
    ride: { id: string; pickupLabel: string; pinLockedAt: Date | null },
    caller: DriverCaller,
    now: Date,
  ): void {
    if (ride.pinLockedAt) {
      this.once(`locked:${ride.id}`, `Ride ${short(ride.id)} is locked after too many wrong PINs`);
      return;
    }
    if (this.asking.has(ride.id) || (this.pinRetryAt.get(ride.id) ?? 0) > now.getTime()) return;
    this.asking.add(ride.id);
    void this.options.pins
      .pinFor(ride)
      .then(async (pin) => {
        if (pin === null) {
          this.pinRetryAt.set(ride.id, this.now().getTime() + PIN_RETRY_MS);
          return;
        }
        // A typo is not a guess: only well-formed PINs reach the API's attempt counter.
        if (!ridePinSchema.safeParse(pin).success) {
          this.options.report('A PIN is four digits; try again');
          return;
        }
        await this.options.drivers.start(ride.id, pin, caller);
        this.options.report(`Trip started (ride ${short(ride.id)})`);
      })
      .catch((error: unknown) => {
        this.options.report(`Could not start ride ${short(ride.id)}: ${describeError(error)}`);
      })
      .finally(() => this.asking.delete(ride.id));
  }

  /** Idle online sample drivers keep a fresh position, so they stay eligible for nearby rides. */
  private async keepIdleFresh(now: Date): Promise<void> {
    const stale = await this.options.prisma.driver.findMany({
      where: {
        sample: true,
        online: true,
        lastLocationAt: { lt: new Date(now.getTime() - IDLE_PING_MS) },
        rides: { none: { status: { in: [...RIDE_LIVE_STATUSES] } } },
      },
      select: { userId: true, lastLat: true, lastLng: true },
    });
    for (const driver of stale) {
      if (driver.lastLat === null || driver.lastLng === null) continue;
      try {
        await this.options.drivers.location(driver.userId, {
          lat: driver.lastLat,
          lng: driver.lastLng,
        });
      } catch (error) {
        this.options.report(`An idle driver's position was refused: ${describeError(error)}`);
      }
    }
  }

  private caller(userId: string): DriverCaller {
    return { userId, context: CONTEXT };
  }

  private once(key: string, line: string): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.options.report(line);
  }
}

/**
 * A readable reason. Problem details are matched by shape: the CLI runs the API's build output,
 * whose classes are not the ones this module would import from src.
 */
export function describeError(error: unknown): string {
  const problem = error as { title?: unknown; extensions?: { attemptsLeft?: unknown } };
  if (typeof problem.title === 'string') {
    const left = problem.extensions?.attemptsLeft;
    return typeof left === 'number' ? `${problem.title}, ${left} tries left` : problem.title;
  }
  return error instanceof Error ? error.message : String(error);
}
