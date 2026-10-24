import { TicketSigner } from '../src/ground/ticket-signer';

import { bearer, grantRoles, PASSWORD, signUp } from './helpers/flows';
import {
  book,
  busInventory,
  nextKey,
  passenger,
  payInFull,
  staffSession,
  type BusInventory,
} from './helpers/cars';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const NAMES = ['Ada', 'Bola', 'Chidi', 'Dayo', 'Emeka', 'Funke'];

interface Hold {
  holdId: string;
  holdToken: string | null;
  seats: string[];
  expiresAt: string;
}

interface Ticket {
  id: string;
  seatNumber: string;
  passengerName: string;
  status: string;
  qrPayload: string | null;
}

/**
 * Interstate buses (Cars P3, ADR-049 to ADR-051): search and seat maps, ten-minute holds that
 * Redis grants once per seat (50 parallel requests, one winner), quotes only for the hold's owner,
 * bookings that claim the held seats, signed QR boarding passes, operator agents who board each
 * ticket once and only for their operator, cancellation under policy and trip cancellation.
 */
describe('buses (e2e)', () => {
  let ctx: TestContext;
  let staff: Record<string, string>;
  let inventory: BusInventory;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    staff = (await staffSession(ctx, 'ground@suskii.test', ['operations'])).headers;
    inventory = await busInventory(ctx, staff);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  const hold = (seats: string[], headers: Record<string, string> = {}) =>
    ctx.http().post(`/v1/buses/trips/${inventory.tripId}/holds`).set(headers).send({ seats });

  const quote = (holdId: string, holdToken: string | null, headers: Record<string, string> = {}) =>
    ctx.http().post('/v1/inhouse-quotes').set(headers).send({ kind: 'bus', holdId, holdToken });

  async function agent(email: string, operatorId: string): Promise<Record<string, string>> {
    const session = await signUp(ctx, email);
    await ctx
      .http()
      .put(`/v1/admin/ground/operators/${operatorId}/agents/${session.userId}`)
      .set(staff)
      .expect(204);
    // The role is granted with the membership; sign in again to carry it.
    const again = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return bearer(again.body.accessToken as string);
  }

  /** A guest books and pays two seats; returns the booking, its token and tickets. */
  async function guestBooking(seats = ['3A', '3B']) {
    const held = await hold(seats).expect(201);
    const body = held.body as Hold;
    const quoted = await quote(body.holdId, body.holdToken).expect(201);
    expect(quoted.body.vertical).toBe('buses');
    expect(quoted.body.bus).toMatchObject({ seats, operatorName: 'Lagoon Express' });
    const created = await book(ctx, {
      quoteId: quoted.body.quoteId,
      passengers: seats.map((_, index) => passenger(NAMES[index] ?? 'Ada', 'Okafor')),
    });
    expect(created.status).toBe(201);
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const bookingId = created.body.booking.id as string;
    expect(created.body.booking.paymentDeadline <= body.expiresAt).toBe(true);
    const paid = await payInFull(ctx, bookingId, token);
    return { bookingId, token, booking: paid };
  }

  describe('search and seat maps', () => {
    it('finds departures with seats left and prices a seat for the caller', async () => {
      const today = await ctx.prisma.busTrip.findUniqueOrThrow({ where: { id: inventory.tripId } });
      const search = await ctx
        .http()
        .get('/v1/buses/search')
        .query({ from: 'lagos', to: 'Ibadan', date: today.departsAtLocal.slice(0, 10), seats: 2 })
        .expect(200);
      expect(search.body.trips).toEqual([
        expect.objectContaining({
          id: inventory.tripId,
          seatsLeft: 40,
          pricePerSeat: { amountMinor: 850_000, currency: 'NGN' },
          operator: expect.objectContaining({ name: 'Lagoon Express' }),
        }),
      ]);
      const cities = await ctx.http().get('/v1/buses/cities').expect(200);
      expect(cities.body.cities.map((city: { name: string }) => city.name)).toEqual([
        'Ibadan',
        'Lagos',
      ]);
    });

    it('shows held, sold and blocked seats on the seat map', async () => {
      await ctx
        .http()
        .patch(`/v1/admin/ground/trips/${inventory.tripId}`)
        .set(staff)
        .send({ blockedSeats: ['1A'] })
        .expect(204);
      await hold(['2A']).expect(201);
      const detail = await ctx.http().get(`/v1/buses/trips/${inventory.tripId}`).expect(200);
      const states = Object.fromEntries(
        (detail.body.seatMap.rows as ({ seatNumber: string; state: string } | null)[][])
          .flat()
          .flatMap((seat) => (seat ? [[seat.seatNumber, seat.state]] : [])),
      );
      expect(states).toMatchObject({ '1A': 'blocked', '2A': 'held', '2B': 'available' });
      expect(detail.body.seatsLeft).toBe(38);
      await hold(['1A']).expect(409);
      await hold(['9Z']).expect(400);
      await hold(['11A']).expect(422);
    });
  });

  describe('holds', () => {
    it('grants a contested seat to exactly one of 50 parallel requests', async () => {
      const callers = await Promise.all(
        Array.from({ length: 50 }, (_, index) => signUp(ctx, `racer${index}@example.com`)),
      );
      const results = await Promise.all(
        callers.map((caller) => hold(['5C'], bearer(caller.accessToken))),
      );
      const statuses = results.map((result) => result.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(49);
      expect(
        results
          .filter((result) => result.status === 409)
          .every((result) => String(result.body.type).endsWith(':seat-taken')),
      ).toBe(true);
      expect(await ctx.prisma.busSeatHold.count({ where: { tripId: inventory.tripId } })).toBe(1);
    });

    it('holds all requested seats or none, and caps live holds per caller', async () => {
      const first = await signUp(ctx, 'first@example.com');
      const second = await signUp(ctx, 'second@example.com');
      await hold(['4A'], bearer(first.accessToken)).expect(201);
      // 4B is free but 4A is not: nothing is held.
      await hold(['4B', '4A'], bearer(second.accessToken)).expect(409);
      await hold(['4B'], bearer(second.accessToken)).expect(201);
      await hold(['6A'], bearer(first.accessToken)).expect(201);
      const limited = await hold(['6B'], bearer(first.accessToken)).expect(409);
      expect(limited.body.type).toMatch(/hold-limit$/);
    });

    it('lets only the hold owner quote or release it', async () => {
      const owner = await signUp(ctx, 'owner@example.com');
      const stranger = await signUp(ctx, 'stranger@example.com');
      const mine = (await hold(['7A'], bearer(owner.accessToken)).expect(201)).body as Hold;
      expect(mine.holdToken).toBeNull();
      await quote(mine.holdId, null, bearer(stranger.accessToken)).expect(404);
      await quote(mine.holdId, null).expect(404);
      await ctx
        .http()
        .delete(`/v1/buses/holds/${mine.holdId}`)
        .set(bearer(stranger.accessToken))
        .expect(404);

      const guest = (await hold(['7B']).expect(201)).body as Hold;
      await quote(guest.holdId, 'not-the-token').expect(404);
      await quote(guest.holdId, guest.holdToken).expect(201);
      await ctx
        .http()
        .delete(`/v1/buses/holds/${guest.holdId}`)
        .set('X-Hold-Token', guest.holdToken ?? '')
        .expect(204);
      // Released: the seat is free again for someone else.
      await hold(['7B'], bearer(stranger.accessToken)).expect(201);
    });

    it('refuses to book a lapsed hold', async () => {
      const guest = (await hold(['8A']).expect(201)).body as Hold;
      const quoted = await quote(guest.holdId, guest.holdToken).expect(201);
      await ctx.prisma.busSeatHold.update({
        where: { id: guest.holdId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const refused = await book(ctx, {
        quoteId: quoted.body.quoteId,
        passengers: [passenger('Late', 'Comer')],
      }).expect(409);
      expect(refused.body.type).toMatch(/seat-taken$/);
      expect(await ctx.prisma.busSeatAssignment.count()).toBe(0);
    });
  });

  describe('booking, tickets and boarding', () => {
    it('confirms a paid booking with one signed boarding pass per seat', async () => {
      const { booking } = await guestBooking();
      expect(booking.status).toBe('CONFIRMED');
      const tickets = booking.busTickets as Ticket[];
      expect(tickets.map((ticket) => [ticket.seatNumber, ticket.status])).toEqual([
        ['3A', 'valid'],
        ['3B', 'valid'],
      ]);
      expect(tickets[0]?.passengerName).toBe('ADA OKAFOR');
      const verdict = ctx.app
        .get(TicketSigner)
        .verify(tickets[0]?.qrPayload ?? '', new Date(Date.now() + 5 * 86_400_000 - 3_600_000));
      expect(verdict).toMatchObject({ valid: true, claims: { st: '3A', trp: inventory.tripId } });
      // The payload carries ids and the window only.
      expect(tickets[0]?.qrPayload).not.toContain('Okafor');
      expect(booking.documents).toEqual([expect.objectContaining({ type: 'bus_ticket' })]);
      expect(await ctx.prisma.busSeatAssignment.count({ where: { active: true } })).toBe(2);
    });

    it("boards each ticket once, for the operator's own agents only", async () => {
      const { booking } = await guestBooking();
      const [ticket] = booking.busTickets as Ticket[];
      const payload = ticket?.qrPayload ?? '';
      const own = await agent('agent@lagoon.test', inventory.operatorId);
      const foreign = await agent('agent@savannah.test', inventory.otherOperatorId);
      const traveller = await signUp(ctx, 'nosy@example.com');

      await ctx
        .http()
        .post('/v1/operator/tickets/scan')
        .set(bearer(traveller.accessToken))
        .send({ qrPayload: payload })
        .expect(403);
      const departure = await ctx.prisma.busTrip.findUniqueOrThrow({
        where: { id: inventory.tripId },
      });
      const atGate = new Date(departure.departsAt.getTime() - 30 * 60_000).toISOString();
      // Another operator's agent, inside the boarding window: as if the ticket did not exist.
      const elsewhere = await ctx
        .http()
        .post('/v1/operator/tickets/sync')
        .set(foreign)
        .send({ scans: [{ qrPayload: payload, scannedAt: atGate }] })
        .expect(200);
      expect(elsewhere.body.results).toEqual([{ result: 'not_found', reason: null, ticket: null }]);

      // Boarding opens three hours before departure (five days away here).
      const early = await ctx
        .http()
        .post('/v1/operator/tickets/scan')
        .set(own)
        .send({ qrPayload: payload })
        .expect(200);
      expect(early.body).toMatchObject({ result: 'invalid', reason: 'not_yet_valid' });

      const tampered = `${payload.slice(0, -4)}AAAA`;
      const forged = await ctx
        .http()
        .post('/v1/operator/tickets/scan')
        .set(own)
        .send({ qrPayload: tampered })
        .expect(200);
      expect(forged.body).toMatchObject({ result: 'invalid', reason: 'bad_signature' });

      const synced = await ctx
        .http()
        .post('/v1/operator/tickets/sync')
        .set(own)
        .send({
          scans: [
            { qrPayload: payload, scannedAt: atGate },
            { qrPayload: payload, scannedAt: new Date(Date.parse(atGate) + 60_000).toISOString() },
          ],
        })
        .expect(200);
      expect(synced.body.results.map((result: { result: string }) => result.result)).toEqual([
        'boarded',
        'already_boarded',
      ]);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'bus.ticket_scan_conflict', targetId: ticket?.id ?? '' },
        }),
      ).toBe(1);

      const manifest = await ctx
        .http()
        .get(`/v1/operator/trips/${inventory.tripId}/manifest`)
        .set(own)
        .expect(200);
      expect(manifest.body.passengers).toEqual([
        expect.objectContaining({ seatNumber: '3A', status: 'boarded' }),
        expect.objectContaining({ seatNumber: '3B', status: 'valid' }),
      ]);
      await ctx
        .http()
        .get(`/v1/operator/trips/${inventory.tripId}/manifest`)
        .set(foreign)
        .expect(404);
      const keys = await ctx.http().get('/v1/buses/ticket-keys').expect(200);
      expect(keys.body.keys).toHaveLength(1);
    });

    it('cancels under the operator policy, voids the passes and frees the seats', async () => {
      const { bookingId, token, booking } = await guestBooking();
      // Five days out: the 90% tier.
      expect(booking.cancellation).toEqual({
        refundBps: 9_000,
        refund: { amountMinor: 1_530_000, currency: 'NGN' },
      });
      await ctx
        .http()
        .post(`/v1/bookings/${bookingId}/cancel`)
        .set('Idempotency-Key', nextKey('e2e-bus-cancel'))
        .set(token)
        .expect(200);
      await ctx.background.drain();
      const after = await ctx.http().get(`/v1/bookings/${bookingId}`).set(token).expect(200);
      expect((after.body.busTickets as Ticket[]).every((ticket) => ticket.status === 'void')).toBe(
        true,
      );
      expect((after.body.busTickets as Ticket[]).every((ticket) => ticket.qrPayload === null)).toBe(
        true,
      );
      expect(await ctx.prisma.busSeatAssignment.count({ where: { active: true } })).toBe(0);
      expect(
        await ctx.prisma.ledgerAccount.findUnique({ where: { code: 'fees:cancellation:NGN' } }),
      ).toMatchObject({ balanceMinor: 170_000n });
    });

    it('refunds every paid booking when operations cancel the departure', async () => {
      const { bookingId, token } = await guestBooking(['9A']);
      const unpaid = (await hold(['9B']).expect(201)).body as Hold;
      const unpaidQuote = await quote(unpaid.holdId, unpaid.holdToken).expect(201);
      const pending = await book(ctx, {
        quoteId: unpaidQuote.body.quoteId,
        passengers: [passenger('Pending', 'Payer')],
      }).expect(201);

      const cancelled = await ctx
        .http()
        .post(`/v1/admin/ground/trips/${inventory.tripId}/cancel`)
        .set(staff)
        .send({ reason: 'vehicle_fault' })
        .expect(200);
      expect(cancelled.body).toEqual({ refundedBookings: 1, releasedBookings: 1 });
      await ctx.background.drain();
      const refunded = await ctx.http().get(`/v1/bookings/${bookingId}`).set(token).expect(200);
      expect(['REFUND_PENDING', 'REFUNDED']).toContain(refunded.body.status);
      expect(refunded.body.refunds).toEqual([
        expect.objectContaining({ amount: { amountMinor: 850_000, currency: 'NGN' } }),
      ]);
      const released = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: pending.body.booking.id as string },
      });
      expect(released.status).toBe('CANCELLED');
      await ctx.http().get(`/v1/buses/trips/${inventory.tripId}`).expect(409);
    });
  });

  describe('switched off', () => {
    it('answers 404 on every bus route, before authentication', async () => {
      const off = await createTestApp({ RATE_LIMIT_ENABLED: false, CARS_BUSES_ENABLED: false });
      try {
        await off.http().get('/v1/buses/cities').expect(404);
        // Clients learn which products to show.
        const features = await off.http().get('/v1/cars/features').expect(200);
        expect(features.body).toMatchObject({ buses: false, rides: true, rentals: true });
        expect(features.headers['cache-control']).toBe('public, max-age=60');
        await off
          .http()
          .post('/v1/operator/tickets/scan')
          .send({ qrPayload: 'x'.repeat(30) })
          .expect(404);
        await off.http().get('/v1/admin/ground/operators').expect(404);
        const user = await signUp(off, 'off@example.com');
        await grantRoles(off, user.userId, ['customer']);
        await off
          .http()
          .post('/v1/inhouse-quotes')
          .set(bearer(user.accessToken))
          .send({ kind: 'bus', holdId: '0192f0e0-0000-7000-8000-000000000001', holdToken: null })
          .expect(404);
      } finally {
        await off.close();
      }
    });
  });
});
