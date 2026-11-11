import { BOOKING_TERMS_VERSION } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';

import { CONTACT, inDays, nextKey, passenger, payInFull, staffSession } from './helpers/cars';
import { bearer, login, signUp, type TokenSession } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const EVIDENCE = 'https://files.suskii.test/evidence/eko-2026-12.pdf';
const SUPPLIER = 'Wholesale Rooms Ltd';
/** NGN 300,000.00: what the supplier charges for all of it. */
const SUPPLIER_PRICE = { amountMinor: 30_000_000, currency: 'NGN' };

interface Money {
  amountMinor: number;
  currency: string;
}
interface Quote {
  id: string;
  reference: string;
  status: string;
  closedReason: string | null;
  indicative: { price: Money; source: string; seenAt: string } | null;
  offer: {
    quoteId: string;
    total: Money;
    details: { title: string; summary: string };
    expiresAt: string;
  } | null;
  bookingId: string | null;
}
interface AdminQuote extends Quote {
  userId: string;
  supplierName: string | null;
  supplierPrice: Money | null;
  evidenceUrl: string | null;
  verifiedBy: string | null;
  booking: {
    id: string;
    status: string;
    waitsToBeBooked: boolean;
    supplierReference: string | null;
    evidenceUrl: string | null;
  } | null;
}
interface Booking {
  id: string;
  status: string;
  vertical: string;
  paid: Money;
  assisted: { kind: string; summary: string; supplierReference: string | null } | null;
  refunds: { amount: Money }[];
}

const request = () => ({
  product: 'hotel',
  title: 'Eko Signature, sea view room',
  request: { destination: 'Lagos', startDate: inDays(30), endDate: inDays(33), adults: 2 },
  currency: 'NGN',
});

const verified = (over: Record<string, unknown> = {}) => ({
  supplierName: SUPPLIER,
  supplierPrice: SUPPLIER_PRICE,
  evidenceUrl: EVIDENCE,
  details: {
    title: 'Eko Signature, sea view room',
    summary: 'Three nights for two with breakfast. Free cancellation until five days before.',
    startDate: inDays(30),
    endDate: inDays(33),
    cityName: 'Lagos',
    countryCode: 'NG',
    refundable: true,
  },
  ...over,
});

/**
 * Assisted quotes (ADR-104): a traveller asks for a price to be confirmed by a person; staff
 * verify it and make an offer; it is booked and paid through the ordinary checkout; and only
 * staff's record of the supplier's confirmation confirms the booking.
 */
describe('assisted quotes (e2e)', () => {
  let ctx: TestContext;
  let ada: TokenSession;
  let bola: TokenSession;
  let ops: { userId: string; headers: Record<string, string> };

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    ada = await signUp(ctx, 'quote-ada@example.com');
    bola = await signUp(ctx, 'quote-bola@example.com');
    ops = await staffSession(ctx, 'quote-ops@suskii.test', ['operations']);
    ctx.emails.outbox.length = 0;
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  const as = (session: TokenSession) => bearer(session.accessToken);
  const ask = (session: TokenSession = ada, body: Record<string, unknown> = request()) =>
    ctx
      .http()
      .post('/v1/quotes/assisted')
      .set(as(session))
      .set('Idempotency-Key', nextKey('e2e-quote'))
      .send(body);
  const mine = async (id: string, session: TokenSession = ada): Promise<Quote> =>
    (await ctx.http().get(`/v1/quotes/assisted/${id}`).set(as(session)).expect(200)).body as Quote;
  const staff = (
    action: 'offer' | 'close' | 'booked' | 'unbookable',
    id: string,
    body: object,
    headers = ops.headers,
  ) => ctx.http().post(`/v1/admin/assisted-quotes/${id}/${action}`).set(headers).send(body);
  const queue = async (which: string): Promise<AdminQuote[]> =>
    (await ctx.http().get(`/v1/admin/assisted-quotes?queue=${which}`).set(ops.headers).expect(200))
      .body.quotes as AdminQuote[];
  const booking = async (id: string, session: TokenSession = ada): Promise<Booking> =>
    (await ctx.http().get(`/v1/bookings/${id}`).set(as(session)).expect(200)).body as Booking;

  /** Ada's request, verified by staff and on offer. */
  async function offered(): Promise<Quote> {
    const asked = (await ask().expect(201)).body as Quote;
    await staff('offer', asked.id, verified()).expect(200);
    return mine(asked.id);
  }

  /** The offer booked through the ordinary checkout, for two travellers. */
  async function booked(quote: Quote, session: TokenSession = ada) {
    return ctx
      .http()
      .post('/v1/bookings')
      .set(as(session))
      .set('Idempotency-Key', nextKey('e2e-quote-book'))
      .send({
        quoteId: quote.offer?.quoteId,
        contact: CONTACT,
        passengers: [passenger('Adaeze', 'Okafor'), passenger('Chidi', 'Okafor')],
        guests: [],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      });
  }

  it('turns a request into an offer, a paid booking, and a confirmation only a person gives', async () => {
    const asked = await ask();
    expect(asked.status).toBe(201);
    const quote = asked.body as Quote;
    expect(quote).toMatchObject({
      status: 'requested',
      closedReason: null,
      indicative: null,
      offer: null,
      bookingId: null,
    });
    expect(quote.reference).toMatch(/^Q-[A-Z0-9]{6}$/);

    // It waits in the queue, oldest first, for someone who may decide it.
    const waiting = await queue('to_verify');
    expect(waiting.map((entry) => entry.id)).toEqual([quote.id]);
    expect(waiting[0]).toMatchObject({ userId: ada.userId, supplierName: null, booking: null });

    const made = await staff('offer', quote.id, verified());
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({
      status: 'offered',
      supplierName: SUPPLIER,
      supplierPrice: SUPPLIER_PRICE,
      evidenceUrl: EVIDENCE,
      verifiedBy: ops.userId,
    });
    expect(await queue('to_verify')).toEqual([]);

    // The traveller is told, and sees the offer: what, when, its terms and one price. Who
    // sells it to Suskii and the proof stay Suskii's own.
    await ctx.background.drain();
    const notice = ctx.emails.outbox.find(
      (message) => message.template === 'assisted-quote-offered',
    );
    expect(notice?.to).toBe('quote-ada@example.com');
    expect(notice?.text).toContain(quote.reference);
    const ready = await mine(quote.id);
    expect(ready).toMatchObject({
      status: 'offered',
      // No fee or tax rule is seeded for the vertical: the traveller pays the verified price.
      offer: { total: SUPPLIER_PRICE, details: { title: 'Eko Signature, sea view room' } },
    });
    expect(JSON.stringify(ready)).not.toMatch(/Wholesale Rooms|files\.suskii\.test/);
    const lasts = Date.parse(ready.offer?.expiresAt ?? '') - Date.now();
    expect(lasts).toBeGreaterThan(115 * 60_000);
    expect(lasts).toBeLessThanOrEqual(120 * 60_000);

    // The offer is an ordinary quote, for its traveller alone.
    const offerId = ready.offer?.quoteId ?? '';
    const read = await ctx.http().get(`/v1/quotes/${offerId}`).set(as(ada)).expect(200);
    expect(read.body).toMatchObject({
      vertical: 'assisted',
      assisted: {
        kind: 'hotel',
        startDate: inDays(30),
        endDate: inDays(33),
        cityName: 'Lagos',
        travellers: { adults: 2, children: 0, infants: 0 },
        refundable: true,
        quoteId: quote.id,
        supplierReference: null,
      },
      price: { total: SUPPLIER_PRICE },
    });
    expect((await ctx.http().get(`/v1/quotes/${offerId}`).set(as(bola))).status).toBe(404);
    expect((await ctx.http().get(`/v1/quotes/${offerId}`)).status).toBe(404);
    expect((await booked(ready, bola)).status).toBe(404);

    // Booked and paid as any booking. Paid is not confirmed: a person still has to book it.
    const created = await booked(ready);
    expect(created.status).toBe(201);
    const bookingId = created.body.booking.id as string;
    expect(created.body.booking).toMatchObject({ vertical: 'assisted', status: 'PRICED' });
    ctx.emails.outbox.length = 0;
    await payInFull(ctx, bookingId, as(ada));
    const paid = await booking(bookingId);
    expect(paid).toMatchObject({
      status: 'TICKETING',
      paid: SUPPLIER_PRICE,
      assisted: { supplierReference: null },
    });
    expect(ctx.emails.outbox.some((message) => message.template === 'booking-confirmed')).toBe(
      false,
    );
    // The ticketing sweep leaves it alone, however often it runs: no attempt is counted.
    await ctx.prisma.booking.update({
      where: { id: bookingId },
      data: { updatedAt: new Date(Date.now() - 3_600_000) },
    });
    await ctx.http().post('/v1/internal/bookings/ticket-due').set(INTERNAL).expect(200);
    await ctx.background.drain();
    expect(await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({
      status: 'TICKETING',
      ticketingAttempts: 0,
    });

    // It waits in the other queue, for someone who may change bookings.
    const toBook = await queue('to_book');
    expect(toBook).toHaveLength(1);
    expect(toBook[0]).toMatchObject({
      id: quote.id,
      status: 'booked',
      booking: { id: bookingId, status: 'TICKETING', waitsToBeBooked: true },
    });
    expect((await mine(quote.id)).bookingId).toBe(bookingId);

    const done = await staff('booked', quote.id, {
      supplierReference: 'EKO-778812',
      evidenceUrl: 'https://files.suskii.test/evidence/eko-confirmation.pdf',
    });
    expect(done.status).toBe(200);
    expect(done.body.booking).toMatchObject({
      status: 'CONFIRMED',
      waitsToBeBooked: false,
      supplierReference: 'EKO-778812',
      evidenceUrl: 'https://files.suskii.test/evidence/eko-confirmation.pdf',
    });
    await ctx.background.drain();
    expect(await booking(bookingId)).toMatchObject({
      status: 'CONFIRMED',
      assisted: { supplierReference: 'EKO-778812' },
    });
    const confirmation = ctx.emails.outbox.find(
      (message) => message.template === 'booking-confirmed',
    );
    expect(confirmation?.text).toContain('Confirmation number: EKO-778812');
    expect(await queue('to_book')).toEqual([]);

    // Once is once, and a booked quote is no longer anyone's to change.
    for (const [action, body] of [
      ['booked', { supplierReference: 'EKO-000001', evidenceUrl: EVIDENCE }],
      ['unbookable', { reason: 'sold_out' }],
      ['offer', verified()],
      ['close', { reason: 'sold_out' }],
    ] as const) {
      expect([action, (await staff(action, quote.id, body)).status]).toEqual([action, 409]);
    }
    expect(await booking(bookingId)).toMatchObject({
      status: 'CONFIRMED',
      assisted: { supplierReference: 'EKO-778812' },
      refunds: [],
    });

    // Who decided what is on record: amounts and ids, no words about a person.
    const audit = await ctx.prisma.auditLog.findMany({
      where: { targetType: 'assisted_quote', targetId: quote.id },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((entry) => [entry.action, entry.actorUserId])).toEqual([
      ['assisted_quote.offered', ops.userId],
      ['assisted_quote.booked', ops.userId],
    ]);
    expect(audit[0]?.metadata).toEqual({
      supplierMinor: '30000000',
      supplierCurrency: 'NGN',
      totalMinor: '30000000',
      currency: 'NGN',
      again: false,
    });
    expect(audit[1]?.metadata).toEqual({ bookingId });
  });

  it('gives everything back when the paid booking cannot be booked', async () => {
    const quote = await offered();
    const created = await booked(quote);
    const bookingId = created.body.booking.id as string;
    await payInFull(ctx, bookingId, as(ada));

    const gone = await staff('unbookable', quote.id, { reason: 'sold_out' });
    expect(gone.status).toBe(200);
    await ctx.background.drain();
    const after = await booking(bookingId);
    expect(['REFUND_PENDING', 'REFUNDED']).toContain(after.status);
    expect(after.refunds).toEqual([expect.objectContaining({ amount: SUPPLIER_PRICE })]);
    expect(after.assisted?.supplierReference).toBeNull();
    // Nothing is left to book or to refund twice.
    expect((await staff('unbookable', quote.id, { reason: 'sold_out' })).status).toBe(409);
    expect(
      (await staff('booked', quote.id, { supplierReference: 'EKO-1', evidenceUrl: EVIDENCE }))
        .status,
    ).toBe(409);
    expect(await queue('to_book')).toEqual([]);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'assisted_quote.unbookable', targetId: quote.id },
    });
    expect(audit.metadata).toEqual({ bookingId, reason: 'sold_out' });
  });

  it('books nothing by hand before the money is in', async () => {
    const quote = await offered();
    const created = await booked(quote);
    const bookingId = created.body.booking.id as string;
    // Booked by the traveller, not paid: nothing for staff to book or refund yet.
    for (const [action, body] of [
      ['booked', { supplierReference: 'EKO-778812', evidenceUrl: EVIDENCE }],
      ['unbookable', { reason: 'price_changed' }],
    ] as const) {
      const response = await staff(action, quote.id, body);
      expect(response.status).toBe(409);
      expect((response.body as { type: string }).type).toContain('assisted-booking-not-waiting');
    }
    expect((await booking(bookingId)).status).toBe('PRICED');
    // A reference that is not one, or proof that is not kept over https, is refused.
    await payInFull(ctx, bookingId, as(ada));
    for (const body of [
      { supplierReference: 'x', evidenceUrl: EVIDENCE },
      { supplierReference: 'EKO-778812', evidenceUrl: 'http://files.suskii.test/proof.pdf' },
      { supplierReference: 'EKO-778812' },
    ]) {
      expect((await staff('booked', quote.id, body)).status).toBe(400);
    }
    expect((await booking(bookingId)).status).toBe('TICKETING');
  });

  it("is its traveller's alone, and decided only by staff who may", async () => {
    const quote = (await ask().expect(201)).body as Quote;

    // Someone else: it does not exist. Nobody signed in: sign in first.
    expect((await ctx.http().get(`/v1/quotes/assisted/${quote.id}`).set(as(bola))).status).toBe(
      404,
    );
    expect(
      (await ctx.http().post(`/v1/quotes/assisted/${quote.id}/withdraw`).set(as(bola))).status,
    ).toBe(404);
    expect((await ctx.http().get(`/v1/quotes/assisted/${quote.id}`)).status).toBe(401);
    expect((await ctx.http().post('/v1/quotes/assisted').send(request())).status).toBe(401);
    const theirs = await ctx.http().get('/v1/me/assisted-quotes').set(as(bola)).expect(200);
    expect(theirs.body).toEqual({ quotes: [] });

    // A traveller is not staff; support reads the queue and decides in it, but changes no
    // booking; content managers see none of it.
    expect((await staff('offer', quote.id, verified(), as(ada))).status).toBe(403);
    const support = await staffSession(ctx, 'quote-support@suskii.test', ['support']);
    const content = await staffSession(ctx, 'quote-content@suskii.test', ['content_manager']);
    expect((await ctx.http().get('/v1/admin/assisted-quotes').set(content.headers)).status).toBe(
      403,
    );
    expect((await staff('offer', quote.id, verified(), content.headers)).status).toBe(403);
    expect(
      (
        await staff(
          'booked',
          quote.id,
          { supplierReference: 'EKO-778812', evidenceUrl: EVIDENCE },
          support.headers,
        )
      ).status,
    ).toBe(403);
    expect((await staff('offer', quote.id, verified(), support.headers)).status).toBe(200);

    // The traveller withdraws: staff can no longer answer it.
    const withdrawn = await ctx
      .http()
      .post(`/v1/quotes/assisted/${quote.id}/withdraw`)
      .set(as(ada))
      .expect(200);
    expect(withdrawn.body).toMatchObject({ status: 'withdrawn', offer: null });
    expect((await staff('offer', quote.id, verified())).status).toBe(409);
    expect((await staff('close', quote.id, { reason: 'sold_out' })).status).toBe(409);
    expect(
      (await ctx.http().post(`/v1/quotes/assisted/${quote.id}/withdraw`).set(as(ada))).status,
    ).toBe(409);
  });

  it('holds places, dates and head counts, never who travels, and a few at a time', async () => {
    for (const body of [
      { ...request(), title: 'Room for ada@example.com' },
      { ...request(), title: 'Call +234 801 234 5678 about the room' },
      { ...request(), request: { ...request().request, destination: 'see www.example.com' } },
      { ...request(), request: { ...request().request, endDate: inDays(20) } },
      { ...request(), request: { ...request().request, adults: 0 } },
      { ...request(), currency: 'XXX' },
      { ...request(), product: 'yacht' },
    ]) {
      expect((await ask(ada, body)).status).toBe(400);
    }
    expect(await ctx.prisma.assistedQuote.count()).toBe(0);

    for (let made = 0; made < 5; made += 1) expect((await ask()).status).toBe(201);
    const sixth = await ask();
    expect(sixth.status).toBe(409);
    expect((sixth.body as { type: string }).type).toContain('assisted-quote-limit');
    // Someone else's requests are their own count.
    expect((await ask(bola)).status).toBe(201);
    const list = await ctx.http().get('/v1/me/assisted-quotes').set(as(ada)).expect(200);
    expect((list.body.quotes as Quote[]).map((entry) => entry.status)).toEqual(
      Array.from({ length: 5 }, () => 'requested'),
    );
  });

  it('closes a request staff cannot fill, and what nobody answered or booked in time', async () => {
    const first = (await ask().expect(201)).body as Quote;
    const closed = await staff('close', first.id, { reason: 'sold_out' });
    expect(closed.status).toBe(200);
    expect(await mine(first.id)).toMatchObject({
      status: 'unavailable',
      closedReason: 'sold_out',
      offer: null,
    });
    await ctx.background.drain();
    expect(
      ctx.emails.outbox.some((message) => message.template === 'assisted-quote-unavailable'),
    ).toBe(true);
    expect((await staff('close', first.id, { reason: 'made_up' })).status).toBe(400);

    // Nobody answered in time.
    const second = (await ask().expect(201)).body as Quote;
    await ctx.prisma.assistedQuote.update({
      where: { id: second.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await mine(second.id)).toMatchObject({ status: 'expired', closedReason: 'unanswered' });

    // The offer lapsed before the traveller booked: it sells nothing, until verified again.
    const third = await offered();
    await ctx.prisma.assistedQuote.update({
      where: { id: third.id },
      data: { offerExpiresAt: new Date(Date.now() - 1000) },
    });
    await ctx.prisma.offer.update({
      where: { id: third.offer?.quoteId ?? '' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await mine(third.id)).toMatchObject({
      status: 'expired',
      closedReason: 'offer_lapsed',
      offer: null,
    });
    expect((await booked(third)).status).toBe(410);
    const again = await staff(
      'offer',
      third.id,
      verified({ supplierPrice: { amountMinor: 32_000_000, currency: 'NGN' } }),
    );
    expect(again.status).toBe(200);
    const fresh = await mine(third.id);
    expect(fresh).toMatchObject({
      status: 'offered',
      closedReason: null,
      offer: { total: { amountMinor: 32_000_000, currency: 'NGN' } },
    });
    expect(fresh.offer?.quoteId).not.toBe(third.offer?.quoteId);
    expect((await booked(fresh)).status).toBe(201);
  });

  it('keeps an indicative price as a reference, never as the price of the offer', async () => {
    const source = await ctx.prisma.priceSource.create({
      data: {
        domain: 'rooms.example',
        name: 'Rooms Example',
        products: ['hotel'],
        country: 'NG',
        currency: 'NGN',
        locale: 'en-NG',
        urlTemplates: {},
        recipes: {},
        vendorSettings: {},
      },
    });
    const observe = (status: 'verified' | 'rejected') =>
      ctx.prisma.priceObservation.create({
        data: {
          sourceId: source.id,
          product: 'hotel',
          canonicalKey: 'hotel:lagos',
          itemKey: `eko-${status}`,
          country: 'NG',
          currency: 'NGN',
          amountMinor: 27_500_000n,
          item: { name: 'Eko Signature' },
          vendor: 'mock',
          proxyClass: 'none',
          method: 'recipe',
          parserVersion: 'v1',
          confidence: 80,
          status,
          snapshotHash: 'a'.repeat(64),
          observedAt: new Date('2026-11-10T08:00:00Z'),
          freshUntil: new Date(Date.now() + 3_600_000),
        },
      });
    const seen = await observe('verified');
    const rejected = await observe('rejected');

    // A price that was thrown out is a reference for nothing.
    const refused = await ask(ada, { ...request(), observationId: rejected.id });
    expect(refused.status).toBe(422);
    expect(
      (await ask(ada, { ...request(), observationId: '0193a000-0000-7000-8000-00000000dead' }))
        .status,
    ).toBe(422);

    const quote = (await ask(ada, { ...request(), observationId: seen.id }).expect(201))
      .body as Quote;
    expect(quote.indicative).toEqual({
      price: { amountMinor: 27_500_000, currency: 'NGN' },
      source: 'Rooms Example',
      seenAt: '2026-11-10T08:00:00.000Z',
    });
    // The supplier's live price is higher than what the page showed: the offer is the live one.
    await staff('offer', quote.id, verified()).expect(200);
    expect(await mine(quote.id)).toMatchObject({
      indicative: { price: { amountMinor: 27_500_000 } },
      offer: { total: SUPPLIER_PRICE },
    });
  });

  it('adds the fee of its own vertical to the verified price, never less', async () => {
    await ctx.prisma.feeRule.create({
      data: {
        code: 'assisted_quote',
        label: 'Quote service fee',
        vertical: 'assisted',
        type: 'fixed',
        value: 500_000n,
        currency: 'NGN',
      },
    });
    // A rule of another vertical does not reach it.
    await ctx.prisma.feeRule.create({
      data: {
        code: 'service_fee',
        label: 'Service fee',
        vertical: 'hotels',
        type: 'fixed',
        value: 900_000n,
        currency: 'NGN',
      },
    });
    ctx.app.get(PricingService).invalidate();
    const quote = await offered();
    expect(quote.offer?.total).toEqual({ amountMinor: 30_500_000, currency: 'NGN' });
    const read = await ctx
      .http()
      .get(`/v1/quotes/${quote.offer?.quoteId ?? ''}`)
      .set(as(ada))
      .expect(200);
    expect(read.body.price).toMatchObject({
      total: { amountMinor: 30_500_000, currency: 'NGN' },
      fees: [expect.objectContaining({ code: 'assisted_quote' })],
    });
  });

  it('stops requests, offers and payments while switched off, and still lets staff finish what was paid', async () => {
    // While it is on: a request that waits, an offer booked but not paid, and a paid booking.
    const waiting = (await ask().expect(201)).body as Quote;
    const unpaid = await offered();
    const unpaidBooking = (await booked(unpaid)).body.booking.id as string;
    const paid = await offered();
    const paidBooking = (await booked(paid)).body.booking.id as string;
    await payInFull(ctx, paidBooking, as(ada));

    const off = await createTestApp({ RATE_LIMIT_ENABLED: false, ASSISTED_QUOTES_ENABLED: false });
    try {
      // Another instance signs with its own keys: the same people sign in to it again.
      const adaOff = bearer((await login(off, 'quote-ada@example.com')).accessToken);
      const opsOff = (await staffSession(off, 'quote-ops-off@suskii.test', ['operations'])).headers;
      // For a traveller the routes are gone.
      expect(
        (
          await off
            .http()
            .post('/v1/quotes/assisted')
            .set(adaOff)
            .set('Idempotency-Key', nextKey('e2e-quote-off'))
            .send(request())
        ).status,
      ).toBe(404);
      expect((await off.http().get('/v1/me/assisted-quotes').set(adaOff)).status).toBe(404);
      expect((await off.http().get(`/v1/quotes/assisted/${paid.id}`).set(adaOff)).status).toBe(404);
      // Nothing new is sold: no offer is made, and an offer made before cannot be paid for.
      expect(
        (
          await off
            .http()
            .post(`/v1/admin/assisted-quotes/${waiting.id}/offer`)
            .set(opsOff)
            .send(verified())
        ).status,
      ).toBe(404);
      const pay = await off
        .http()
        .post(`/v1/bookings/${unpaidBooking}/payments`)
        .set(adaOff)
        .set('Idempotency-Key', nextKey('e2e-quote-off-pay'))
        .send({});
      expect(pay.status).toBeGreaterThanOrEqual(400);
      expect(pay.status).toBeLessThan(500);
      expect(await ctx.prisma.payment.count({ where: { bookingId: unpaidBooking } })).toBe(0);

      // What a traveller already paid for is still finished by a person.
      const toBook = await off
        .http()
        .get('/v1/admin/assisted-quotes?queue=to_book')
        .set(opsOff)
        .expect(200);
      expect((toBook.body.quotes as AdminQuote[]).map((quote) => quote.id)).toEqual([paid.id]);
      await off
        .http()
        .post(`/v1/admin/assisted-quotes/${paid.id}/booked`)
        .set(opsOff)
        .send({ supplierReference: 'EKO-77', evidenceUrl: EVIDENCE })
        .expect(200);
      await off.background.drain();
      expect((await booking(paidBooking)).status).toBe('CONFIRMED');
      // And a request that waits can still be closed, so nobody waits for nothing.
      await off
        .http()
        .post(`/v1/admin/assisted-quotes/${waiting.id}/close`)
        .set(opsOff)
        .send({ reason: 'not_sold_by_suskii' })
        .expect(200);
    } finally {
      await off.background.drain();
      await off.close();
    }
  });
});
