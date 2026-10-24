import { randomUUID } from 'node:crypto';

import type { RideCategory } from '@suskii/shared';

import { RideDispatchService } from '../../src/rides/ride-dispatch.service';

import { book, payInFull } from './cars';
import { bearer, grantRoles, login, signUp } from './flows';
import type { TestContext } from './test-app';

/** Helpers for the ride suites (ADR-049 to ADR-053). */

export const IKEJA = { label: 'Murtala Muhammed Airport', lat: 6.5774, lng: 3.3212 };
export const VICTORIA_ISLAND = { label: 'Eko Hotel, Victoria Island', lat: 6.4281, lng: 3.4219 };
export const LEKKI = { label: 'Lekki Phase 1 Gate', lat: 6.4474, lng: 3.4722 };

/** Lagos places and fare rules through the admin API (standard and comfort). */
export async function rideCatalog(ctx: TestContext, staff: Record<string, string>): Promise<void> {
  for (const [name, place, kind] of [
    ['Murtala Muhammed Airport', IKEJA, 'airport'],
    ['Eko Hotel', VICTORIA_ISLAND, 'landmark'],
    ['Lekki Phase 1', LEKKI, 'landmark'],
  ] as const) {
    await ctx
      .http()
      .post('/v1/admin/rides/places')
      .set(staff)
      .send({ name, kind, cityName: 'Lagos', lat: place.lat, lng: place.lng })
      .expect(201);
  }
  for (const category of ['standard', 'comfort'] as const) {
    await ctx
      .http()
      .put('/v1/admin/rides/fare-rules')
      .set(staff)
      .send({
        cityName: 'Lagos',
        category,
        currency: 'NGN',
        baseMinor: 50_000,
        perKmMinor: category === 'standard' ? 15_000 : 22_000,
        perMinuteMinor: 2_000,
        bookingFeeMinor: 20_000,
        minimumMinor: 150_000,
        cancellationFeeMinor: 50_000,
        freeCancelSeconds: 120,
        waitGraceSeconds: 300,
        driverShareBps: 8_000,
        surgeBps: 0,
        active: true,
      })
      .expect(200);
  }
}

let counter = 0;
const unique = (): string => `${Date.now()}${(counter += 1)}`.slice(-11).padStart(11, '1');

export interface DriverOptions {
  userId?: string;
  lat: number;
  lng: number;
  category?: RideCategory;
  online?: boolean;
  status?: 'pending' | 'approved' | 'suspended';
  /** Seconds since the last position. */
  staleSeconds?: number;
}

/**
 * An approved driver with an active vehicle, written straight to the database (the onboarding
 * suite covers the review flow). Creates a bare user when none is given.
 */
export async function createDriver(
  ctx: TestContext,
  options: DriverOptions,
): Promise<{ driverId: string; userId: string }> {
  const userId =
    options.userId ??
    (await ctx.prisma.user.create({ data: { email: `driver-${randomUUID()}@suskii.test` } })).id;
  const id = unique();
  const driver = await ctx.prisma.driver.create({
    data: {
      userId,
      status: options.status ?? 'approved',
      givenNames: 'Tunde',
      surname: 'Bakare',
      dateOfBirth: new Date('1985-03-01T00:00:00Z'),
      cityName: 'Lagos',
      ninEncrypted: 'test',
      ninHash: `nin-${randomUUID()}`,
      identityCheck: 'verified',
      licenceEncrypted: 'test',
      licenceHash: `licence-${randomUUID()}`,
      licenceExpiresOn: new Date('2030-01-01T00:00:00Z'),
      licenceCheck: 'verified',
      online: options.online ?? true,
      lastLat: options.lat,
      lastLng: options.lng,
      lastLocationAt: new Date(Date.now() - (options.staleSeconds ?? 0) * 1000),
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverId: driver.id,
      make: 'Toyota',
      model: 'Corolla',
      year: 2019,
      colour: 'Silver',
      plate: `LND${id.slice(-6)}`,
      category: options.category ?? 'standard',
      seats: 4,
      insuranceExpiresOn: new Date('2030-01-01T00:00:00Z'),
      status: 'approved',
      active: true,
    },
  });
  return { driverId: driver.id, userId };
}

/** A signed-in driver (role `driver`) at a position. */
export async function driverSession(
  ctx: TestContext,
  email: string,
  options: Omit<DriverOptions, 'userId'>,
): Promise<{
  driverId: string;
  userId: string;
  headers: Record<string, string>;
  accessToken: string;
}> {
  const account = await signUp(ctx, email);
  const { driverId } = await createDriver(ctx, { ...options, userId: account.userId });
  await grantRoles(ctx, account.userId, ['driver']);
  const session = await login(ctx, email);
  return {
    driverId,
    userId: account.userId,
    headers: bearer(session.accessToken),
    accessToken: session.accessToken,
  };
}

/** Quotes, books and pays a ride for a signed-in rider; returns the ride and booking ids. */
export async function requestRide(
  ctx: TestContext,
  rider: Record<string, string>,
  options: {
    pickup?: typeof IKEJA;
    dropoff?: typeof IKEJA;
    category?: RideCategory;
    scheduledFor?: string;
    currency?: string;
  } = {},
): Promise<{ rideId: string; bookingId: string; totalMinor: number }> {
  const quote = await ctx
    .http()
    .post('/v1/inhouse-quotes')
    .set(rider)
    .send({
      kind: 'ride',
      category: options.category ?? 'standard',
      pickup: options.pickup ?? IKEJA,
      dropoff: options.dropoff ?? VICTORIA_ISLAND,
      scheduledFor: options.scheduledFor ?? null,
      ...(options.currency ? { currency: options.currency } : {}),
    })
    .expect(201);
  const created = await book(
    ctx,
    { quoteId: quote.body.quoteId, guests: [{ givenNames: 'Ada', surname: 'Obi' }] },
    rider,
  ).expect(201);
  const bookingId = created.body.booking.id as string;
  const booking = await payInFull(ctx, bookingId, rider);
  const rideId = (booking.ride as { rideId: string | null } | null)?.rideId ?? null;
  if (!rideId)
    throw new Error(`booking ${bookingId} has no ride (status ${String(booking.status)})`);
  return {
    rideId,
    bookingId,
    totalMinor: (booking.price as { total: { amountMinor: number } }).total.amountMinor,
  };
}

export const dispatch = (ctx: TestContext) => ctx.app.get(RideDispatchService).run();

export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('DRIVER-DOCUMENT'),
]);

export const DRIVER_DOCUMENTS = [
  'licence',
  'vehicle_registration',
  'insurance',
  'roadworthiness',
  'selfie',
] as const;

/**
 * Someone who applied to drive through the API, with every document uploaded (and scanned) and
 * one vehicle registered. `nin` and `licence` pick the mock KYC outcome (`000` not found, `999`
 * mismatch, `555` unavailable).
 */
export async function driverApplicant(
  ctx: TestContext,
  email: string,
  options: { nin?: string; licence?: string } = {},
): Promise<{
  userId: string;
  headers: Record<string, string>;
  driverId: string;
  vehicleId: string;
}> {
  const account = await signUp(ctx, email);
  const headers = bearer(account.accessToken);
  const applied = await ctx
    .http()
    .post('/v1/drivers/applications')
    .set(headers)
    .send({
      givenNames: 'Chinedu',
      surname: 'Okeke',
      dateOfBirth: '1990-04-12',
      cityName: 'Lagos',
      nin: options.nin ?? unique(),
      licenceNumber: options.licence ?? `LAG${unique()}`,
      licenceExpiresOn: '2031-06-30',
    })
    .expect(201);
  for (const kind of DRIVER_DOCUMENTS) {
    await ctx
      .http()
      .put(`/v1/drivers/me/documents/${kind}`)
      .set(headers)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(200);
  }
  await ctx.background.drain();
  const vehicle = await ctx
    .http()
    .post('/v1/drivers/me/vehicles')
    .set(headers)
    .send({
      make: 'Toyota',
      model: 'Camry',
      year: 2018,
      colour: 'Black',
      plate: `KJA-${unique().slice(-3)}-AB`,
      category: 'standard',
      seats: 4,
      insuranceExpiresOn: '2030-12-31',
    })
    .expect(201);
  const vehicles = vehicle.body.vehicles as { id: string }[];
  return {
    userId: account.userId,
    headers,
    driverId: applied.body.id as string,
    vehicleId: vehicles[vehicles.length - 1]?.id ?? '',
  };
}
