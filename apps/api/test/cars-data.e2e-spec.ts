import { BOOKING_TERMS_VERSION } from '@suskii/shared';

import { uuidv7 } from '../src/common/uuid';
import {
  contactContext,
  driverLicenceContext,
  driverNinContext,
  emergencyContactContext,
  ridePinContext,
} from '../src/crypto/encryption-contexts';
import { FieldEncryption } from '../src/crypto/field-encryption';
import { HmacService } from '../src/crypto/hmac.service';
import type { BookingStatus, RideStatus } from '../src/generated/prisma/client';
import { LedgerService, transfer } from '../src/ledger/ledger.service';
import { AccountDeletionService } from '../src/privacy/account-deletion.service';
import { DataExportService } from '../src/privacy/data-export.service';
import { RetentionService } from '../src/privacy/retention.service';

import { signUp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const LAGOS = { lat: 6.6018, lng: 3.3515 };
const context = { ip: '127.0.0.1' };

/**
 * Cars data layer (ADR-049 to ADR-053): what the database itself guarantees (a seat is sold once,
 * a car is never double-booked, one open offer per driver, one live ride per driver), that the
 * proximity index is usable, and that retention, the data export and account deletion cover the
 * new personal data.
 */
describe('Cars data layer (e2e)', () => {
  let ctx: TestContext;
  let encryption: FieldEncryption;
  let hmac: HmacService;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    encryption = ctx.app.get(FieldEncryption);
    hmac = ctx.app.get(HmacService);
  });
  beforeEach(async () => resetState(ctx));
  afterAll(async () => {
    await resetState(ctx);
    await ctx.close();
  });

  /** A booking with one item of `type`, created straight in the database. */
  async function booking(
    userId: string | null,
    type: 'bus' | 'ride' | 'rental',
    status: BookingStatus = 'CONFIRMED',
  ): Promise<{ bookingId: string; itemId: string }> {
    const bookingId = uuidv7();
    const itemId = uuidv7();
    const vertical = type === 'bus' ? 'buses' : type === 'ride' ? 'rides' : 'rentals';
    const offer = await ctx.prisma.offer.create({
      data: {
        vertical,
        supplier: 'suskii',
        supplierOfferId: `${type}:test`,
        payload: { kind: type },
        supplierTotalMinor: 100_000n,
        supplierCurrency: 'NGN',
        price: {},
        totalMinor: 100_000n,
        currency: 'NGN',
        expiresAt: new Date(Date.now() + HOUR),
      },
    });
    await ctx.prisma.booking.create({
      data: {
        id: bookingId,
        reference: bookingId.slice(-6).toUpperCase(),
        status,
        vertical,
        userId,
        contactEncrypted: encryption.encrypt(
          JSON.stringify({ email: 'rider@example.com', phone: '+2348012345678' }),
          contactContext(bookingId),
        ),
        contactEmailHash: hmac.digest('booking-email', 'rider@example.com'),
        currency: 'NGN',
        totalMinor: 100_000n,
        price: {},
        channel: 'web',
        termsVersion: BOOKING_TERMS_VERSION,
        termsAcceptedAt: new Date(),
        items: {
          create: [
            {
              id: itemId,
              type,
              offerId: offer.id,
              supplier: 'suskii',
              supplierOfferId: `${type}:test`,
              payload: { kind: type },
              totalMinor: 100_000n,
              currency: 'NGN',
            },
          ],
        },
      },
    });
    return { bookingId, itemId };
  }

  async function driver(userId: string, online = false): Promise<string> {
    const id = uuidv7();
    const nin = `2${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
    const licence = `LIC${nin}`;
    await ctx.prisma.driver.create({
      data: {
        id,
        userId,
        status: 'approved',
        givenNames: 'Ada',
        surname: 'Obi',
        dateOfBirth: new Date('1990-01-01T00:00:00Z'),
        cityName: 'Lagos',
        ninEncrypted: encryption.encrypt(nin, driverNinContext(id)),
        ninHash: hmac.digest('driver-nin', nin),
        licenceEncrypted: encryption.encrypt(licence, driverLicenceContext(id)),
        licenceHash: hmac.digest('driver-licence', licence),
        licenceExpiresOn: new Date('2030-01-01T00:00:00Z'),
        online,
        lastLat: online ? LAGOS.lat : null,
        lastLng: online ? LAGOS.lng : null,
        lastLocationAt: online ? new Date() : null,
      },
    });
    return id;
  }

  async function ride(
    riderUserId: string,
    status: RideStatus,
    driverId: string | null = null,
  ): Promise<string> {
    // The booking's own status does not matter to these checks (the ride row is what counts).
    const { bookingId, itemId } = await booking(riderUserId, 'ride', 'CANCELLED');
    const id = uuidv7();
    const matched = !['scheduled', 'searching', 'cancelled', 'no_driver'].includes(status);
    if (matched && !driverId) {
      const user = await signUp(ctx, `driver-${id}@example.com`);
      driverId = await driver(user.userId);
    }
    await ctx.prisma.ride.create({
      data: {
        id,
        bookingId,
        bookingItemId: itemId,
        riderUserId,
        driverId,
        category: 'standard',
        status,
        cityName: 'Lagos',
        pickupLabel: 'Ikeja (Allen Avenue)',
        pickupLat: 6.601834,
        pickupLng: 3.351523,
        dropoffLabel: 'Yaba',
        dropoffLat: 6.509512,
        dropoffLng: 3.371144,
        polyline: '_p~iF~ps|U',
        distanceMetres: 12_000,
        durationSeconds: 1_800,
        fareMinor: 300_000n,
        currency: 'NGN',
        pinHash: 'argon2-placeholder',
        pinEncrypted: encryption.encrypt('1234', ridePinContext(id)),
      },
    });
    return id;
  }

  async function busTrip(): Promise<string> {
    const operator = await ctx.prisma.busOperator.create({
      data: { slug: 'test-operator', name: 'Test operator', cancellationPolicy: [] },
    });
    const terminal = (slug: string) =>
      ctx.prisma.busTerminal.create({
        data: {
          slug,
          name: slug,
          cityName: 'Lagos',
          stateName: 'Lagos',
          countryCode: 'NG',
          address: 'Somewhere',
          lat: 6.5,
          lng: 3.4,
          timeZone: 'Africa/Lagos',
        },
      });
    const [from, to] = [await terminal('from'), await terminal('to')];
    const route = await ctx.prisma.busRoute.create({
      data: {
        operatorId: operator.id,
        originId: from.id,
        destinationId: to.id,
        distanceKm: 100,
        durationMinutes: 120,
      },
    });
    const layout = await ctx.prisma.busLayout.create({
      data: {
        operatorId: operator.id,
        name: 'Test',
        layout: { rows: [['1A', '1B']] },
        seatCount: 2,
      },
    });
    const departsAt = new Date(Date.now() + 2 * DAY);
    const trip = await ctx.prisma.busTrip.create({
      data: {
        routeId: route.id,
        layoutId: layout.id,
        departsAt,
        departsAtLocal: '2026-11-01T07:00',
        arrivesAt: new Date(departsAt.getTime() + 2 * HOUR),
        fareMinor: 850_000n,
        currency: 'NGN',
      },
    });
    return trip.id;
  }

  it('sells a bus seat once while its assignment is active', async () => {
    const tripId = await busTrip();
    const first = await booking(null, 'bus');
    const second = await booking(null, 'bus');
    const assignment = (itemId: string) =>
      ctx.prisma.busSeatAssignment.create({
        data: { tripId, seatNumber: '1A', bookingItemId: itemId, passengerId: uuidv7() },
      });
    const sold = await assignment(first.itemId);
    await expect(assignment(second.itemId)).rejects.toMatchObject({ code: 'P2002' });
    await ctx.prisma.busSeatAssignment.update({
      where: { id: sold.id },
      data: { active: false, releasedAt: new Date() },
    });
    await expect(assignment(second.itemId)).resolves.toMatchObject({ seatNumber: '1A' });
  });

  it('never lets two active rentals of one car overlap, buffer included', async () => {
    const vehicle = await ctx.prisma.rentalVehicle.create({
      data: {
        slug: 'test-car',
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        category: 'economy',
        transmission: 'automatic',
        seats: 5,
        plate: 'TST-001-LA',
        cityName: 'Lagos',
        branchName: 'Ikeja',
        branchAddress: 'Allen Avenue',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        timeZone: 'Africa/Lagos',
        currency: 'NGN',
        dailyMinor: 4_500_000n,
        depositMinor: 10_000_000n,
        cancellationPolicy: [],
      },
    });
    const start = new Date(Date.now() + 3 * DAY);
    const reserve = async (from: Date, days: number) => {
      const { itemId } = await booking(null, 'rental');
      const returnAt = new Date(from.getTime() + days * DAY);
      return ctx.prisma.rentalReservation.create({
        data: {
          vehicleId: vehicle.id,
          bookingItemId: itemId,
          pickupAt: from,
          returnAt,
          blockedUntil: new Date(returnAt.getTime() + 2 * HOUR),
          chauffeur: false,
          depositMinor: 10_000_000n,
          currency: 'NGN',
        },
      });
    };
    const first = await reserve(start, 2);
    // Starts an hour after the return, inside the two-hour turnaround.
    await expect(reserve(new Date(start.getTime() + 2 * DAY + HOUR), 1)).rejects.toThrow(
      /rental_reservations_no_overlap/,
    );
    await expect(reserve(new Date(start.getTime() + 2 * DAY + 2 * HOUR), 1)).resolves.toBeTruthy();
    await ctx.prisma.rentalReservation.update({ where: { id: first.id }, data: { active: false } });
    await expect(reserve(new Date(start.getTime() + DAY), 1)).resolves.toBeTruthy();
  });

  it('keeps one open offer per driver and one live ride per driver', async () => {
    const rider = await signUp(ctx, 'rider-offers@example.com');
    const otherRider = await signUp(ctx, 'rider-offers-2@example.com');
    const driverUser = await signUp(ctx, 'driver-offers@example.com');
    const driverId = await driver(driverUser.userId, true);
    const rideA = await ride(rider.userId, 'searching');
    const rideB = await ride(otherRider.userId, 'searching');
    const offer = (rideId: string) =>
      ctx.prisma.rideOffer.create({
        data: { rideId, driverId, distanceMetres: 800, expiresAt: new Date(Date.now() + 15_000) },
      });
    await offer(rideA);
    await expect(offer(rideB)).rejects.toMatchObject({ code: 'P2002' });

    await ctx.prisma.ride.update({ where: { id: rideA }, data: { status: 'assigned', driverId } });
    await expect(
      ctx.prisma.ride.update({ where: { id: rideB }, data: { status: 'assigned', driverId } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // A matched ride without a driver is refused outright.
    await expect(
      ctx.prisma.ride.update({ where: { id: rideB }, data: { status: 'in_progress' } }),
    ).rejects.toThrow(/rides_driver_when_matched/);
  });

  it('finds nearby online drivers through the earthdistance index', async () => {
    const user = await signUp(ctx, 'driver-near@example.com');
    await driver(user.userId, true);
    const plan = await ctx.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT id FROM drivers
         WHERE online AND last_lat IS NOT NULL
           AND earth_box(ll_to_earth(${LAGOS.lat}, ${LAGOS.lng}), 5000) @> ll_to_earth(last_lat, last_lng)`;
    });
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('drivers_last_position');
    const near = await ctx.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM drivers
       WHERE online AND last_lat IS NOT NULL
         AND earth_box(ll_to_earth(${6.6}, ${3.35}), 5000) @> ll_to_earth(last_lat, last_lng)
         AND earth_distance(ll_to_earth(${6.6}, ${3.35}), ll_to_earth(last_lat, last_lng)) <= 5000`;
    expect(near).toHaveLength(1);
  });

  it('coarsens old ride locations and deletes old pings, leaving recent rides alone', async () => {
    const rider = await signUp(ctx, 'rider-retention@example.com');
    const old = await ride(rider.userId, 'completed');
    const recent = await ride(rider.userId, 'cancelled');
    await ctx.prisma
      .$executeRaw`UPDATE rides SET updated_at = ${new Date(Date.now() - 100 * DAY)} WHERE id = ${old}::uuid`;
    await ctx.prisma.rideLocationPing.createMany({
      data: [
        {
          rideId: old,
          lat: 6.6,
          lng: 3.35,
          recordedAt: new Date(),
          createdAt: new Date(Date.now() - 91 * DAY),
        },
        { rideId: recent, lat: 6.6, lng: 3.35, recordedAt: new Date() },
      ],
    });
    const run = await ctx.app.get(RetentionService).run();
    expect(run['ride-locations']).toBe(1);
    expect(run['ride-location-pings']).toBe(1);
    const coarse = await ctx.prisma.ride.findUniqueOrThrow({ where: { id: old } });
    expect([coarse.pickupLat, coarse.pickupLng, coarse.polyline]).toEqual([6.6, 3.35, '']);
    expect(coarse.locationsRedactedAt).not.toBeNull();
    const kept = await ctx.prisma.ride.findUniqueOrThrow({ where: { id: recent } });
    expect(kept.pickupLat).toBe(6.601834);
    expect((await ctx.app.get(RetentionService).run())['ride-locations']).toBe(0);
  });

  it('exports rides, emergency contacts and the driver profile, then redacts them on deletion', async () => {
    const session = await signUp(ctx, 'driver-export@example.com');
    const driverId = await driver(session.userId);
    await ride(session.userId, 'completed');
    const contactId = uuidv7();
    await ctx.prisma.emergencyContact.create({
      data: {
        id: contactId,
        userId: session.userId,
        position: 0,
        contactEncrypted: encryption.encrypt(
          JSON.stringify({ name: 'Kemi', phone: '+2348098765432' }),
          emergencyContactContext(contactId),
        ),
      },
    });

    const exported = await ctx.app.get(DataExportService).build(session.userId);
    expect(exported.data.emergencyContacts).toEqual([
      expect.objectContaining({ name: 'Kemi', phone: '+2348098765432' }),
    ]);
    expect(exported.data.driving).toMatchObject({ givenNames: 'Ada', status: 'approved' });
    expect((exported.data.driving as { nin: string }).nin).toMatch(/^\d{11}$/);
    expect(exported.data.rides).toEqual([
      expect.objectContaining({
        status: 'completed',
        pickup: expect.objectContaining({ label: 'Ikeja (Allen Avenue)' }),
      }),
    ]);

    // Unpaid earnings hold deletion back like a wallet balance.
    const ledger = ctx.app.get(LedgerService);
    const { bookingId } = await booking(null, 'ride');
    await ctx.prisma.$transaction((tx) =>
      ledger.post(tx, {
        key: `test:${bookingId}:earnings`,
        kind: 'ride_earnings',
        bookingId,
        lines: transfer(
          { kind: 'psp', provider: 'mock', currency: 'NGN' },
          { kind: 'driver-earnings', driverId, currency: 'NGN' },
          { minor: 50_000n, currency: 'NGN' },
        ),
      }),
    );
    const deletion = ctx.app.get(AccountDeletionService);
    expect(await deletion.blockers(session.userId)).toContain('wallet_balance');
    // Drivers are not staff: the role alone never blocks deletion.
    expect(await deletion.blockers(session.userId)).not.toContain('staff_account');
    await ctx.prisma.$transaction((tx) =>
      ledger.post(tx, {
        key: `test:${bookingId}:paid-out`,
        kind: 'payout_sent',
        lines: transfer(
          { kind: 'driver-earnings', driverId, currency: 'NGN' },
          { kind: 'psp', provider: 'mock', currency: 'NGN' },
          { minor: 50_000n, currency: 'NGN' },
        ),
      }),
    );
    expect(await deletion.blockers(session.userId)).toEqual([]);

    await deletion.delete(session.userId, context);
    const redacted = await ctx.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    expect(redacted).toMatchObject({
      givenNames: 'REDACTED',
      surname: 'REDACTED',
      ninEncrypted: '',
      licenceEncrypted: '',
      status: 'suspended',
      online: false,
    });
    expect(await ctx.prisma.emergencyContact.count({ where: { userId: session.userId } })).toBe(0);
    const [riddenRide] = await ctx.prisma.ride.findMany({ where: { riderUserId: session.userId } });
    expect(riddenRide).toMatchObject({
      pickupLabel: 'Redacted',
      dropoffLabel: 'Redacted',
      polyline: '',
    });
  });

  it('counts a live ride as a booking in progress', async () => {
    const rider = await signUp(ctx, 'rider-live@example.com');
    await ride(rider.userId, 'searching');
    expect(await ctx.app.get(AccountDeletionService).blockers(rider.userId)).toEqual([
      'booking_in_progress',
    ]);
  });
});
