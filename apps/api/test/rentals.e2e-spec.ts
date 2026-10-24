import { ObjectStorage } from '../src/documents/object-storage';
import { redactCarsBooking } from '../src/privacy/cars-redaction';
import { RetentionService } from '../src/privacy/retention.service';

import { bearer, signUp } from './helpers/flows';
import { payInFull, staffSession } from './helpers/cars';
import { createDriver } from './helpers/rides';
import {
  bookRental,
  IKEJA_BRANCH,
  localIn,
  paidRental,
  PNG,
  rentalQuote,
  rentalVehicle,
} from './helpers/rentals';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Car rental (Cars P5, ADR-051): search, quotes with delivery and a refundable deposit, one
 * booking per car and period (the exclusion constraint decides under concurrency), the renter's
 * licence, photo evidence and handovers that cannot be changed, and the deposit release.
 */
describe('rentals (e2e)', () => {
  let ctx: TestContext;
  let staff: Record<string, string>;
  let renter: { userId: string; headers: Record<string, string> };

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    staff = (await staffSession(ctx, 'fleet@suskii.test', ['operations'])).headers;
    const session = await signUp(ctx, 'renter@example.com');
    renter = { userId: session.userId, headers: bearer(session.accessToken) };
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  const admin = (path: string) => ctx.http().post(`/v1/admin/rentals/${path}`).set(staff);

  async function photo(reservationId: string): Promise<string> {
    const uploaded = await admin(`reservations/${reservationId}/photos`)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(201);
    return uploaded.body.id as string;
  }

  async function approveLicence(reservationId: string): Promise<void> {
    await ctx
      .http()
      .put(`/v1/rentals/reservations/${reservationId}/licence`)
      .set(renter.headers)
      .send({ number: 'LAG12345AA67', expiresOn: '2031-01-31' })
      .expect(200);
    await ctx
      .http()
      .put(`/v1/rentals/reservations/${reservationId}/licence/document`)
      .set(renter.headers)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(200);
    await ctx.background.drain();
    await admin(`reservations/${reservationId}/licence/review`)
      .send({ decision: 'approve' })
      .expect(204);
  }

  it('rents a self-drive car from search to the deposit release', async () => {
    const car = await rentalVehicle(ctx, staff);
    const pickupAtLocal = localIn(3);
    const returnAtLocal = localIn(3 + 48);

    const search = await ctx
      .http()
      .get('/v1/rentals/vehicles')
      .query({ city: 'Lagos', pickupAt: pickupAtLocal, returnAt: returnAtLocal })
      .expect(200);
    expect(search.body.days).toBe(2);
    expect(search.body.vehicles).toEqual([
      expect.objectContaining({
        id: car.id,
        estimate: {
          rental: { amountMinor: 9_000_000, currency: 'NGN' },
          deposit: { amountMinor: 10_000_000, currency: 'NGN' },
        },
      }),
    ]);
    await ctx.http().get(`/v1/rentals/vehicles/${car.slug}`).expect(200);

    const delivery = { label: 'Allen Avenue', lat: IKEJA_BRANCH.lat + 0.02, lng: IKEJA_BRANCH.lng };
    const quote = await rentalQuote(ctx, renter.headers, {
      vehicleId: car.id,
      pickupAtLocal,
      returnAtLocal,
      delivery,
    });
    expect(quote.status).toBe(201);
    expect(quote.body.rental).toMatchObject({
      days: 2,
      chauffeur: false,
      delivery: { label: 'Allen Avenue', km: expect.any(Number) },
      charge: { vehicle: { amountMinor: 9_000_000 }, deposit: { amountMinor: 10_000_000 } },
      reservation: null,
    });
    const km = quote.body.rental.delivery.km as number;
    expect(quote.body.rental.charge.delivery.amountMinor).toBe(km * 50_000);

    const created = await bookRental(ctx, renter.headers, quote.body.quoteId as string).expect(201);
    const price = created.body.booking.price as {
      total: { amountMinor: number };
      deposit: { amountMinor: number };
    };
    expect(price.deposit).toEqual({ amountMinor: 10_000_000, currency: 'NGN' });
    expect(price.total.amountMinor).toBe(quote.body.price.total.amountMinor + 10_000_000);

    const booking = await payInFull(ctx, created.body.booking.id as string, renter.headers);
    expect(booking.status).toBe('CONFIRMED');
    const reservation = (
      booking.rental as { reservation: { id: string; status: string; licenceRequired: boolean } }
    ).reservation;
    expect(reservation).toMatchObject({ status: 'reserved', licenceRequired: true, licence: null });

    // No check-out without an approved licence.
    const first = await photo(reservation.id);
    await admin(`reservations/${reservation.id}/handovers`)
      .send({
        kind: 'check_out',
        odometerKm: 41_200,
        fuelEighths: 8,
        damageNotes: null,
        photoIds: [first],
      })
      .expect(409);
    await approveLicence(reservation.id);
    const view = await ctx
      .http()
      .get(`/v1/rentals/reservations/${reservation.id}`)
      .set(renter.headers)
      .expect(200);
    expect(view.body.licence).toMatchObject({ status: 'approved', numberEndsWith: 'A67' });
    const stored = await ctx.prisma.rentalLicence.findFirstOrThrow({
      where: { reservationId: reservation.id },
    });
    expect(stored.numberEncrypted).not.toContain('LAG12345AA67');

    await admin(`reservations/${reservation.id}/handovers`)
      .send({
        kind: 'check_out',
        odometerKm: 41_200,
        fuelEighths: 8,
        damageNotes: 'Scratch on rear bumper',
        photoIds: [first],
      })
      .expect(204);
    // A collected car is not cancelled, it is returned.
    await ctx
      .http()
      .post(`/v1/bookings/${created.body.booking.id as string}/cancel`)
      .set(renter.headers)
      .expect(409);

    // Handovers are evidence: the database refuses changes, except clearing notes on anonymisation.
    const handover = await ctx.prisma.rentalHandover.findFirstOrThrow({
      where: { reservationId: reservation.id },
    });
    await expect(
      ctx.prisma.rentalHandover.update({ where: { id: handover.id }, data: { odometerKm: 1 } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      ctx.prisma.rentalHandoverPhoto.update({ where: { id: first }, data: { handoverId: null } }),
    ).rejects.toThrow(/immutable/);

    const second = await photo(reservation.id);
    await admin(`reservations/${reservation.id}/handovers`)
      .send({
        kind: 'check_in',
        odometerKm: 41_000,
        fuelEighths: 6,
        damageNotes: null,
        photoIds: [second],
      })
      .expect(409);
    await admin(`reservations/${reservation.id}/handovers`)
      .send({
        kind: 'check_in',
        odometerKm: 41_650,
        fuelEighths: 6,
        damageNotes: null,
        photoIds: [second],
      })
      .expect(204);

    await admin(`reservations/${reservation.id}/deposit`)
      .send({ keptMinor: 2_000_000 })
      .expect(400);
    await admin(`reservations/${reservation.id}/deposit`)
      .send({ keptMinor: 2_000_000, reason: 'fuel' })
      .expect(204);
    await admin(`reservations/${reservation.id}/deposit`).send({ keptMinor: 0 }).expect(409);
    await ctx.background.drain();
    const refunds = await ctx.prisma.refund.findMany({
      where: { bookingId: created.body.booking.id as string },
    });
    expect(refunds.map((refund) => [refund.reason, Number(refund.amountMinor)])).toEqual([
      ['deposit_release', 8_000_000],
    ]);
    const kept = await ctx.prisma.ledgerEntry.findFirst({
      where: {
        transaction: { idempotencyKey: `rental:${reservation.id}:deposit-deduction` },
        direction: 'credit',
      },
      include: { account: true },
    });
    expect(kept).toMatchObject({
      amountMinor: 2_000_000n,
      account: { code: 'income:rental-deductions:NGN' },
    });

    const after = await ctx
      .http()
      .get(`/v1/bookings/${created.body.booking.id as string}`)
      .set(renter.headers)
      .expect(200);
    expect(after.body.rental.reservation).toMatchObject({
      status: 'returned',
      deposit: {
        refund: { amountMinor: 8_000_000 },
        kept: { amountMinor: 2_000_000 },
        reason: 'fuel',
      },
    });

    const listed = await ctx.http().get('/v1/admin/rentals/reservations').set(staff).expect(200);
    expect(listed.body.reservations[0]).toMatchObject({
      id: reservation.id,
      renterName: 'NGOZI EZE',
      handovers: [
        expect.objectContaining({ kind: 'check_out' }),
        expect.objectContaining({ kind: 'check_in' }),
      ],
    });
    const image = await ctx
      .http()
      .get(`/v1/admin/rentals/reservations/${reservation.id}/photos/${first}`)
      .set(staff)
      .expect(200);
    expect(Buffer.from(image.body as Buffer).equals(PNG)).toBe(true);
  });

  it('stores each licence upload as its own file and removes the one it replaces', async () => {
    const car = await rentalVehicle(ctx, staff);
    const { reservationId } = await paidRental(ctx, renter.headers, {
      vehicleId: car.id,
      pickupAtLocal: localIn(5),
      returnAtLocal: localIn(5 + 24),
    });
    await ctx
      .http()
      .put(`/v1/rentals/reservations/${reservationId}/licence`)
      .set(renter.headers)
      .send({ number: 'LAG12345AA67', expiresOn: '2031-01-31' })
      .expect(200);
    const upload = async () => {
      await ctx
        .http()
        .put(`/v1/rentals/reservations/${reservationId}/licence/document`)
        .set(renter.headers)
        .set('Content-Type', 'image/png')
        .send(PNG)
        .expect(200);
      return (await ctx.prisma.rentalLicence.findFirstOrThrow({ where: { reservationId } }))
        .storageKey;
    };
    const storage = ctx.app.get(ObjectStorage);
    const first = await upload();
    await ctx.background.drain();
    const second = await upload();
    // A scan that read the first file can no longer vouch for the second.
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(await storage.get(first ?? '')).toBeNull();
    expect(await storage.get(second ?? '')).not.toBeNull();
    await ctx.background.drain();
    const licence = await ctx.prisma.rentalLicence.findFirstOrThrow({ where: { reservationId } });
    expect(licence).toMatchObject({ status: 'pending_review', storageKey: second });
  });

  it('lets exactly one of two overlapping bookings take the car', async () => {
    const car = await rentalVehicle(ctx, staff);
    const other = bearer((await signUp(ctx, 'other-renter@example.com')).accessToken);
    const period = { vehicleId: car.id, pickupAtLocal: localIn(5), returnAtLocal: localIn(5 + 24) };
    const quotes = await Promise.all(
      [renter.headers, other].map((headers) => rentalQuote(ctx, headers, period).expect(201)),
    );
    const results = await Promise.all(
      quotes.map((quote, index) =>
        bookRental(ctx, index === 0 ? renter.headers : other, quote.body.quoteId as string),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.type).toMatch(
      /vehicle-unavailable$/,
    );
    expect(
      await ctx.prisma.rentalReservation.count({ where: { vehicleId: car.id, active: true } }),
    ).toBe(1);

    // The database itself refuses an overlapping active period, turnaround included: a later
    // rental of the same car cannot be moved into the first one's period.
    const existing = await ctx.prisma.rentalReservation.findFirstOrThrow({
      where: { vehicleId: car.id, active: true },
    });
    const later = await paidRental(ctx, renter.headers, {
      vehicleId: car.id,
      pickupAtLocal: localIn(5 + 48),
      returnAtLocal: localIn(5 + 72),
    });
    await expect(
      ctx.prisma.rentalReservation.update({
        where: { id: later.reservationId },
        data: { pickupAt: new Date(existing.blockedUntil.getTime() - 60_000) },
      }),
    ).rejects.toThrow(/rental_reservations_no_overlap|exclusion|conflicting/);
    await ctx.http().post(`/v1/bookings/${later.bookingId}/cancel`).set(renter.headers).expect(200);

    // Searching skips the taken car; cancelling the unpaid booking frees it.
    const search = await ctx
      .http()
      .get('/v1/rentals/vehicles')
      .query({ city: 'Lagos', pickupAt: period.pickupAtLocal, returnAt: period.returnAtLocal })
      .expect(200);
    expect(search.body.vehicles).toEqual([]);
    const winner = results.find((result) => result.status === 201)!;
    const winnerHeaders = results[0]?.status === 201 ? renter.headers : other;
    await ctx
      .http()
      .post(`/v1/bookings/${winner.body.booking.id as string}/cancel`)
      .set(winnerHeaders)
      .expect(200);
    expect(
      await ctx.prisma.rentalReservation.count({ where: { vehicleId: car.id, active: true } }),
    ).toBe(0);
    await rentalQuote(ctx, renter.headers, period).expect(201);
  });

  it('assigns an approved driver to a chauffeured rental, with no deposit and no licence', async () => {
    const car = await rentalVehicle(ctx, staff);
    const { reservationId, booking } = await paidRental(ctx, renter.headers, {
      vehicleId: car.id,
      pickupAtLocal: localIn(4),
      returnAtLocal: localIn(4 + 10),
      chauffeur: true,
    });
    expect((booking.price as { deposit: unknown }).deposit).toBeNull();
    expect(
      (booking.rental as { reservation: { licenceRequired: boolean } }).reservation.licenceRequired,
    ).toBe(false);
    await ctx
      .http()
      .put(`/v1/rentals/reservations/${reservationId}/licence`)
      .set(renter.headers)
      .send({ number: 'LAG99999ZZ11', expiresOn: '2031-01-31' })
      .expect(409);

    const pending = await createDriver(ctx, { ...IKEJA_BRANCH, status: 'pending' });
    const approved = await createDriver(ctx, { ...IKEJA_BRANCH });
    const handover = (driverId: string | null, photoId: string) =>
      admin(`reservations/${reservationId}/handovers`).send({
        kind: 'check_out',
        odometerKm: 10,
        fuelEighths: 8,
        damageNotes: null,
        photoIds: [photoId],
        chauffeurDriverId: driverId,
      });
    const shot = await photo(reservationId);
    await handover(null, shot).expect(409);
    await handover(pending.driverId, shot).expect(409);
    await handover(approved.driverId, shot).expect(204);
    const row = await ctx.prisma.rentalReservation.findUniqueOrThrow({
      where: { id: reservationId },
    });
    expect(row).toMatchObject({
      status: 'checked_out',
      chauffeurDriverId: approved.driverId,
      depositMinor: 0n,
    });
  });

  it('refunds the whole deposit when a rental is cancelled under its tiers', async () => {
    const car = await rentalVehicle(ctx, staff);
    const { bookingId, booking } = await paidRental(ctx, renter.headers, {
      vehicleId: car.id,
      pickupAtLocal: localIn(6),
      returnAtLocal: localIn(6 + 24),
    });
    const paid = (booking.price as { total: { amountMinor: number } }).total.amountMinor;
    const cancellation = booking.cancellation as {
      refundBps: number;
      refund: { amountMinor: number };
    };
    // Same-day pickup: the rental itself is not refunded, the deposit always is.
    expect(cancellation).toEqual({
      refundBps: 0,
      refund: { amountMinor: 10_000_000, currency: 'NGN' },
    });
    await ctx.http().post(`/v1/bookings/${bookingId}/cancel`).set(renter.headers).expect(200);
    const refunds = await ctx.prisma.refund.findMany({ where: { bookingId } });
    expect(refunds.reduce((sum, refund) => sum + Number(refund.amountMinor), 0)).toBe(10_000_000);
    expect(paid).toBeGreaterThan(10_000_000);
    expect(await ctx.prisma.rentalReservation.count({ where: { active: true } })).toBe(0);
  });

  it('destroys licences and photos after their periods and redacts delivery addresses', async () => {
    const car = await rentalVehicle(ctx, staff);
    const { bookingId, reservationId } = await paidRental(ctx, renter.headers, {
      vehicleId: car.id,
      pickupAtLocal: localIn(4),
      returnAtLocal: localIn(28),
      delivery: {
        label: 'Home, 12 Allen Avenue',
        lat: IKEJA_BRANCH.lat + 0.01,
        lng: IKEJA_BRANCH.lng,
      },
    });
    await approveLicence(reservationId);
    const first = await photo(reservationId);
    await admin(`reservations/${reservationId}/handovers`)
      .send({
        kind: 'check_out',
        odometerKm: 5,
        fuelEighths: 8,
        damageNotes: null,
        photoIds: [first],
      })
      .expect(204);
    const second = await photo(reservationId);
    await admin(`reservations/${reservationId}/handovers`)
      .send({
        kind: 'check_in',
        odometerKm: 50,
        fuelEighths: 8,
        damageNotes: 'Dent, driver door',
        photoIds: [second],
      })
      .expect(204);

    const retention = ctx.app.get(RetentionService);
    const early = await retention.run();
    expect([early['rental-licences'], early['rental-photos']]).toEqual([0, 0]);
    // Returned long ago: the licence goes after 30 days, photos after the dispute window.
    const returned = Date.now() - (ctx.config.RENTAL_PHOTO_RETENTION_DAYS + 1) * 86_400_000;
    await ctx.prisma.rentalReservation.update({
      where: { id: reservationId },
      data: {
        pickupAt: new Date(returned - 86_400_000),
        returnAt: new Date(returned),
        blockedUntil: new Date(returned),
      },
    });
    const run = await retention.run();
    expect([run['rental-licences'], run['rental-photos']]).toEqual([1, 2]);
    expect(await ctx.prisma.rentalLicence.count({ where: { reservationId } })).toBe(0);
    const photos = await ctx.prisma.rentalHandoverPhoto.findMany({ where: { reservationId } });
    expect(photos.map((row) => [row.storageKey, row.wrappedKey, row.deletedAt !== null])).toEqual([
      [null, '', true],
      [null, '', true],
    ]);

    // Redaction (deletion or anonymisation) coarsens the delivery address in both snapshots and
    // clears handover notes, keeping the readings.
    await ctx.prisma.$transaction((tx) => redactCarsBooking(tx, bookingId));
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({
      where: { bookingId },
      include: { offer: true },
    });
    for (const snapshot of [item.payload, item.offer.payload] as {
      delivery: { label: string };
    }[]) {
      expect(snapshot.delivery.label).toBe('Redacted');
    }
    const handovers = await ctx.prisma.rentalHandover.findMany({
      where: { reservationId },
      orderBy: { createdAt: 'asc' },
    });
    expect(handovers.map((row) => [row.odometerKm, row.damageNotes])).toEqual([
      [5, null],
      [50, null],
    ]);
  });

  it('refuses quotes it cannot honour and keeps reservations to their renter', async () => {
    const car = await rentalVehicle(ctx, staff, {
      chauffeurDailyMinor: null,
      deliveryPerKmMinor: null,
    });
    const period = { vehicleId: car.id, pickupAtLocal: localIn(5), returnAtLocal: localIn(5 + 24) };
    await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({ kind: 'rental', ...period })
      .expect(401);
    const issue = async (body: Record<string, unknown>) =>
      (await rentalQuote(ctx, renter.headers, { ...period, ...body }).expect(422)).body
        .code as string;
    expect(await issue({ currency: 'USD' })).toBe('currency_unavailable');
    expect(await issue({ chauffeur: true })).toBe('chauffeur_unavailable');
    expect(await issue({ delivery: { label: 'Home', lat: 6.5, lng: 3.4 } })).toBe(
      'delivery_unavailable',
    );
    expect(await issue({ pickupAtLocal: localIn(0), returnAtLocal: localIn(24) })).toBe(
      'period_invalid',
    );
    expect(await issue({ returnAtLocal: localIn(5 + 24 * 40) })).toBe('too_long');

    const { reservationId } = await paidRental(ctx, renter.headers, period);
    const stranger = bearer((await signUp(ctx, 'stranger@example.com')).accessToken);
    await ctx.http().get(`/v1/rentals/reservations/${reservationId}`).set(stranger).expect(404);
    await ctx
      .http()
      .put(`/v1/rentals/reservations/${reservationId}/licence`)
      .set(stranger)
      .send({ number: 'LAG12345AA67', expiresOn: '2031-01-31' })
      .expect(404);
    await ctx
      .http()
      .put(`/v1/rentals/reservations/${reservationId}/licence/document`)
      .set(stranger)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(404);
    // Staff with other duties cannot open the rental desk.
    const support = (await staffSession(ctx, 'support@suskii.test', ['support'])).headers;
    await ctx.http().get('/v1/admin/rentals/reservations').set(support).expect(403);
  });
});
