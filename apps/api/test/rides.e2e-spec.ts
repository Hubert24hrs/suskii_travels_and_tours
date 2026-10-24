import type { AddressInfo } from 'node:net';

import { WebSocket } from 'ws';

import { sessionCookieNames } from '../src/auth/cookies';

import { bearer, signUp } from './helpers/flows';
import { staffSession } from './helpers/cars';
import {
  createDriver,
  dispatch,
  driverSession,
  IKEJA,
  LEKKI,
  requestRide,
  rideCatalog,
} from './helpers/rides';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/** Offsets that move a point about `metres` north of IKEJA. */
const north = (metres: number) => ({ lat: IKEJA.lat + metres / 111_320, lng: IKEJA.lng });

/**
 * Intrastate rides (Cars P4, ADR-049 to ADR-053): the journey from quote to rating, matching
 * against many drivers, live updates over the socket (a rider never follows another rider's
 * ride), the PIN and its lockout, sharing, SOS, cancellation fees and refunds, and ownership on
 * every route.
 */
describe('rides (e2e)', () => {
  let ctx: TestContext;
  let staff: Record<string, string>;
  let rider: { userId: string; headers: Record<string, string>; accessToken: string };

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    staff = (await staffSession(ctx, 'rides-ops@suskii.test', ['operations', 'support'])).headers;
    await rideCatalog(ctx, staff);
    const session = await signUp(ctx, 'rider@example.com');
    rider = {
      userId: session.userId,
      headers: bearer(session.accessToken),
      accessToken: session.accessToken,
    };
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  const getRide = (rideId: string, headers = rider.headers) =>
    ctx.http().get(`/v1/rides/${rideId}`).set(headers);

  /** Offers the ride to `driver` and accepts it; returns the offer id. */
  async function assign(
    rideId: string,
    driver: { headers: Record<string, string> },
  ): Promise<string> {
    const run = await dispatch(ctx);
    expect(run.offered).toBeGreaterThanOrEqual(1);
    const offers = await ctx.http().get('/v1/drivers/me/offers').set(driver.headers).expect(200);
    const offer = (offers.body.offers as { id: string; rideId: string }[]).find(
      (o) => o.rideId === rideId,
    );
    expect(offer).toBeDefined();
    await ctx
      .http()
      .post(`/v1/drivers/me/offers/${offer?.id}/accept`)
      .set(driver.headers)
      .expect(200);
    return offer?.id ?? '';
  }

  describe('journey', () => {
    it('quotes, books, matches, starts with the PIN, completes, settles and rates', async () => {
      const driver = await driverSession(ctx, 'driver@example.com', north(800));
      const { rideId, bookingId, totalMinor } = await requestRide(ctx, rider.headers);

      const searching = await getRide(rideId).expect(200);
      expect(searching.body).toMatchObject({
        status: 'searching',
        driver: null,
        driverPosition: null,
      });
      expect(searching.body.pin).toMatch(/^\d{4}$/);

      await assign(rideId, driver);
      const assigned = await getRide(rideId).expect(200);
      expect(assigned.body).toMatchObject({
        status: 'assigned',
        driver: { firstName: 'Tunde', vehicle: { make: 'Toyota' } },
      });
      // Rounded to three decimals (about 110 m), never the exact fix.
      const position = assigned.body.driverPosition as { lat: number; lng: number };
      expect(Math.round(position.lat * 1000) / 1000).toBe(position.lat);

      // The driver sees the rider's first name only.
      const current = await ctx.http().get('/v1/drivers/me/ride').set(driver.headers).expect(200);
      expect(current.body.ride).toMatchObject({ id: rideId, riderFirstName: 'ADA' });
      expect(JSON.stringify(current.body)).not.toContain('rider@example.com');

      const pin = assigned.body.pin as string;
      const wrong = pin === '0000' ? '1111' : '0000';
      await ctx
        .http()
        .post(`/v1/drivers/me/rides/${rideId}/start`)
        .set(driver.headers)
        .send({ pin })
        .expect(409);
      await ctx
        .http()
        .post(`/v1/drivers/me/rides/${rideId}/arrive`)
        .set(driver.headers)
        .expect(200);
      const refused = await ctx
        .http()
        .post(`/v1/drivers/me/rides/${rideId}/start`)
        .set(driver.headers)
        .send({ pin: wrong })
        .expect(422);
      expect(refused.body).toMatchObject({ attemptsLeft: 4 });
      await ctx
        .http()
        .post(`/v1/drivers/me/rides/${rideId}/start`)
        .set(driver.headers)
        .send({ pin })
        .expect(200);

      const started = await getRide(rideId).expect(200);
      expect(started.body).toMatchObject({ status: 'in_progress', pin: null });

      await ctx
        .http()
        .post(`/v1/drivers/me/rides/${rideId}/complete`)
        .set(driver.headers)
        .expect(200);

      // The ledger moved everything paid out of the booking: the driver's share and commission.
      const lines = await ctx.prisma.ledgerEntry.findMany({
        where: { transaction: { idempotencyKey: `ride:${rideId}:completed` } },
        include: { account: true },
      });
      const credited = lines.filter((line) => line.direction === 'credit');
      const debited = lines.filter((line) => line.direction === 'debit');
      const sum = (rows: typeof lines) =>
        rows.reduce((total, line) => total + line.amountMinor, 0n);
      expect(sum(debited)).toBe(BigInt(totalMinor));
      expect(sum(credited)).toBe(BigInt(totalMinor));
      expect(credited.map((line) => line.account.code).sort()).toEqual(
        expect.arrayContaining([
          expect.stringContaining('driver-earnings'),
          expect.stringContaining('ride-commission'),
        ]),
      );

      const earnings = await ctx
        .http()
        .get('/v1/drivers/me/earnings')
        .set(driver.headers)
        .expect(200);
      expect(earnings.body.balance.amountMinor).toBeGreaterThan(0);
      expect(earnings.body.rides).toHaveLength(1);

      await ctx
        .http()
        .post(`/v1/rides/${rideId}/rating`)
        .set(rider.headers)
        .send({ stars: 5, comment: null })
        .expect(201);
      await ctx
        .http()
        .post(`/v1/rides/${rideId}/rating`)
        .set(rider.headers)
        .send({ stars: 1, comment: null })
        .expect(409);
      const rated = await getRide(rideId).expect(200);
      expect(rated.body).toMatchObject({ status: 'completed', rated: true, driver: { rating: 5 } });

      const booking = await ctx
        .http()
        .get(`/v1/bookings/${bookingId}`)
        .set(rider.headers)
        .expect(200);
      expect(booking.body.ride.rideId).toBe(rideId);
    });
  });

  describe('matching', () => {
    it('offers the nearest eligible of 200 drivers, then the next after a decline', async () => {
      const { rideId } = await requestRide(ctx, rider.headers);
      // 200 synthetic drivers between 300 m and 20 km away; only some are eligible.
      const created: { driverId: string; metres: number; eligible: boolean }[] = [];
      for (let index = 0; index < 200; index += 1) {
        const metres = 300 + ((index * 7919) % 19_700);
        const kind = index % 5;
        const eligible = kind === 0 || kind === 1;
        const { driverId } = await createDriver(ctx, {
          ...north(metres),
          // Ineligible: wrong category, offline, a stale position, or suspended.
          category: kind === 2 ? 'comfort' : 'standard',
          online: kind !== 3,
          staleSeconds: kind === 4 ? 600 : 0,
        });
        created.push({ driverId, metres, eligible });
      }
      const inRadius = created
        .filter((driver) => driver.eligible && driver.metres <= ctx.config.RIDE_MATCH_RADIUS_METRES)
        .sort((a, b) => a.metres - b.metres);
      expect(inRadius.length).toBeGreaterThan(2);

      const started = Date.now();
      const run = await dispatch(ctx);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(run.offered).toBe(1);
      const first = await ctx.prisma.rideOffer.findFirstOrThrow({
        where: { rideId, status: 'open' },
      });
      expect(first.driverId).toBe(inRadius[0]?.driverId);

      await ctx.prisma.rideOffer.update({ where: { id: first.id }, data: { status: 'declined' } });
      await dispatch(ctx);
      const second = await ctx.prisma.rideOffer.findFirstOrThrow({
        where: { rideId, status: 'open' },
      });
      expect(second.driverId).toBe(inRadius[1]?.driverId);

      // An offer nobody answers expires, and the ride moves on to the next driver.
      await ctx.prisma.rideOffer.update({
        where: { id: second.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const after = await dispatch(ctx);
      expect(after.expired).toBe(1);
      const third = await ctx.prisma.rideOffer.findFirstOrThrow({
        where: { rideId, status: 'open' },
      });
      expect(third.driverId).toBe(inRadius[2]?.driverId);
    });

    it('lets exactly one acceptance win and keeps other drivers out', async () => {
      const driver = await driverSession(ctx, 'first@example.com', north(500));
      const other = await driverSession(ctx, 'second@example.com', north(9_000));
      const { rideId } = await requestRide(ctx, rider.headers);
      await dispatch(ctx);
      const offer = await ctx.prisma.rideOffer.findFirstOrThrow({ where: { rideId } });
      expect(offer.driverId).toBe(driver.driverId);

      // Another driver cannot accept an offer that is not theirs.
      await ctx
        .http()
        .post(`/v1/drivers/me/offers/${offer.id}/accept`)
        .set(other.headers)
        .expect(404);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          ctx.http().post(`/v1/drivers/me/offers/${offer.id}/accept`).set(driver.headers),
        ),
      );
      expect(results.filter((result) => result.status === 200)).toHaveLength(1);
      expect(results.filter((result) => result.status === 409)).toHaveLength(4);
      // Nor act on a ride assigned to someone else.
      await ctx.http().post(`/v1/drivers/me/rides/${rideId}/arrive`).set(other.headers).expect(404);
    });

    it('ends a search nobody accepts as no_driver and refunds it in full', async () => {
      const { rideId, bookingId } = await requestRide(ctx, rider.headers);
      await ctx.prisma.ride.update({
        where: { id: rideId },
        data: {
          searchStartedAt: new Date(
            Date.now() - (ctx.config.RIDE_MATCH_TIMEOUT_SECONDS + 5) * 1000,
          ),
        },
      });
      const run = await dispatch(ctx);
      expect(run.timedOut).toBe(1);
      await ctx.background.drain();
      expect((await getRide(rideId).expect(200)).body.status).toBe('no_driver');
      const booking = await ctx
        .http()
        .get(`/v1/bookings/${bookingId}`)
        .set(rider.headers)
        .expect(200);
      expect(['REFUND_PENDING', 'REFUNDED']).toContain(booking.body.status);
      expect(await ctx.prisma.refund.count({ where: { bookingId } })).toBe(1);
    });
  });

  describe('safety', () => {
    it('locks the ride after five wrong PINs and raises an incident', async () => {
      const driver = await driverSession(ctx, 'pin-driver@example.com', north(500));
      const { rideId } = await requestRide(ctx, rider.headers);
      await assign(rideId, driver);
      await ctx
        .http()
        .post(`/v1/drivers/me/rides/${rideId}/arrive`)
        .set(driver.headers)
        .expect(200);
      const pin = (await getRide(rideId).expect(200)).body.pin as string;
      const wrong = pin === '0000' ? '1111' : '0000';
      const start = (value: string) =>
        ctx
          .http()
          .post(`/v1/drivers/me/rides/${rideId}/start`)
          .set(driver.headers)
          .send({ pin: value });
      for (const left of [4, 3, 2, 1]) {
        expect((await start(wrong).expect(422)).body.attemptsLeft).toBe(left);
      }
      await start(wrong).expect(423);
      // Locked: even the right PIN no longer starts the trip.
      await start(pin).expect(423);
      const incidents = await ctx.http().get('/v1/admin/rides/incidents').set(staff).expect(200);
      expect(incidents.body.incidents).toEqual([
        expect.objectContaining({
          kind: 'pin_lockout',
          rideId,
          reporter: 'system',
          status: 'open',
        }),
      ]);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'ride.pin_locked', targetId: rideId } }),
      ).toBe(1);
    });

    it('texts emergency contacts on SOS and queues the incident for the safety desk', async () => {
      await ctx
        .http()
        .put('/v1/me/emergency-contacts')
        .set(rider.headers)
        .send({
          contacts: [
            { name: 'Mum', phone: '+2348030000001' },
            { name: 'Ify', phone: '+2348030000002' },
          ],
        })
        .expect(200);
      const stored = await ctx.prisma.emergencyContact.findMany();
      expect(stored).toHaveLength(2);
      expect(JSON.stringify(stored)).not.toContain('+2348030000001');

      const { rideId } = await requestRide(ctx, rider.headers);
      const stranger = await signUp(ctx, 'nosy@example.com');
      await ctx
        .http()
        .post(`/v1/rides/${rideId}/sos`)
        .set(bearer(stranger.accessToken))
        .send({})
        .expect(404);

      const sent = ctx.sms.outbox.length;
      const sos = await ctx
        .http()
        .post(`/v1/rides/${rideId}/sos`)
        .set(rider.headers)
        .send({ position: north(100) })
        .expect(200);
      expect(sos.body).toMatchObject({ contactsNotified: 2, emergencyNumber: '112' });
      expect(ctx.sms.outbox.length - sent).toBe(2);

      const incidentId = sos.body.incidentId as string;
      const queue = await ctx
        .http()
        .get('/v1/admin/rides/incidents?status=open')
        .set(staff)
        .expect(200);
      expect(queue.body.incidents).toEqual([
        expect.objectContaining({ id: incidentId, kind: 'sos', reporter: 'rider' }),
      ]);
      await ctx
        .http()
        .post(`/v1/admin/rides/incidents/${incidentId}/acknowledge`)
        .set(staff)
        .expect(204);
      await ctx
        .http()
        .post(`/v1/admin/rides/incidents/${incidentId}/resolve`)
        .set(staff)
        .send({ resolution: 'assisted' })
        .expect(204);
      const closed = await ctx
        .http()
        .get('/v1/admin/rides/incidents?status=resolved')
        .set(staff)
        .expect(200);
      expect(closed.body.incidents[0]).toMatchObject({ id: incidentId, resolution: 'assisted' });
    });

    it('shares a live link that shows no rider data and stops when revoked', async () => {
      const driver = await driverSession(ctx, 'share-driver@example.com', north(700));
      const { rideId } = await requestRide(ctx, rider.headers);
      await assign(rideId, driver);
      const share = await ctx
        .http()
        .post(`/v1/rides/${rideId}/share`)
        .set(rider.headers)
        .expect(201);
      const token = share.body.token as string;
      expect(token.length).toBeGreaterThanOrEqual(20);
      // Stored as an HMAC, never the token itself.
      expect(JSON.stringify(await ctx.prisma.rideShareLink.findMany())).not.toContain(token);

      const shared = await ctx.http().get(`/v1/public/trips/${token}`).expect(200);
      expect(shared.body).toMatchObject({ status: 'assigned', driver: { firstName: 'Tunde' } });
      const text = JSON.stringify(shared.body);
      for (const secret of [
        'rider@example.com',
        'ADA',
        'Obi',
        rideId,
        (await getRide(rideId)).body.pin as string,
      ]) {
        expect(text).not.toContain(secret);
      }
      await ctx.http().delete(`/v1/rides/${rideId}/share`).set(rider.headers).expect(204);
      await ctx.http().get(`/v1/public/trips/${token}`).expect(404);
      await ctx.http().get('/v1/public/trips/AAAAAAAAAAAAAAAAAAAAAAAA').expect(404);
    });
  });

  describe('cancellation', () => {
    it('is free while searching and refunds everything', async () => {
      const { rideId, bookingId, totalMinor } = await requestRide(ctx, rider.headers);
      const cancelled = await ctx
        .http()
        .post(`/v1/rides/${rideId}/cancel`)
        .set(rider.headers)
        .expect(200);
      expect(cancelled.body).toMatchObject({
        ride: { status: 'cancelled', cancelledBy: 'rider' },
        fee: { amountMinor: 0, currency: 'NGN' },
        refund: { amountMinor: totalMinor, currency: 'NGN' },
      });
      expect(await ctx.prisma.rideOffer.count({ where: { rideId, status: 'open' } })).toBe(0);
      const refunds = await ctx.prisma.refund.findMany({ where: { bookingId } });
      expect(refunds.map((refund) => Number(refund.amountMinor))).toEqual([totalMinor]);
      await ctx.http().post(`/v1/rides/${rideId}/cancel`).set(rider.headers).expect(409);
    });

    it('keeps the fee after the free window and shares it with the driver who came', async () => {
      const driver = await driverSession(ctx, 'fee-driver@example.com', north(500));
      const { rideId, totalMinor } = await requestRide(ctx, rider.headers);
      await assign(rideId, driver);
      await ctx.prisma.ride.update({
        where: { id: rideId },
        data: { assignedAt: new Date(Date.now() - 10 * 60_000) },
      });
      const cancelled = await ctx
        .http()
        .post(`/v1/rides/${rideId}/cancel`)
        .set(rider.headers)
        .expect(200);
      expect(cancelled.body.fee).toEqual({ amountMinor: 50_000, currency: 'NGN' });
      expect(cancelled.body.refund).toEqual({ amountMinor: totalMinor - 50_000, currency: 'NGN' });
      const share = await ctx.prisma.ledgerEntry.findFirst({
        where: {
          transaction: { idempotencyKey: `ride:${rideId}:cancellation-fee` },
          account: { code: { contains: 'driver-earnings' } },
        },
      });
      expect(share?.amountMinor).toBe(40_000n);
      // The driver is free again.
      const state = await ctx.http().get('/v1/drivers/me/state').set(driver.headers).expect(200);
      expect(state.body.currentRideId).toBeNull();
    });

    it('lets staff stop a ride and refund it in full', async () => {
      const driver = await driverSession(ctx, 'stop-driver@example.com', north(500));
      const { rideId, bookingId, totalMinor } = await requestRide(ctx, rider.headers);
      await assign(rideId, driver);
      const live = await ctx.http().get('/v1/admin/rides/live').set(staff).expect(200);
      expect(live.body.rides).toEqual([
        expect.objectContaining({ id: rideId, status: 'assigned', driverId: driver.driverId }),
      ]);
      await ctx
        .http()
        .post(`/v1/admin/rides/${rideId}/cancel`)
        .set(staff)
        .send({ reason: 'safety' })
        .expect(204);
      expect((await getRide(rideId).expect(200)).body).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'staff',
      });
      const refunds = await ctx.prisma.refund.findMany({ where: { bookingId } });
      expect(refunds.reduce((sum, refund) => sum + Number(refund.amountMinor), 0)).toBe(totalMinor);
    });
  });

  describe('ownership and driver gates', () => {
    it("answers 404 for another rider's ride on every rider route", async () => {
      const { rideId } = await requestRide(ctx, rider.headers);
      const other = bearer((await signUp(ctx, 'other@example.com')).accessToken);
      await ctx.http().get(`/v1/rides/${rideId}`).set(other).expect(404);
      await ctx.http().post(`/v1/rides/${rideId}/cancel`).set(other).expect(404);
      await ctx.http().post(`/v1/rides/${rideId}/share`).set(other).expect(404);
      await ctx.http().delete(`/v1/rides/${rideId}/share`).set(other).expect(404);
      await ctx
        .http()
        .post(`/v1/rides/${rideId}/rating`)
        .set(other)
        .send({ stars: 1, comment: null })
        .expect(404);
      const list = await ctx.http().get('/v1/rides').set(other).expect(200);
      expect(list.body.rides).toEqual([]);
      // Riders without the driver role cannot use driver routes at all.
      await ctx.http().get('/v1/drivers/me/offers').set(other).expect(403);
    });

    it('refuses implausible positions and keeps suspended drivers offline', async () => {
      const driver = await driverSession(ctx, 'gate-driver@example.com', north(500));
      await ctx
        .http()
        .post('/v1/drivers/me/online')
        .set(driver.headers)
        .send({ position: north(500) })
        .expect(200);
      // Accra is outside the Nigerian service area.
      await ctx
        .http()
        .post('/v1/drivers/me/location')
        .set(driver.headers)
        .send({ position: { lat: 5.6037, lng: -0.187 } })
        .expect(422);
      // 30 km in an instant is not a car.
      await ctx
        .http()
        .post('/v1/drivers/me/location')
        .set(driver.headers)
        .send({ position: north(30_000) })
        .expect(422);

      await ctx.prisma.driver.update({
        where: { id: driver.driverId },
        data: { status: 'suspended', online: false },
      });
      const refused = await ctx
        .http()
        .post('/v1/drivers/me/online')
        .set(driver.headers)
        .send({ position: north(500) })
        .expect(409);
      expect(refused.body).toMatchObject({ reason: 'not_approved' });
    });

    it('needs an account to quote a ride and refuses trips outside a served city', async () => {
      await ctx
        .http()
        .post('/v1/inhouse-quotes')
        .send({ kind: 'ride', category: 'standard', pickup: IKEJA, dropoff: LEKKI })
        .expect(401);
      const abuja = { label: 'Wuse 2', lat: 9.0765, lng: 7.4986 };
      const outside = await ctx
        .http()
        .post('/v1/inhouse-quotes')
        .set(rider.headers)
        .send({
          kind: 'ride',
          category: 'standard',
          pickup: abuja,
          dropoff: { ...abuja, lat: 9.06 },
        })
        .expect(422);
      expect(outside.body).toMatchObject({ code: 'outside_service_area' });
      const xl = await ctx
        .http()
        .post('/v1/inhouse-quotes')
        .set(rider.headers)
        .send({ kind: 'ride', category: 'xl', pickup: IKEJA, dropoff: LEKKI })
        .expect(422);
      expect(xl.body).toMatchObject({ code: 'category_unavailable' });
    });
  });

  describe('live updates', () => {
    let url: string;
    beforeAll(async () => {
      const server = ctx.app.getHttpServer();
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/ws/rides`;
    });
    // The suite opened the port, so it closes it (the app's close leaves a listener it did not start).
    afterAll(async () => {
      const server = ctx.app.getHttpServer();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    /** Opens a socket, authenticates with a bearer token and collects messages. */
    async function connect(
      token: string,
    ): Promise<{ socket: WebSocket; next: (type: string) => Promise<Record<string, unknown>> }> {
      const socket = new WebSocket(url);
      const inbox: Record<string, unknown>[] = [];
      const waiters: { type: string; resolve: (message: Record<string, unknown>) => void }[] = [];
      socket.on('message', (data) => {
        const message = JSON.parse((data as Buffer).toString('utf8')) as Record<string, unknown>;
        const waiter = waiters.find((candidate) => candidate.type === message.type);
        if (waiter) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        } else {
          inbox.push(message);
        }
      });
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      const next = (type: string) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const queued = inbox.find((message) => message.type === type);
          if (queued) {
            inbox.splice(inbox.indexOf(queued), 1);
            resolve(queued);
            return;
          }
          waiters.push({ type, resolve });
          setTimeout(() => reject(new Error(`no ${type} message`)), 3000);
        });
      socket.send(JSON.stringify({ type: 'auth', token }));
      await next('ready');
      return { socket, next };
    }

    it("streams the rider's own ride and refuses another rider's", async () => {
      const driver = await driverSession(ctx, 'ws-driver@example.com', north(600));
      const { rideId } = await requestRide(ctx, rider.headers);
      const stranger = await signUp(ctx, 'stranger@example.com');

      const own = await connect(rider.accessToken);
      own.socket.send(JSON.stringify({ type: 'subscribe', rideId }));
      expect(await own.next('subscribed')).toMatchObject({ rideId });

      const other = await connect(stranger.accessToken);
      other.socket.send(JSON.stringify({ type: 'subscribe', rideId }));
      expect(await other.next('error')).toEqual({ type: 'error', code: 'not_found', rideId });

      await assign(rideId, driver);
      expect(await own.next('ride.updated')).toMatchObject({ rideId, status: 'assigned' });
      await ctx
        .http()
        .post('/v1/drivers/me/location')
        .set(driver.headers)
        // A few metres on: a jump the plausibility check would refuse is tested elsewhere.
        .send({ position: north(590) })
        .expect(204);
      const location = await own.next('ride.location');
      expect(location).toMatchObject({ rideId, etaSeconds: expect.any(Number) });
      own.socket.terminate();
      other.socket.terminate();
    });

    it('closes sockets that never authenticate or send bad tokens', async () => {
      const silent = new WebSocket(url);
      await new Promise((resolve) => silent.once('open', resolve));
      silent.send(
        JSON.stringify({ type: 'subscribe', rideId: '0192f0e0-0000-7000-8000-000000000001' }),
      );
      const code = await new Promise<number>((resolve) =>
        silent.once('close', (closeCode) => resolve(closeCode)),
      );
      expect(code).toBe(4401);

      const forged = new WebSocket(url);
      await new Promise((resolve) => forged.once('open', resolve));
      forged.send(JSON.stringify({ type: 'auth', token: 'not-a-token' }));
      expect(
        await new Promise<number>((resolve) =>
          forged.once('close', (closeCode) => resolve(closeCode)),
        ),
      ).toBe(4401);
    });

    it('refuses cookie upgrades from other origins', async () => {
      const response = await new Promise<number>((resolve) => {
        const socket = new WebSocket(url, {
          headers: {
            cookie: `${sessionCookieNames(ctx.config).access}=whatever`,
            origin: 'https://evil.example',
          },
        });
        socket.once('unexpected-response', (request, res) => {
          resolve(res.statusCode ?? 0);
          request.destroy();
        });
        socket.once('open', () => {
          socket.close();
          resolve(101);
        });
        socket.once('error', () => resolve(-1));
      });
      expect(response).toBe(403);
    });
  });
});
