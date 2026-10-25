import { haversineMetres } from '@suskii/shared';

import {
  advance,
  DemoDriverSimulator,
  offset,
  type PinSource,
} from '../scripts/demo-driver-simulator';
import { APP_CONFIG, type AppConfig } from '../src/config/config';
import { driverEarningsPrefix } from '../src/ledger/ledger-accounts';
import { RideDispatchService } from '../src/rides/ride-dispatch.service';
import { RideDriverService } from '../src/rides/ride-driver.service';

import { staffSession } from './helpers/cars';
import { bearer, signUp } from './helpers/flows';
import { createDriver, LEKKI, requestRide, rideCatalog, VICTORIA_ISLAND } from './helpers/rides';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/** Seconds of road between ticks: the test ages the last fixes instead of waiting. */
const STEP_SECONDS = 30;

/**
 * Demo drivers (ADR-056): sample drivers take a real ride from request to completion through the
 * driver services, the PIN comes from what the rider sees, and nothing else is touched.
 */
describe('demo drivers (e2e)', () => {
  let ctx: TestContext;
  let rider: { userId: string; headers: Record<string, string> };
  let lines: string[];

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    const staff = (await staffSession(ctx, 'demo-ops@suskii.test', ['operations'])).headers;
    await rideCatalog(ctx, staff);
    const session = await signUp(ctx, 'demo-rider@example.com');
    rider = { userId: session.userId, headers: bearer(session.accessToken) };
    lines = [];
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  /** An offline sample driver far from Victoria Island (Festac Town, about 15 km). */
  async function sampleDriver(category: 'standard' | 'xl' = 'standard') {
    const driver = await createDriver(ctx, { lat: 6.4664, lng: 3.2836, online: false, category });
    await ctx.prisma.driver.update({ where: { id: driver.driverId }, data: { sample: true } });
    return driver;
  }

  function simulator(pins: PinSource): DemoDriverSimulator {
    return new DemoDriverSimulator({
      prisma: ctx.prisma,
      drivers: ctx.app.get(RideDriverService),
      dispatch: ctx.app.get(RideDispatchService),
      config: ctx.app.get<AppConfig>(APP_CONFIG),
      pins,
      report: (line) => lines.push(line),
      speed: 45,
      random: () => 0.5,
    });
  }

  /** As if `seconds` passed on the road: every driver's last fix gets that much older. */
  async function travel(seconds = STEP_SECONDS): Promise<void> {
    await ctx.prisma.$executeRaw`
      UPDATE drivers SET last_location_at = last_location_at - make_interval(secs => ${seconds})
       WHERE last_location_at IS NOT NULL`;
  }

  const rideRow = (rideId: string) => ctx.prisma.ride.findUniqueOrThrow({ where: { id: rideId } });

  /** What the rider's app shows, PIN included: the only place a driver can learn it. */
  const riderPin = async (rideId: string): Promise<string> => {
    const response = await ctx.http().get(`/v1/rides/${rideId}`).set(rider.headers).expect(200);
    return response.body.pin as string;
  };

  /** Ticks until the ride leaves `status`, letting PIN prompts (asynchronous) settle between. */
  async function tickWhile(demo: DemoDriverSimulator, rideId: string, status: string) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ride = await rideRow(rideId);
      if (ride.status !== status) return ride;
      await new Promise((resolve) => setTimeout(resolve, 100));
      await demo.tick();
    }
    throw new Error(`ride ${rideId} stayed ${status}`);
  }

  it('moves along a path and places points at a distance', () => {
    const start = { lat: 6.4281, lng: 3.4219 };
    const corner = offset(start, 300, 90);
    const end = offset(corner, 400, 0);
    expect(haversineMetres(start, corner)).toBeGreaterThan(295);
    expect(haversineMetres(start, corner)).toBeLessThan(305);
    const half = advance(start, [corner, end], 500);
    expect(half.path).toEqual([end]);
    expect(haversineMetres(half.position, end)).toBeGreaterThan(195);
    expect(haversineMetres(half.position, end)).toBeLessThan(205);
    expect(advance(start, [corner, end], 10_000)).toEqual({ position: end, path: [] });
  });

  it('refuses to run in production', () => {
    expect(
      () =>
        new DemoDriverSimulator({
          prisma: ctx.prisma,
          drivers: ctx.app.get(RideDriverService),
          dispatch: ctx.app.get(RideDispatchService),
          config: { NODE_ENV: 'production', RIDE_MATCH_RADIUS_METRES: 5000 },
          pins: { pinFor: () => Promise.resolve(null) },
          report: () => undefined,
          speed: 25,
        }),
    ).toThrow(/never run in production/);
  });

  it('takes a ride from request to completion with the PIN the rider reads out', async () => {
    const sample = await sampleDriver();
    // A real driver of the same category, offline: the simulator never touches them.
    const real = await createDriver(ctx, { lat: 6.4664, lng: 3.2836, online: false });
    const { rideId } = await requestRide(ctx, rider.headers, {
      pickup: VICTORIA_ISLAND,
      dropoff: LEKKI,
    });
    const asked: string[] = [];
    const answers = ['12ab', '0000', 'rider'];
    const demo = simulator({
      pinFor: async (ride) => {
        asked.push(ride.pickupLabel);
        const answer = answers.shift();
        // A typo, then a wrong guess, then the code from the rider's screen.
        return answer === 'rider' ? riderPin(ride.id) : (answer ?? null);
      },
    });

    // Summoned about a kilometre away, offered the ride and accepted it in one tick.
    await demo.tick();
    let ride = await rideRow(rideId);
    expect(ride.status).toBe('assigned');
    expect(ride.driverId).toBe(sample.driverId);
    const placed = await ctx.prisma.driver.findUniqueOrThrow({ where: { id: sample.driverId } });
    expect(placed.online).toBe(true);
    const fromPickup = haversineMetres(
      { lat: placed.lastLat ?? 0, lng: placed.lastLng ?? 0 },
      { lat: VICTORIA_ISLAND.lat, lng: VICTORIA_ISLAND.lng },
    );
    expect(fromPickup).toBeGreaterThan(900);
    expect(fromPickup).toBeLessThan(1100);

    // Drives to the pick-up at a plausible speed (the API checks every fix) and arrives.
    await travel();
    await demo.tick();
    expect((await rideRow(rideId)).status).toBe('arrived');

    // The malformed PIN is not sent; the wrong one costs an attempt; the rider's PIN starts it.
    ride = await tickWhile(demo, rideId, 'arrived');
    expect(ride.status).toBe('in_progress');
    expect(ride.pinAttempts).toBe(1);
    expect(asked).toEqual([VICTORIA_ISLAND.label, VICTORIA_ISLAND.label, VICTORIA_ISLAND.label]);
    const outcomes = lines.filter((line) => /four digits|tries left|Trip started/.test(line));
    expect(outcomes).toEqual([
      expect.stringMatching(/four digits/),
      expect.stringMatching(/tries left/),
      expect.stringMatching(/Trip started/),
    ]);

    // Along the planned route to the drop-off, then completed and settled.
    for (let step = 0; step < 40 && ride.status === 'in_progress'; step += 1) {
      await travel();
      await demo.tick();
      ride = await rideRow(rideId);
    }
    expect(ride.status).toBe('completed');
    expect(ride.offRouteSince).toBeNull();
    const pings = await ctx.prisma.rideLocationPing.count({ where: { rideId } });
    expect(pings).toBeGreaterThan(2);
    const earnings = await ctx.prisma.ledgerAccount.findFirst({
      where: { code: { startsWith: driverEarningsPrefix(sample.driverId) } },
    });
    expect(earnings?.balanceMinor).toBeGreaterThan(0n);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/is online \d+ m from/),
        expect.stringMatching(/accepted ride/),
        expect.stringMatching(/arrived at/),
        expect.stringMatching(/completed ride/),
      ]),
    );
    const untouched = await ctx.prisma.driver.findUniqueOrThrow({ where: { id: real.driverId } });
    expect(untouched.online).toBe(false);
    await expect(ctx.prisma.rideOffer.count({ where: { driverId: real.driverId } })).resolves.toBe(
      0,
    );

    // Stopping takes the now idle driver offline.
    await expect(demo.stop()).resolves.toBe(1);
    const stopped = await ctx.prisma.driver.findUniqueOrThrow({ where: { id: sample.driverId } });
    expect(stopped).toMatchObject({ online: false, lastLat: null, lastLng: null });
  });

  it('keeps a driver waiting while nobody gives the PIN, and says when none is free', async () => {
    await sampleDriver('xl');
    const { rideId } = await requestRide(ctx, rider.headers, {
      pickup: VICTORIA_ISLAND,
      dropoff: LEKKI,
    });
    const demo = simulator({ pinFor: () => Promise.resolve(null) });
    // No standard sample driver exists: the ride keeps searching and the gap is reported once.
    await demo.tick();
    await demo.tick();
    expect((await rideRow(rideId)).status).toBe('searching');
    expect(lines.filter((line) => line.includes('No free sample driver'))).toHaveLength(1);

    const standard = await sampleDriver();
    await travel(1);
    await demo.tick();
    await travel();
    await demo.tick();
    expect(await rideRow(rideId)).toMatchObject({ status: 'arrived', driverId: standard.driverId });
    await demo.tick();
    await travel();
    await demo.tick();
    const ride = await rideRow(rideId);
    expect(ride).toMatchObject({ status: 'arrived', pinAttempts: 0 });
  });
});
