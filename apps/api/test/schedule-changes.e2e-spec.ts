import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';
import { MockFlightSupplier } from '../src/suppliers/mock/mock-flight-supplier';

import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const MINUTE_MS = 60_000;
const OPS_EMAIL = 'ops@suskii.test';

let keySequence = 0;
const idempotencyKey = (): string => `e2e-schedule-${Date.now()}-${(keySequence += 1)}`;

interface Slice {
  departureUtc: string;
  departureLocal: string;
}

interface Offer {
  id: string;
  conditions: { refundable: boolean };
}

/** Airline schedule changes on ticketed flights (ADR-065), on the mock supplier. */
describe('airline schedule changes (e2e)', () => {
  let ctx: TestContext;
  let mock: MockFlightSupplier;

  beforeAll(async () => {
    ctx = await createTestApp({ OPS_ALERT_EMAIL: OPS_EMAIL });
    mock = ctx.app.get(MockFlightSupplier);
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    mock.scheduleRules.clear();
    mock.airlineChanges.clear();
    mock.failNextChangeAcceptances = 0;
    mock.failNextCancellations = 0;
    mock.involuntaryRefundBps = 10_000;
    mock.cancelledOrders.clear();
  });
  // Notices and document renders run in the background; let them finish before the next reset.
  afterEach(async () => {
    await ctx.background.drain();
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** A guest's ticketed domestic flight, paid in full through the mock provider. */
  async function ticketedFlight(refundable = true): Promise<{
    id: string;
    token: Record<string, string>;
  }> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offer = (search.body.offers as Offer[]).find(
      (candidate) => candidate.conditions.refundable === refundable,
    );
    if (!offer) throw new Error('The mock sells no such fare');
    const quote = await ctx.http().post(`/v1/flights/offers/${offer.id}/quote`).expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId as string,
        contact: { email: 'ada@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Ada',
            surname: 'Okafor',
            dateOfBirth: '1990-04-01',
            nationality: 'NG',
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    const id = created.body.booking.id as string;
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${id}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(token)
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const booking = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    expect(booking.body).toMatchObject({ status: 'CONFIRMED', scheduleChange: null });
    return { id, token };
  }

  /** Makes the booking's flight due for a check, then runs the worker's sweep. */
  async function sweep(bookingId: string) {
    await ctx.prisma.bookingItem.updateMany({
      where: { bookingId },
      data: { nextChangeCheckAt: new Date(Date.now() - MINUTE_MS) },
    });
    const run = await ctx
      .http()
      .post('/v1/internal/bookings/schedule-changes-due')
      .set(INTERNAL)
      .expect(200);
    await ctx.background.drain();
    return run.body as { checked: number; detected: number; resolved: number; failed: number };
  }

  const accept = (id: string, changeId: string, token: Record<string, string>) =>
    ctx.http().post(`/v1/bookings/${id}/schedule-changes/${changeId}/accept`).set(token);

  it('finds a change, tells the traveller, and moves the booking once they accept', async () => {
    const { id, token } = await ticketedFlight();
    // Ticketing booked the first check for later.
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId: id } });
    expect(item.nextChangeCheckAt?.getTime()).toBeGreaterThan(Date.now() + 5 * 60 * MINUTE_MS);

    // Nothing changed yet.
    expect(await sweep(id)).toEqual({ checked: 1, detected: 0, resolved: 0, failed: 0 });

    mock.scheduleRules.set('LOS-ABV', 90);
    ctx.emails.outbox.length = 0;
    expect(await sweep(id)).toEqual({ checked: 1, detected: 1, resolved: 0, failed: 0 });
    const notices = ctx.emails.outbox.filter((message) => message.template === 'schedule-changed');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.to).toBe('ada@example.com');
    expect(notices[0]?.text).toMatch(/Lagos \(LOS\) to Abuja \(ABV\): was .+\. Now .+\./);
    // A guest's notice links to the booking with an access token in the fragment.
    expect(notices[0]?.text).toMatch(/#access=/);

    const before = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    const change = before.body.scheduleChange as {
      id: string;
      status: string;
      acceptable: boolean;
      previous: Slice[];
      updated: Slice[];
    };
    expect(change).toMatchObject({ status: 'open', acceptable: true });
    const booked = before.body.flight.slices[0] as Slice;
    const moved = change.updated[0];
    // The booking keeps the booked flights until the traveller decides.
    expect(change.previous[0]?.departureUtc).toBe(booked.departureUtc);
    expect(Date.parse(moved?.departureUtc ?? '') - Date.parse(booked.departureUtc)).toBe(
      90 * MINUTE_MS,
    );

    // Checking again finds nothing new.
    expect(await sweep(id)).toEqual({ checked: 1, detected: 0, resolved: 0, failed: 0 });

    const accepted = await accept(id, change.id, token).expect(200);
    expect(accepted.body.scheduleChange).toMatchObject({ id: change.id, status: 'accepted' });
    expect(accepted.body.flight.slices[0]).toMatchObject({
      departureUtc: moved?.departureUtc,
      departureLocal: moved?.departureLocal,
    });
    expect(mock.airlineChanges.values().next().value?.change.actionTaken).toBe('accepted');
    const audit = await ctx.prisma.auditLog.findMany({
      where: { targetId: id, action: { startsWith: 'booking.' } },
      orderBy: { occurredAt: 'asc' },
      select: { action: true },
    });
    expect(audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'booking.schedule_change_detected',
        'booking.schedule_change_accepted',
        'booking.itinerary_updated',
      ]),
    );
    // Accepting again just answers the booking; the itinerary does not move twice.
    const again = await accept(id, change.id, token).expect(200);
    expect(again.body.flight.slices[0].departureUtc).toBe(moved?.departureUtc);
    expect(await sweep(id)).toEqual({ checked: 1, detected: 0, resolved: 0, failed: 0 });
    const after = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    expect(after.body.flight.slices[0].departureUtc).toBe(moved?.departureUtc);
  });

  it('keeps the change open when the airline is down, and lets the traveller retry', async () => {
    const { id, token } = await ticketedFlight();
    mock.scheduleRules.set('LOS-ABV', -45);
    await sweep(id);
    const booking = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    const changeId = booking.body.scheduleChange.id as string;

    mock.failNextChangeAcceptances = 1;
    expect((await accept(id, changeId, token)).status).toBe(503);
    const unchanged = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    expect(unchanged.body.scheduleChange.status).toBe('open');
    expect(unchanged.body.flight.slices[0].departureUtc).toBe(
      booking.body.flight.slices[0].departureUtc,
    );

    const retried = await accept(id, changeId, token).expect(200);
    expect(retried.body.scheduleChange.status).toBe('accepted');
    // Another booking's change is not found from this one.
    const other = await ticketedFlight();
    expect((await accept(other.id, changeId, other.token)).status).toBe(404);
  });

  it('sends a change support must resolve to operations, and follows the airline after', async () => {
    const { id, token } = await ticketedFlight();
    mock.scheduleRules.set('LOS-ABV', 120);
    await sweep(id);
    // Pretend the airline offers no online acceptance for this change.
    const known = [...mock.airlineChanges.values()][0];
    if (!known) throw new Error('no change');
    known.change.acceptable = false;
    ctx.emails.outbox.length = 0;
    await sweep(id);
    expect(ctx.emails.outbox.map((message) => message.to)).toEqual([OPS_EMAIL]);
    const booking = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    expect(booking.body.scheduleChange).toMatchObject({ status: 'open', acceptable: false });
    expect((await accept(id, booking.body.scheduleChange.id as string, token)).status).toBe(409);

    // Support accepts it with the airline: the sweep closes it and moves the booking.
    known.change.actionTaken = 'accepted';
    expect(await sweep(id)).toEqual({ checked: 1, detected: 0, resolved: 1, failed: 0 });
    const resolved = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    expect(resolved.body.scheduleChange.status).toBe('accepted');
    expect(resolved.body.flight.slices[0].departureUtc).toBe(known.slices[0]?.departureUtc);
  });

  it('stops checking flights that are no longer confirmed', async () => {
    const { id, token } = await ticketedFlight();
    const quote = await ctx
      .http()
      .post(`/v1/bookings/${id}/cancellation-quote`)
      .set(token)
      .expect(200);
    await ctx
      .http()
      .post(`/v1/bookings/${id}/cancel`)
      .set(token)
      .send({ refund: quote.body.refund as object })
      .expect(200);
    mock.scheduleRules.set('LOS-ABV', 90);
    expect(await sweep(id)).toEqual({ checked: 0, detected: 0, resolved: 0, failed: 0 });
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId: id } });
    expect(item.nextChangeCheckAt).toBeNull();
    expect(mock.airlineChanges.size).toBe(0);
  });

  describe('refund offer for significant changes (ADR-073)', () => {
    interface WireMoney {
      amountMinor: number;
      currency: string;
    }
    interface Change {
      id: string;
      status: string;
      acceptable: boolean;
      significant: boolean;
      refundOffer: { amount: WireMoney } | null;
    }

    const takeRefund = (
      id: string,
      changeId: string,
      token: Record<string, string>,
      body: object = {},
      key = idempotencyKey(),
    ) =>
      ctx
        .http()
        .post(`/v1/bookings/${id}/schedule-changes/${changeId}/refund`)
        .set(token)
        .set('Idempotency-Key', key)
        .send(body);

    /** A ticketed flight the airline moves by `minutes` on its next check. */
    async function changedFlight(minutes: number, refundable = false) {
      const flight = await ticketedFlight(refundable);
      mock.scheduleRules.set('LOS-ABV', minutes);
      await sweep(flight.id);
      const booking = await ctx
        .http()
        .get(`/v1/bookings/${flight.id}`)
        .set(flight.token)
        .expect(200);
      return {
        ...flight,
        change: booking.body.scheduleChange as Change,
        paid: booking.body.paid as WireMoney,
      };
    }

    it('offers everything back for a significant change, even on a fare that refunds nothing', async () => {
      ctx.emails.outbox.length = 0;
      // Four hours later on a domestic flight: over the three-hour threshold.
      const { id, token, change, paid } = await changedFlight(240);
      expect(paid.amountMinor).toBeGreaterThan(0);
      expect(change).toMatchObject({
        status: 'open',
        acceptable: true,
        significant: true,
        refundOffer: { amount: paid },
      });
      const notice = ctx.emails.outbox.find((message) => message.template === 'schedule-changed');
      expect(notice?.text).toMatch(/significant change, so you can choose/);
      // Online cancellation under the fare's rules would refund nothing.
      const quote = await ctx
        .http()
        .post(`/v1/bookings/${id}/cancellation-quote`)
        .set(token)
        .expect(200);
      expect(quote.body.refund.amountMinor).toBe(0);

      const key = idempotencyKey();
      const taken = await takeRefund(id, change.id, token, { refund: paid }, key).expect(200);
      expect(taken.body).toMatchObject({
        status: 'REFUND_PENDING',
        flightCancellable: false,
        scheduleChange: { id: change.id, status: 'cancelled', refundOffer: null },
        refunds: [expect.objectContaining({ amount: paid })],
      });
      // The airline cancelled first.
      expect(mock.cancelledOrders.size).toBe(1);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'booking.schedule_change_refunded', targetId: id },
      });
      expect(audit.metadata).toMatchObject({
        scheduleChangeId: change.id,
        supplier: 'mock',
        refundMinor: String(paid.amountMinor),
      });
      const refunds = await ctx.prisma.refund.findMany({ where: { bookingId: id } });
      expect(refunds.map((refund) => refund.reason)).toEqual(['supplier_cancellation']);
      const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId: id } });
      expect(item.nextChangeCheckAt).toBeNull();

      // Repeating the request answers the same; nothing is refunded twice.
      const repeat = await takeRefund(id, change.id, token, { refund: paid }, key).expect(200);
      expect(repeat.body.status).toBe('REFUND_PENDING');
      expect(await ctx.prisma.refund.count({ where: { bookingId: id } })).toBe(1);

      await ctx.background.drain();
      await ctx.http().post('/v1/internal/bookings/refunds-due').set(INTERNAL).expect(200);
      await ctx.background.drain();
      const refunded = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
      expect(refunded.body.status).toBe('REFUNDED');
      expect((await takeRefund(id, change.id, token)).status).toBe(409);
    });

    it('leaves small changes to accepting', async () => {
      const { id, token, change } = await changedFlight(90);
      expect(change).toMatchObject({ significant: false, refundOffer: null, acceptable: true });
      const refused = await takeRefund(id, change.id, token);
      expect(refused.status).toBe(409);
      expect(refused.body.type).toMatch(/refund-offer-unavailable$/);
      expect(mock.cancelledOrders.size).toBe(0);
    });

    it('hands the refund to support when the airline would refund less than we paid', async () => {
      const { id, token, change } = await changedFlight(240);
      mock.involuntaryRefundBps = 5_000;
      ctx.emails.outbox.length = 0;
      const refused = await takeRefund(id, change.id, token);
      expect(refused.status).toBe(409);
      expect(refused.body.type).toMatch(/refund-offer-unavailable$/);
      // Nothing was cancelled or refunded, and the offer is withdrawn for support.
      expect(mock.cancelledOrders.size).toBe(0);
      await ctx.background.drain();
      const booking = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
      expect(booking.body).toMatchObject({
        status: 'CONFIRMED',
        scheduleChange: { status: 'open', significant: true, refundOffer: null },
      });
      expect(await ctx.prisma.refund.count({ where: { bookingId: id } })).toBe(0);
      const alert = ctx.emails.outbox.find((message) => message.to === OPS_EMAIL);
      expect(alert?.subject).toMatch(/airline\.refund_offer_blocked/);
      // Accepting the new times still works.
      expect((await accept(id, change.id, token)).status).toBe(200);
    });

    it('keeps the offer when the airline is down, checks the amount, and stays with the booking', async () => {
      const { id, token, change, paid } = await changedFlight(-240);
      expect(change.refundOffer).toEqual({ amount: paid });

      mock.failNextCancellations = 1;
      expect((await takeRefund(id, change.id, token)).status).toBe(503);
      const unchanged = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
      expect(unchanged.body).toMatchObject({
        status: 'CONFIRMED',
        scheduleChange: { status: 'open', refundOffer: { amount: paid } },
      });

      const wrong = await takeRefund(id, change.id, token, {
        refund: { ...paid, amountMinor: paid.amountMinor - 1 },
      });
      expect(wrong.status).toBe(409);
      expect(wrong.body.type).toMatch(/refund-offer-changed$/);

      // Another booking's change is not found from this one.
      const other = await ticketedFlight();
      expect((await takeRefund(other.id, change.id, other.token)).status).toBe(404);

      const taken = await takeRefund(id, change.id, token, { refund: paid }).expect(200);
      expect(taken.body.status).toBe('REFUND_PENDING');
    });
  });
});
