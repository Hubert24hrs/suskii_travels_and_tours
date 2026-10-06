import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { MockPaymentProvider } from '../src/payments/mock-payment-provider';
import { PricingService } from '../src/pricing/pricing.service';
import { MockFlightSupplier } from '../src/suppliers/mock/mock-flight-supplier';
import { MockHotelSupplier } from '../src/suppliers/mock/mock-hotel-supplier';

import { bearer, signUp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };

let keySequence = 0;
const idempotencyKey = (): string => `e2e-booking-${Date.now()}-${(keySequence += 1)}`;

const contact = { email: 'Chioma@Example.com', phone: '+2348012345678' };
const adult = (extra: Record<string, unknown> = {}) => ({
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames: 'Adébáyọ̀  Chioma',
  surname: 'Okafor',
  dateOfBirth: '1990-04-01',
  nationality: 'NG',
  ...extra,
});
const passport = (number = 'B1234567', expiryDate = addDays(today, 3650)) => ({
  number,
  issuingCountry: 'NG',
  expiryDate,
});

interface Money {
  amountMinor: number;
  currency: string;
}

describe('bookings (e2e): checkout, payments, ticketing and documents', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    const flights = ctx.app.get(MockFlightSupplier);
    flights.repriceDriftBps = 0;
    flights.failNextBookings = 0;
    ctx.app.get(MockHotelSupplier).failNextBookings = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  interface FlightQuote {
    quoteId: string;
    offer: { services: { id: string }[]; price: { total: Money } };
  }

  async function flightQuote(
    slices: { origin: string; destination: string; departureDate: string }[],
    passengers = { adults: 1, children: 0, infants: 0 },
  ): Promise<FlightQuote> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({ slices, passengers, cabinClass: 'economy' })
      .expect(200);
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .expect(201);
    return quote.body as FlightQuote;
  }

  const domestic = () =>
    flightQuote([{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }]);

  function createBooking(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .set(headers)
      .send({
        contact,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        ...body,
      });
  }

  function startPayment(bookingId: string, headers: Record<string, string>) {
    return ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(headers);
  }

  async function payWithMock(checkoutUrl: string, outcome: 'succeeded' | 'failed' = 'succeeded') {
    const reference = checkoutUrl.split('/').pop() ?? '';
    const response = await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome })
      .expect(200);
    await ctx.background.drain();
    return response.body as { status: string; returnUrl: string };
  }

  async function guestBooking(): Promise<{
    id: string;
    token: Record<string, string>;
    total: Money;
  }> {
    const quote = await domestic();
    const created = await createBooking({ quoteId: quote.quoteId, passengers: [adult()] }).expect(
      201,
    );
    return {
      id: created.body.booking.id,
      token: { 'X-Booking-Token': created.body.accessToken as string },
      total: created.body.booking.price.total,
    };
  }

  describe('guest flight booking', () => {
    it('goes from quote to a confirmed, ticketed booking with an e-ticket and email', async () => {
      const quote = await domestic();
      const checkout = await ctx.http().get(`/v1/quotes/${quote.quoteId}`).expect(200);
      expect(checkout.body).toMatchObject({
        vertical: 'flights',
        termsVersion: BOOKING_TERMS_VERSION,
        hotel: null,
      });
      expect(checkout.body.flight.request.slices[0]).toMatchObject({ origin: 'LOS' });

      const created = await createBooking({ quoteId: quote.quoteId, passengers: [adult()] }).expect(
        201,
      );
      const { booking, accessToken } = created.body;
      expect(accessToken).toEqual(expect.any(String));
      expect(booking).toMatchObject({
        status: 'PRICED',
        vertical: 'flights',
        contact: { email: 'c***@example.com', phone: '+234*******678' },
        passengers: [
          { position: 0, type: 'adult', givenNames: 'ADEBAYO CHIOMA', surname: 'OKAFOR' },
        ],
        payment: null,
        documents: [],
      });
      expect(booking.reference).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(booking.price.total).toEqual(quote.offer.price.total);

      // Without the token (or with a wrong one) the booking does not exist.
      await ctx
        .http()
        .get(`/v1/bookings/${booking.id as string}`)
        .expect(404);
      await ctx
        .http()
        .get(`/v1/bookings/${booking.id as string}`)
        .set('X-Booking-Token', 'not-the-token')
        .expect(404);
      const token = { 'X-Booking-Token': accessToken as string };
      await ctx
        .http()
        .get(`/v1/bookings/${booking.id as string}`)
        .set(token)
        .expect(200);

      const payment = await startPayment(booking.id, token).expect(201);
      expect(payment.body.amount).toEqual(booking.price.total);
      expect(payment.body.checkoutUrl).toMatch(/\/checkout\/mock-payment\/mockpay_/);
      const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
      const mockPage = await ctx.http().get(`/v1/payments/mock/${reference}`).expect(200);
      expect(mockPage.body).toMatchObject({
        bookingReference: booking.reference,
        status: 'pending',
        amount: booking.price.total,
      });
      const awaiting = await ctx
        .http()
        .get(`/v1/bookings/${booking.id as string}`)
        .set(token);
      expect(awaiting.body).toMatchObject({
        status: 'AWAITING_PAYMENT',
        payment: { status: 'pending' },
      });

      const result = await payWithMock(payment.body.checkoutUrl);
      expect(result).toEqual({
        status: 'succeeded',
        returnUrl: `https://web.suskii.test/bookings/${booking.id as string}`,
      });

      const confirmed = await ctx
        .http()
        .get(`/v1/bookings/${booking.id as string}`)
        .set(token);
      expect(confirmed.body).toMatchObject({
        status: 'CONFIRMED',
        payment: { status: 'succeeded', checkoutUrl: null },
        documents: [
          { type: 'e_ticket', fileName: `Suskii-e-ticket-${booking.reference as string}.pdf` },
        ],
      });
      expect(confirmed.body.flight.airlineReference).toMatch(/^[A-Z]{6}$/);
      expect(confirmed.body.passengers[0].ticketNumber).toMatch(/^\d{13}$/);

      const history = await ctx.prisma.bookingStatusHistory.findMany({
        where: { bookingId: booking.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(history.map((row) => row.toStatus)).toEqual([
        'DRAFT',
        'PRICED',
        'AWAITING_PAYMENT',
        'PAID',
        'TICKETING',
        'CONFIRMED',
      ]);
      expect(history.find((row) => row.toStatus === 'PAID')?.actorType).toBe('webhook');

      const pdf = await ctx
        .http()
        .get(
          `/v1/bookings/${booking.id as string}/documents/${confirmed.body.documents[0].id as string}`,
        )
        .set(token)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-disposition']).toContain('attachment;');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await ctx
        .http()
        .get(
          `/v1/bookings/${booking.id as string}/documents/${confirmed.body.documents[0].id as string}`,
        )
        .expect(404);

      const email = ctx.emails.outbox.find((message) => message.template === 'booking-confirmed');
      expect(email).toMatchObject({ to: 'chioma@example.com' });
      expect(email?.text).toContain(booking.reference);
      expect(email?.text).not.toContain('/bookings/');
      expect(email?.attachments?.[0]).toMatchObject({ contentType: 'application/pdf' });

      // Stored data: contact and passport never in plain text.
      const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(row.contactEncrypted).not.toContain('example.com');
      expect(row.accessTokenHash).not.toBe(accessToken);
    });

    it('requires a bot check, current terms and a live quote', async () => {
      const quote = await domestic();
      const base = { quoteId: quote.quoteId, passengers: [adult()] };
      const noToken = await createBooking({ ...base, turnstileToken: null }).expect(400);
      expect(noToken.body.type).toBe('urn:suskii:problem:bot-check-failed');
      await createBooking({ ...base, turnstileToken: 'fail' }).expect(400);
      const terms = await createBooking({ ...base, termsVersion: '2020-01-01' }).expect(409);
      expect(terms.body.type).toBe('urn:suskii:problem:terms-outdated');
      await createBooking({ ...base, acceptTerms: false }).expect(400);

      await ctx.prisma.offer.update({
        where: { id: quote.quoteId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await createBooking(base).expect(410);
      expect(expired.body).toMatchObject({
        type: 'urn:suskii:problem:offer-unavailable',
        request: { slices: [{ origin: 'LOS', destination: 'ABV' }] },
      });
      await ctx.http().get(`/v1/quotes/${quote.quoteId}`).expect(410);
    });

    it('replays an idempotent create without storing the access token in clear', async () => {
      const quote = await domestic();
      const key = idempotencyKey();
      const body = {
        quoteId: quote.quoteId,
        passengers: [adult()],
        contact,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      };
      const first = await ctx
        .http()
        .post('/v1/bookings')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      const replay = await ctx
        .http()
        .post('/v1/bookings')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await ctx.prisma.booking.count()).toBe(1);
      const stored = await ctx.prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
      expect(JSON.stringify(stored.responseBody)).not.toContain(first.body.accessToken as string);
      await ctx.http().post('/v1/bookings').send(body).expect(400);
    });

    it('cancels an unpaid booking once', async () => {
      const { id, token } = await guestBooking();
      const cancelled = await ctx.http().post(`/v1/bookings/${id}/cancel`).set(token).expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      await ctx.http().post(`/v1/bookings/${id}/cancel`).set(token).expect(409);
      await startPayment(id, token).expect(409);
    });
  });

  describe('travellers and extras', () => {
    const international = () =>
      flightQuote(
        [
          { origin: 'LOS', destination: 'LHR', departureDate: inDays(40) },
          { origin: 'LHR', destination: 'LOS', departureDate: inDays(50) },
        ],
        { adults: 1, children: 0, infants: 1 },
      );
    const infantBirth = addDays(today, -300);

    it('checks passports, ages and counts against the itinerary', async () => {
      const quote = await international();
      const infant = {
        ...adult({ type: 'infant', title: 'miss', givenNames: 'Ada', dateOfBirth: infantBirth }),
      };
      const missing = await createBooking({
        quoteId: quote.quoteId,
        passengers: [adult(), infant],
      }).expect(422);
      expect(missing.body.type).toBe('urn:suskii:problem:passengers-invalid');
      expect(missing.body.issues).toEqual(
        expect.arrayContaining([
          { index: 0, path: ['document'], code: 'passport_required' },
          { index: 1, path: ['document'], code: 'passport_required' },
        ]),
      );

      const tooOld = await createBooking({
        quoteId: quote.quoteId,
        passengers: [
          adult({ document: passport() }),
          { ...infant, dateOfBirth: addDays(today, -365 * 3), document: passport('C7654321') },
        ],
      }).expect(422);
      expect(tooOld.body.issues).toContainEqual({
        index: 1,
        path: ['dateOfBirth'],
        code: 'passenger_type_mismatch',
      });

      const count = await createBooking({
        quoteId: quote.quoteId,
        passengers: [adult({ document: passport() })],
      }).expect(422);
      expect(count.body.issues).toContainEqual({
        index: null,
        path: [],
        code: 'passenger_count_mismatch',
      });
    });

    it('prices extra bags, orders passengers for the supplier and warns about passports', async () => {
      const quote = await international();
      const bag = quote.offer.services[0];
      if (!bag) throw new Error('the mock sells bags on international offers');
      const soon = addDays(inDays(50), 60); // valid for the trip, but inside six months
      const created = await createBooking({
        quoteId: quote.quoteId,
        passengers: [
          adult({
            type: 'infant',
            title: 'miss',
            givenNames: 'Ada',
            dateOfBirth: infantBirth,
            document: passport('C7654321'),
          }),
          adult({ document: passport('b 123-4567', soon) }),
        ],
        extras: [{ serviceId: bag.id, passengerIndex: 1, quantity: 2 }],
      }).expect(201);
      const { booking } = created.body;
      expect(booking.passengers.map((p: { type: string }) => p.type)).toEqual(['adult', 'infant']);
      expect(booking.passengers[0]).toMatchObject({
        extraBags: 2,
        document: { hint: '567', issuingCountry: 'NG', expiryDate: soon },
      });
      expect(booking.warnings).toEqual([
        { index: 0, path: ['document', 'expiryDate'], code: 'passport_expires_soon' },
      ]);
      const [extra] = booking.price.extras;
      expect(extra).toMatchObject({ serviceId: bag.id, quantity: 2, weightKg: 23 });
      expect(extra.amount.amountMinor).toBe(extra.unitPrice.amountMinor * 2);
      expect(booking.price.total.amountMinor).toBe(
        quote.offer.price.total.amountMinor + (extra.amount.amountMinor as number),
      );

      // Bags cannot go to lap infants, and quantities are capped.
      await createBooking({
        quoteId: quote.quoteId,
        passengers: [
          adult({ document: passport() }),
          adult({
            type: 'infant',
            title: 'miss',
            dateOfBirth: infantBirth,
            document: passport('C7654321'),
          }),
        ],
        extras: [{ serviceId: bag.id, passengerIndex: 1, quantity: 1 }],
      }).expect(422);

      const stored = await ctx.prisma.bookingPassenger.findMany({
        where: { bookingId: booking.id },
      });
      for (const row of stored) {
        expect(row.passportEncrypted).not.toContain('1234567');
        expect(row.passportEncrypted).toMatch(/^v2\.k1\./);
      }
    });

    it('lets account holders keep travellers and book with their stored passport', async () => {
      const session = await signUp(ctx, 'traveller@example.com');
      const auth = bearer(session.accessToken);
      const saved = await ctx
        .http()
        .post('/v1/me/travellers')
        .set(auth)
        .send({ ...adult(), document: passport('A99887766') })
        .expect(201);
      expect(saved.body).toMatchObject({
        givenNames: 'ADEBAYO CHIOMA',
        document: { hint: '766', issuingCountry: 'NG' },
      });
      expect(JSON.stringify(saved.body)).not.toContain('A99887766');

      // Updating without a number keeps the stored passport.
      const updated = await ctx
        .http()
        .put(`/v1/me/travellers/${saved.body.id as string}`)
        .set(auth)
        .send({
          ...adult({ surname: 'Okafor-Eze' }),
          document: { issuingCountry: 'NG', expiryDate: addDays(today, 3000) },
        })
        .expect(200);
      expect(updated.body).toMatchObject({ surname: 'OKAFOR-EZE', document: { hint: '766' } });

      const other = await signUp(ctx, 'someone-else@example.com');
      await ctx
        .http()
        .put(`/v1/me/travellers/${saved.body.id as string}`)
        .set(bearer(other.accessToken))
        .send(adult())
        .expect(404);
      await ctx.http().get('/v1/me/travellers').expect(401);

      const quote = await flightQuote([
        { origin: 'LOS', destination: 'LHR', departureDate: inDays(40) },
      ]);
      const created = await createBooking(
        {
          quoteId: quote.quoteId,
          turnstileToken: null,
          passengers: [{ ...adult(), travellerId: saved.body.id }],
        },
        auth,
      ).expect(201);
      expect(created.body.accessToken).toBeNull();
      expect(created.body.booking.passengers[0].document).toMatchObject({ hint: '766' });

      const id = created.body.booking.id as string;
      await ctx.http().get(`/v1/bookings/${id}`).set(auth).expect(200);
      await ctx.http().get(`/v1/bookings/${id}`).set(bearer(other.accessToken)).expect(404);

      // Another user's traveller id is not usable.
      const stolen = await createBooking(
        {
          quoteId: quote.quoteId,
          turnstileToken: null,
          passengers: [{ ...adult(), travellerId: saved.body.id }],
        },
        bearer(other.accessToken),
      ).expect(422);
      expect(stolen.body.issues).toEqual([
        { index: 0, path: ['travellerId'], code: 'traveller_not_found' },
      ]);

      await ctx
        .http()
        .delete(`/v1/me/travellers/${saved.body.id as string}`)
        .set(auth)
        .expect(204);
      const list = await ctx.http().get('/v1/me/travellers').set(auth).expect(200);
      expect(list.body.travellers).toEqual([]);
    });
  });

  describe('price re-check before payment', () => {
    it('asks for consent when the price moved, then takes payment at the new price', async () => {
      const { id, token, total } = await guestBooking();
      ctx.app.get(MockFlightSupplier).repriceDriftBps = 500; // the fare rose 5%

      const changed = await startPayment(id, token).expect(409);
      expect(changed.body.type).toBe('urn:suskii:problem:price-changed');
      const change = changed.body.priceChange;
      expect(change.previous).toEqual(total);
      expect(change.current.amountMinor).toBeGreaterThan(total.amountMinor);
      expect(change.difference.amountMinor).toBe(change.current.amountMinor - total.amountMinor);

      ctx.app.get(MockFlightSupplier).repriceDriftBps = 0;
      const pending = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
      expect(pending.body).toMatchObject({
        status: 'PRICED',
        price: { total },
        pendingPriceChange: { current: change.current },
      });
      // No payment until the traveller agrees.
      await startPayment(id, token).expect(409);
      const stale = await ctx
        .http()
        .post(`/v1/bookings/${id}/price-consent`)
        .set(token)
        .send({ total })
        .expect(409);
      expect(stale.body.type).toBe('urn:suskii:problem:price-consent-mismatch');

      const consented = await ctx
        .http()
        .post(`/v1/bookings/${id}/price-consent`)
        .set(token)
        .send({ total: change.current })
        .expect(200);
      expect(consented.body).toMatchObject({
        pendingPriceChange: null,
        price: { total: change.current },
      });
      // Consenting twice is harmless.
      await ctx
        .http()
        .post(`/v1/bookings/${id}/price-consent`)
        .set(token)
        .send({ total: change.current })
        .expect(200);

      const payment = await startPayment(id, token).expect(201);
      expect(payment.body.amount).toEqual(change.current);
      await payWithMock(payment.body.checkoutUrl);
      const confirmed = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(confirmed.body.status).toBe('CONFIRMED');
      const audit = await ctx.prisma.auditLog.findMany({
        where: {
          targetId: id,
          action: { in: ['booking.price_changed', 'booking.price_consented'] },
        },
      });
      expect(audit.map((entry) => entry.action).sort()).toEqual([
        'booking.price_changed',
        'booking.price_consented',
      ]);
    });

    it('fails the booking and sends the traveller back to search when the offer sold out', async () => {
      const { id, token } = await guestBooking();
      const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId: id } });
      const payload = item.payload as { offer: { expiresAt: string } };
      payload.offer.expiresAt = new Date(Date.now() - 1000).toISOString();
      await ctx.prisma.bookingItem.update({ where: { id: item.id }, data: { payload } });
      const gone = await startPayment(id, token).expect(410);
      expect(gone.body).toMatchObject({
        type: 'urn:suskii:problem:offer-unavailable',
        request: { slices: [{ origin: 'LOS', destination: 'ABV' }] },
      });
      const failed = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(failed.body.status).toBe('FAILED');
    });
  });

  describe('payment webhooks', () => {
    async function awaitingPayment() {
      const booking = await guestBooking();
      const payment = await startPayment(booking.id, booking.token).expect(201);
      const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
      return { ...booking, reference, checkoutUrl: payment.body.checkoutUrl as string };
    }

    const post = (body: Buffer, headers: Record<string, string | string[] | undefined>) =>
      ctx
        .http()
        .post('/v1/payments/webhooks/mock')
        .set('Content-Type', 'application/json')
        .set(headers as Record<string, string>)
        .send(body.toString('utf8'));

    it('rejects bad signatures and unknown providers', async () => {
      const { reference, total } = await awaitingPayment();
      const mock = ctx.app.get(MockPaymentProvider);
      const { rawBody, headers } = mock.signedEvent(reference, 'succeeded', {
        minor: BigInt(total.amountMinor),
        currency: total.currency,
      });
      const tampered = Buffer.from(rawBody.toString('utf8').replace(reference, `${reference}x`));
      const rejected = await post(tampered, headers).expect(400);
      expect(rejected.body.type).toBe('urn:suskii:problem:invalid-webhook');
      await post(rawBody, {}).expect(400);
      await ctx.http().post('/v1/payments/webhooks/stripe').send({}).expect(404);
      expect(await ctx.prisma.webhookEvent.count()).toBe(0);
    });

    it('applies an event once and ignores duplicates', async () => {
      const { id, token, reference, total } = await awaitingPayment();
      const mock = ctx.app.get(MockPaymentProvider);
      const event = mock.signedEvent(reference, 'succeeded', {
        minor: BigInt(total.amountMinor),
        currency: total.currency,
      });
      await post(event.rawBody, event.headers).expect(200);
      await post(event.rawBody, event.headers).expect(200);
      await ctx.background.drain();
      expect(await ctx.prisma.webhookEvent.count()).toBe(1);
      const booking = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(booking.body.status).toBe('CONFIRMED');
      expect(
        await ctx.prisma.bookingStatusHistory.count({ where: { bookingId: id, toStatus: 'PAID' } }),
      ).toBe(1);
    });

    it('never applies a success for the wrong amount and refunds money it cannot take', async () => {
      const { id, token, reference, total } = await awaitingPayment();
      const mock = ctx.app.get(MockPaymentProvider);
      const short = mock.signedEvent(reference, 'succeeded', {
        minor: BigInt(total.amountMinor - 100),
        currency: total.currency,
      });
      await post(short.rawBody, short.headers).expect(200);
      await ctx.background.drain();
      const payment = await ctx.prisma.payment.findUniqueOrThrow({
        where: { providerReference: reference },
      });
      // The provider did take money: recorded, never applied, and given back automatically.
      expect(payment).toMatchObject({
        status: 'succeeded',
        requiresRefund: true,
        failureReason: 'amount_mismatch',
      });
      const refunds = await ctx.prisma.refund.findMany({ where: { paymentId: payment.id } });
      expect(refunds).toEqual([
        expect.objectContaining({
          amountMinor: BigInt(total.amountMinor - 100),
          reason: 'amount_mismatch',
          source: 'unapplied',
          automatic: true,
          status: 'succeeded',
        }),
      ]);
      const still = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(still.body).toMatchObject({ status: 'AWAITING_PAYMENT', paid: { amountMinor: 0 } });

      // The traveller pays again with a new checkout.
      const again = await startPayment(id, token).expect(201);
      await payWithMock(again.body.checkoutUrl as string);
      const confirmed = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(confirmed.status).toBe('CONFIRMED');

      // A second successful session for a booking that is already paid: refunded as a duplicate.
      const extraPayment = await ctx.prisma.payment.create({
        data: {
          bookingId: id,
          provider: 'mock',
          providerReference: 'mockpay_second_session_0001',
          amountMinor: BigInt(total.amountMinor),
          currency: total.currency,
          checkoutUrl: 'https://web.suskii.test/checkout/mock-payment/mockpay_second_session_0001',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const second = mock.signedEvent(extraPayment.providerReference, 'succeeded', {
        minor: BigInt(total.amountMinor),
        currency: total.currency,
      });
      await post(second.rawBody, second.headers).expect(200);
      await ctx.background.drain();
      const flagged = await ctx.prisma.payment.findUniqueOrThrow({
        where: { id: extraPayment.id },
      });
      expect(flagged).toMatchObject({ status: 'succeeded', requiresRefund: true });
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'payment.requires_refund', targetId: extraPayment.id },
        }),
      ).toBe(1);
      expect(
        await ctx.prisma.refund.findFirstOrThrow({ where: { paymentId: extraPayment.id } }),
      ).toMatchObject({ reason: 'duplicate_payment', status: 'succeeded' });
      // Nothing is left in the unapplied pool, and the confirmed booking keeps exactly its total.
      const unapplied = await ctx.prisma.ledgerAccount.findUnique({
        where: { code: `unapplied:${total.currency}` },
      });
      expect(unapplied?.balanceMinor).toBe(0n);
      const after = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(after.body.paid).toEqual(total);
    });

    it('returns a declined booking to PRICED so the traveller can pay again', async () => {
      const { id, token, checkoutUrl } = await awaitingPayment();
      const declined = await payWithMock(checkoutUrl, 'failed');
      expect(declined.status).toBe('failed');
      const booking = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(booking.body).toMatchObject({ status: 'PRICED', payment: { status: 'failed' } });
      // The closed session cannot be completed any more.
      const reference = checkoutUrl.split('/').pop() ?? '';
      await ctx
        .http()
        .post(`/v1/payments/mock/${reference}/complete`)
        .send({ outcome: 'succeeded' })
        .expect(409);
      const retry = await startPayment(id, token).expect(201);
      await payWithMock(retry.body.checkoutUrl);
      expect((await ctx.http().get(`/v1/bookings/${id}`).set(token)).body.status).toBe('CONFIRMED');
    });
  });

  describe('ticketing and expiry (worker routes)', () => {
    const due = (id: string) =>
      ctx.prisma.booking.update({
        where: { id },
        data: { nextTicketingAt: new Date(Date.now() - 1000) },
      });

    it('retries ticketing with backoff and confirms when the airline recovers', async () => {
      const { id, token } = await guestBooking();
      ctx.app.get(MockFlightSupplier).failNextBookings = 2;
      const payment = await startPayment(id, token).expect(201);
      await payWithMock(payment.body.checkoutUrl);

      let row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'TICKETING', ticketingAttempts: 1 });
      const firstRetry = (row.nextTicketingAt?.getTime() ?? 0) - Date.now();
      expect(firstRetry).toBeGreaterThan(50_000);
      expect(firstRetry).toBeLessThanOrEqual(60_000);

      // Not due yet: nothing happens.
      const early = await ctx
        .http()
        .post('/v1/internal/bookings/ticket-due')
        .set(INTERNAL)
        .expect(200);
      expect(early.body.attempted).toBe(0);

      await due(id);
      const second = await ctx
        .http()
        .post('/v1/internal/bookings/ticket-due')
        .set(INTERNAL)
        .expect(200);
      expect(second.body).toMatchObject({ attempted: 1, retrying: 1 });
      row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
      expect((row.nextTicketingAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(110_000);

      await due(id);
      const third = await ctx
        .http()
        .post('/v1/internal/bookings/ticket-due')
        .set(INTERNAL)
        .expect(200);
      expect(third.body).toMatchObject({ attempted: 1, confirmed: 1 });
      const confirmed = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(confirmed.body).toMatchObject({
        status: 'CONFIRMED',
        documents: [{ type: 'e_ticket' }],
      });
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'booking.ticketing_failed', targetId: id },
        }),
      ).toBe(2);
    });

    it('refunds a paid booking automatically when the retry budget runs out', async () => {
      const { id, token, total } = await guestBooking();
      ctx.app.get(MockFlightSupplier).failNextBookings = 100;
      const payment = await startPayment(id, token).expect(201);
      await payWithMock(payment.body.checkoutUrl);
      for (let attempt = 2; attempt <= ctx.config.TICKETING_MAX_ATTEMPTS; attempt += 1) {
        await due(id);
        await ctx.http().post('/v1/internal/bookings/ticket-due').set(INTERNAL).expect(200);
      }
      await ctx.background.drain();
      const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({
        status: 'REFUNDED',
        ticketingAttempts: ctx.config.TICKETING_MAX_ATTEMPTS,
        nextTicketingAt: null,
      });
      const final = await ctx.prisma.bookingStatusHistory.findFirstOrThrow({
        where: { bookingId: id, toStatus: 'REFUND_PENDING' },
      });
      expect(final).toMatchObject({ event: 'ticketing_exhausted', reason: 'supplier_unavailable' });
      const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: id } });
      expect(refund).toMatchObject({
        reason: 'ticketing_failed',
        automatic: true,
        status: 'succeeded',
        amountMinor: BigInt(total.amountMinor),
      });
      const templates = ctx.emails.outbox.map((message) => message.template);
      expect(templates).toEqual(expect.arrayContaining(['refund-started', 'refund-completed']));
    });

    it('expires unpaid bookings after their payment deadline', async () => {
      const { id, token } = await guestBooking();
      await ctx.prisma.booking.update({
        where: { id },
        data: { paymentDeadline: new Date(Date.now() - 1000) },
      });
      await ctx.http().post('/v1/internal/bookings/expire-due').expect(401);
      const run = await ctx
        .http()
        .post('/v1/internal/bookings/expire-due')
        .set(INTERNAL)
        .expect(200);
      expect(run.body).toEqual({ expired: 1 });
      const expired = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(expired.body.status).toBe('EXPIRED');
      await startPayment(id, token).expect(409);
    });
  });

  describe('hotel booking', () => {
    it('books a stay with lead guests and issues a voucher', async () => {
      const cityId =
        (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LOS' } })).cityId ?? '';
      const search = await ctx
        .http()
        .post('/v1/hotels/searches')
        .send({
          destination: { type: 'city', cityId },
          checkIn: inDays(30),
          checkOut: inDays(33),
          rooms: [
            { adults: 2, childAges: [] },
            { adults: 1, childAges: [] },
          ],
        })
        .expect(200);
      const rateId = search.body.hotels[0].cheapestRate.id as string;
      const quote = await ctx.http().post(`/v1/hotels/rates/${rateId}/quote`).expect(201);

      const checkout = await ctx
        .http()
        .get(`/v1/quotes/${quote.body.quoteId as string}`)
        .expect(200);
      expect(checkout.body).toMatchObject({
        vertical: 'hotels',
        flight: null,
        hotel: { nights: 3 },
      });

      const wrong = await createBooking({
        quoteId: quote.body.quoteId,
        guests: [{ givenNames: 'Ngozi', surname: 'Eze' }],
      }).expect(422);
      expect(wrong.body.issues).toEqual([
        { index: null, path: ['guests'], code: 'passenger_count_mismatch' },
      ]);

      const created = await createBooking({
        quoteId: quote.body.quoteId,
        guests: [
          { givenNames: 'Ngozi', surname: 'Eze' },
          { givenNames: 'Tunde', surname: 'Bakare' },
        ],
      }).expect(201);
      const token = { 'X-Booking-Token': created.body.accessToken as string };
      const id = created.body.booking.id as string;
      expect(created.body.booking).toMatchObject({
        vertical: 'hotels',
        flight: null,
        hotel: { rooms: 2, nights: 3, confirmationNumber: null },
        passengers: [
          { givenNames: 'NGOZI', surname: 'EZE', roomIndex: 0 },
          { givenNames: 'TUNDE', surname: 'BAKARE', roomIndex: 1 },
        ],
      });

      const payment = await startPayment(id, token).expect(201);
      await payWithMock(payment.body.checkoutUrl);
      const confirmed = await ctx.http().get(`/v1/bookings/${id}`).set(token);
      expect(confirmed.body).toMatchObject({
        status: 'CONFIRMED',
        documents: [{ type: 'hotel_voucher' }],
      });
      expect(confirmed.body.hotel.confirmationNumber).toMatch(/^MH[A-Z0-9]{8}$/);
      const email = ctx.emails.outbox.find((message) => message.template === 'booking-confirmed');
      expect(email?.text).toContain('Hotel confirmation number');
    });
  });
});
