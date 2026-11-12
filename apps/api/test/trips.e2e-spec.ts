import { BOOKING_TERMS_VERSION } from '@suskii/shared';

import { PaymentReconciliationService } from '../src/bookings/payment-reconciliation.service';
import { RefundsService } from '../src/bookings/refunds.service';
import { LedgerReconciliationService } from '../src/finance/ledger-reconciliation.service';
import { MockPaymentProvider } from '../src/payments/mock-payment-provider';

import { CONTACT, inDays, nextKey, passenger, staffSession } from './helpers/cars';
import { bearer, signUp } from './helpers/flows';
import { pdfText } from './helpers/pdf-text';
import { localIn, rentalVehicle } from './helpers/rentals';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

interface Wire {
  amountMinor: number;
  currency: string;
}
interface TripPart {
  component: string;
  state: string;
  status: string;
  booking: { id: string; total: Wire };
  due: Wire;
  priceChange: { previous: Wire; current: Wire } | null;
}
interface Trip {
  id: string;
  reference: string;
  state: string;
  parts: TripPart[];
  missing: string[];
  total: Wire;
  due: Wire;
  payment: { open: { id: string; checkoutUrl: string; amount: Wire } | null };
}

const ALL = ['flight', 'hotel', 'car', 'transfer', 'insurance'] as const;

/**
 * Combined trips (ADR-099): a traveller plans a trip, adds bookings made in the ordinary way as
 * its parts and pays for all of them with one checkout. The provider charges once; every booking
 * gets its share through the same pipeline a single payment takes, so each is ticketed,
 * cancelled and refunded on its own.
 */
describe('combined trips (e2e)', () => {
  let ctx: TestContext;
  let mock: MockPaymentProvider;
  let staff: Record<string, string>;
  let traveller: { userId: string; headers: Record<string, string> };
  let sequence = 0;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    mock = ctx.app.get(MockPaymentProvider);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    mock.dropNextWebhooks = 0;
    mock.holdRefunds = false;
    staff = (await staffSession(ctx, 'trips-ops@suskii.test', ['content_manager', 'operations']))
      .headers;
    const session = await signUp(ctx, 'trip.traveller@example.com');
    traveller = { userId: session.userId, headers: bearer(session.accessToken) };
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  // ---------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------

  const plan = (components: readonly string[] = ALL): Record<string, unknown> => ({
    origin: {
      code: 'LOS',
      name: 'Murtala Muhammed International Airport',
      cityName: 'Lagos',
      countryCode: 'NG',
    },
    destination: {
      code: 'ABV',
      name: 'Nnamdi Azikiwe International Airport',
      cityName: 'Abuja',
      countryCode: 'NG',
      cityId: null,
    },
    departDate: inDays(30),
    returnDate: inDays(33),
    adults: 1,
    children: 0,
    components: [...components],
  });

  const createTrip = (
    components: readonly string[] = ALL,
    headers: Record<string, string> = traveller.headers,
  ) =>
    ctx
      .http()
      .post('/v1/trips')
      .set(headers)
      .send({ plan: plan(components) });

  const getTrip = async (
    tripId: string,
    headers: Record<string, string> = traveller.headers,
  ): Promise<Trip> =>
    (await ctx.http().get(`/v1/trips/${tripId}`).set(headers).expect(200)).body as Trip;

  const addPart = (
    tripId: string,
    bookingId: string,
    headers: Record<string, string> = traveller.headers,
  ) => ctx.http().post(`/v1/trips/${tripId}/parts`).set(headers).send({ bookingId });

  const payTrip = (tripId: string, headers: Record<string, string> = traveller.headers) =>
    ctx
      .http()
      .post(`/v1/trips/${tripId}/payments`)
      .set('Idempotency-Key', nextKey('e2e-trip-pay'))
      .set(headers)
      .send({});

  const referenceOf = (checkoutUrl: string): string => checkoutUrl.split('/').pop() ?? '';

  const complete = async (reference: string, outcome: 'succeeded' | 'failed' = 'succeeded') => {
    await ctx.http().post(`/v1/payments/mock/${reference}/complete`).send({ outcome }).expect(200);
    await ctx.background.drain();
  };

  const balance = async (code: string): Promise<bigint> =>
    (await ctx.prisma.ledgerAccount.findUnique({ where: { code } }))?.balanceMinor ?? 0n;

  const book = (body: Record<string, unknown>, headers = traveller.headers) =>
    ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', nextKey('e2e-trip-book'))
      .set(headers)
      .send({
        contact: CONTACT,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        passengers: [],
        guests: [],
        ...body,
      });

  const bookingId = async (
    body: Record<string, unknown>,
    headers = traveller.headers,
  ): Promise<string> => (await book(body, headers).expect(201)).body.booking.id as string;

  async function flightBooking(headers = traveller.headers): Promise<string> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .set(headers)
      .send({
        slices: [
          { origin: 'LOS', destination: 'ABV', departureDate: inDays(30) },
          { origin: 'ABV', destination: 'LOS', departureDate: inDays(33) },
        ],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offerId = (search.body.offers as { id: string }[])[0]?.id ?? '';
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${offerId}/quote`)
      .set(headers)
      .expect(201);
    return bookingId(
      { quoteId: quote.body.quoteId, passengers: [passenger('Ngozi', 'Eze')] },
      headers,
    );
  }

  async function hotelBooking(headers = traveller.headers): Promise<string> {
    const cityId =
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'ABV' } })).cityId ?? '';
    const search = await ctx
      .http()
      .post('/v1/hotels/searches')
      .set(headers)
      .send({
        destination: { type: 'city', cityId },
        checkIn: inDays(30),
        checkOut: inDays(33),
        rooms: [{ adults: 1, childAges: [] }],
      })
      .expect(200);
    const rateId = search.body.hotels[0].cheapestRate.id as string;
    const quote = await ctx
      .http()
      .post(`/v1/hotels/rates/${rateId}/quote`)
      .set(headers)
      .expect(201);
    return bookingId(
      { quoteId: quote.body.quoteId, guests: [{ givenNames: 'Ngozi', surname: 'Eze' }] },
      headers,
    );
  }

  async function carBooking(
    headers = traveller.headers,
    fields: Record<string, unknown> = {},
  ): Promise<{ bookingId: string; vehicleId: string }> {
    const car = await rentalVehicle(ctx, staff, { fields });
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .set(headers)
      .send({
        kind: 'rental',
        vehicleId: car.id,
        pickupAtLocal: localIn(24 * 30),
        returnAtLocal: localIn(24 * 33),
        chauffeur: false,
        delivery: null,
        driverAge: 30,
      })
      .expect(201);
    return {
      bookingId: await bookingId(
        { quoteId: quote.body.quoteId, guests: [{ givenNames: 'Ngozi', surname: 'Eze' }] },
        headers,
      ),
      vehicleId: car.id,
    };
  }

  async function addonBooking(
    type: 'airport_transfer' | 'insurance' | 'esim',
    headers = traveller.headers,
  ): Promise<string> {
    const created = await ctx
      .http()
      .post('/v1/admin/addons')
      .set(staff)
      .send({
        slug: `trip-${type.replace('_', '-')}-${(sequence += 1)}`,
        type,
        title: type === 'insurance' ? 'Travel insurance' : 'Airport transfer',
        summary: 'For the trip.',
        description: 'Sold with a trip.',
        countryCodes: [],
        pricingBasis: type === 'insurance' ? 'per_person_per_day' : 'per_booking',
        price: { amountMinor: type === 'insurance' ? 150_000 : 2_500_000, currency: 'NGN' },
        maxTravellers: 4,
        requiredDetails: [],
        cancellationPolicy: [
          { daysBefore: 1, refundBps: 10_000 },
          { daysBefore: 0, refundBps: 0 },
        ],
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/v1/admin/addons/${created.body.id as string}`)
      .set(staff)
      .send({ status: 'published' })
      .expect(204);
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .set(headers)
      .send({
        kind: 'addon',
        addonId: created.body.id,
        startDate: inDays(30),
        endDate: inDays(33),
        travellers: { adults: 1, children: 0, infants: 0 },
        linkToken: null,
      })
      .expect(201);
    return bookingId(
      { quoteId: quote.body.quoteId, passengers: [passenger('Ngozi', 'Eze')] },
      headers,
    );
  }

  /** A trip with every part added, and the bookings by part. */
  async function fullTrip(): Promise<{ trip: Trip; bookings: Record<string, string> }> {
    const tripId = (await createTrip().expect(201)).body.id as string;
    const bookings: Record<string, string> = {
      flight: await flightBooking(),
      hotel: await hotelBooking(),
      car: (await carBooking()).bookingId,
      transfer: await addonBooking('airport_transfer'),
      insurance: await addonBooking('insurance'),
    };
    for (const id of Object.values(bookings)) await addPart(tripId, id).expect(200);
    return { trip: await getTrip(tripId), bookings };
  }

  // ---------------------------------------------------------------------------------------

  it('builds a trip from a flight, a hotel, a car, a transfer and insurance, and pays for all of them once', async () => {
    const created = await createTrip().expect(201);
    expect(created.body).toMatchObject({
      reference: expect.stringMatching(/^T-[A-Z0-9]{6}$/),
      state: 'empty',
      parts: [],
      missing: [...ALL],
      total: { amountMinor: 0, currency: 'NGN' },
      due: { amountMinor: 0, currency: 'NGN' },
      payment: { open: null },
    });
    await payTrip(created.body.id as string).expect(409);

    const { trip, bookings } = await fullTrip();
    // A price per part and one total for the trip, every part in the order it is added.
    expect(trip.parts.map((part) => part.component)).toEqual([...ALL]);
    expect(trip.missing).toEqual([]);
    expect(trip.state).toBe('open');
    const sum = trip.parts.reduce((total, part) => total + part.booking.total.amountMinor, 0);
    expect(trip.total).toEqual({ amountMinor: sum, currency: 'NGN' });
    expect(trip.due).toEqual(trip.total);
    for (const part of trip.parts) {
      expect(part).toMatchObject({ state: 'to_pay', status: 'PRICED', priceChange: null });
      expect(part.due).toEqual(part.booking.total);
      expect(part.booking.total.amountMinor).toBeGreaterThan(0);
    }
    // Each booking says which trip it is a part of.
    const flight = await ctx
      .http()
      .get(`/v1/bookings/${bookings.flight ?? ''}`)
      .set(traveller.headers)
      .expect(200);
    expect(flight.body.trip).toEqual({
      id: trip.id,
      reference: trip.reference,
      component: 'flight',
    });

    // One checkout for the sum; the mock page shows the trip's own reference.
    const session = await payTrip(trip.id).expect(201);
    expect(session.body).toMatchObject({
      status: 'pending',
      amount: trip.total,
      parts: 5,
    });
    const reference = referenceOf(session.body.checkoutUrl as string);
    const page = await ctx.http().get(`/v1/payments/mock/${reference}`).expect(200);
    expect(page.body).toMatchObject({
      bookingReference: trip.reference,
      amount: trip.total,
      status: 'pending',
      returnUrl: expect.stringContaining(`/trips/${trip.id}`),
    });
    const waiting = await getTrip(trip.id);
    expect(waiting.state).toBe('awaiting_payment');
    expect(waiting.payment.open).toMatchObject({
      id: session.body.paymentId,
      checkoutUrl: session.body.checkoutUrl,
      amount: trip.total,
    });
    expect(waiting.parts.map((part) => part.status)).toEqual(Array(5).fill('AWAITING_PAYMENT'));

    await complete(reference);

    const paid = await getTrip(trip.id);
    expect(paid.state).toBe('paid');
    expect(paid.due).toEqual({ amountMinor: 0, currency: 'NGN' });
    expect(paid.total).toEqual(trip.total);
    expect(paid.payment.open).toBeNull();
    expect(paid.parts.map((part) => [part.component, part.status, part.state])).toEqual(
      ALL.map((component) => [component, 'CONFIRMED', 'confirmed']),
    );

    // The provider charged once; the ledger took each booking's share from that one charge.
    const tripPayment = await ctx.prisma.tripPayment.findUniqueOrThrow({
      where: { providerReference: reference },
      include: { shares: true },
    });
    expect(tripPayment).toMatchObject({ status: 'succeeded', amountMinor: BigInt(sum) });
    expect(tripPayment.shares).toHaveLength(5);
    expect(tripPayment.shares.every((share) => share.status === 'succeeded')).toBe(true);
    expect(tripPayment.shares.reduce((total, share) => total + share.amountMinor, 0n)).toBe(
      BigInt(sum),
    );
    expect(await balance('psp:mock:NGN')).toBe(BigInt(sum));
    for (const part of trip.parts) {
      const captured = await ctx.prisma.ledgerTransaction.findFirstOrThrow({
        where: { bookingId: part.booking.id, kind: 'payment_captured' },
        include: { entries: { where: { direction: 'debit' } } },
      });
      expect(captured.entries.reduce((total, entry) => total + entry.amountMinor, 0n)).toBe(
        BigInt(part.booking.total.amountMinor),
      );
    }
    // The ledger reconciliation agrees with the provider about the one charge.
    const reconciled = await ctx.app.get(LedgerReconciliationService).run();
    expect(reconciled.discrepancies).toBe(0);
    expect(await ctx.prisma.reconciliationDiscrepancy.count()).toBe(0);

    // A replayed webhook for the trip payment credits nothing twice.
    const event = mock.signedEvent(reference, 'succeeded', {
      minor: BigInt(sum),
      currency: 'NGN',
    });
    await ctx
      .http()
      .post('/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set(event.headers as Record<string, string>)
      .send(event.rawBody.toString('utf8'))
      .expect(200);
    await ctx.background.drain();
    expect(await balance('psp:mock:NGN')).toBe(BigInt(sum));
    expect(await ctx.prisma.refund.count()).toBe(0);

    // Paid parts stay in the trip, and nothing is left to pay.
    await ctx
      .http()
      .delete(`/v1/trips/${trip.id}/parts/${bookings.hotel ?? ''}`)
      .set(traveller.headers)
      .expect(409);
    const none = await payTrip(trip.id).expect(409);
    expect(none.body.type).toBe('urn:suskii:problem:trip-nothing-to-pay');
    const mine = await ctx.http().get('/v1/me/trips').set(traveller.headers).expect(200);
    // Newest first: the paid trip, then the one that stayed empty.
    expect((mine.body.trips as Trip[]).map((item) => item.id)).toEqual([trip.id, created.body.id]);
  });

  it('takes only the parts a traveller wants: one or two are a trip too', async () => {
    const tripId = (await createTrip(['flight', 'hotel']).expect(201)).body.id as string;
    const flight = await flightBooking();
    const hotel = await hotelBooking();
    await addPart(tripId, flight).expect(200);
    // Insurance was not asked for in this plan.
    const insurance = await addonBooking('insurance');
    const refused = await addPart(tripId, insurance).expect(422);
    expect(refused.body).toMatchObject({
      type: 'urn:suskii:problem:trip-part-invalid',
      code: 'not_wanted',
    });

    // One part alone can be paid as a trip; the other is added and paid later.
    const one = await getTrip(tripId);
    expect(one.missing).toEqual(['hotel']);

    // The plan as a PDF to keep or pass on: the part chosen, what is still to choose, the
    // total, and that a plan is not a booking. No name or contact is printed.
    const file = await ctx
      .http()
      .get(`/v1/trips/${tripId}/pdf`)
      .set(traveller.headers)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    const printed = (await pdfText(file.body as Buffer)).replace(/\n/g, ' ');
    expect(printed).toContain(one.reference);
    expect(printed).toContain('Flight');
    expect(printed).toContain('To pay');
    expect(printed).toContain('Still to choose');
    expect(printed).toContain('Hotel');
    expect(printed).toContain('A plan, not a booking.');
    expect(printed).not.toMatch(/@example\.com|\+234/);
    const other = bearer((await signUp(ctx, 'trip.reader@example.com')).accessToken);
    await ctx.http().get(`/v1/trips/${tripId}/pdf`).set(other).expect(404);
    await ctx.http().get(`/v1/trips/${tripId}/pdf`).expect(401);
    const first = await payTrip(tripId).expect(201);
    expect(first.body).toMatchObject({ parts: 1, amount: one.total });
    await complete(referenceOf(first.body.checkoutUrl as string));
    const half = await getTrip(tripId);
    expect(half.parts.map((part) => part.state)).toEqual(['confirmed']);
    expect(half.state).toBe('paid');

    await addPart(tripId, hotel).expect(200);
    const both = await getTrip(tripId);
    expect(both.state).toBe('open');
    expect(both.missing).toEqual([]);
    expect(both.due).toEqual(both.parts[1]?.booking.total);
    const second = await payTrip(tripId).expect(201);
    expect(second.body).toMatchObject({ parts: 1, amount: both.due });
    await complete(referenceOf(second.body.checkoutUrl as string));
    expect((await getTrip(tripId)).parts.map((part) => part.status)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
    ]);
  });

  it('keeps a trip to its owner and to bookings a trip can take', async () => {
    const tripId = (await createTrip().expect(201)).body.id as string;
    const flight = await flightBooking();
    await addPart(tripId, flight).expect(200);

    // Another account sees none of it and cannot use either the trip or the booking.
    const session = await signUp(ctx, 'trip.stranger@example.com');
    const stranger = bearer(session.accessToken);
    await ctx.http().get(`/v1/trips/${tripId}`).set(stranger).expect(404);
    await payTrip(tripId, stranger).expect(404);
    await ctx.http().delete(`/v1/trips/${tripId}/parts/${flight}`).set(stranger).expect(404);
    const theirs = (await createTrip(ALL, stranger).expect(201)).body.id as string;
    await addPart(theirs, flight, stranger).expect(404);
    const theirFlight = await flightBooking(stranger);
    await addPart(tripId, theirFlight).expect(404);
    await ctx.http().get(`/v1/trips/${tripId}`).expect(401);
    expect(
      (await ctx.http().get('/v1/me/trips').set(stranger).expect(200)).body.trips,
    ).toHaveLength(1);

    // A booking can be in one trip only, and a trip takes each part once: a newer unpaid
    // booking of the same part replaces the earlier one, which stays an ordinary booking.
    const other = (await createTrip().expect(201)).body.id as string;
    const elsewhere = await addPart(other, flight).expect(422);
    expect(elsewhere.body.code).toBe('other_trip');
    const newer = await flightBooking();
    const replaced = await addPart(tripId, newer).expect(200);
    expect((replaced.body as Trip).parts.map((part) => part.booking.id)).toEqual([newer]);
    expect(
      (await ctx.prisma.booking.findUniqueOrThrow({ where: { id: flight } })).tripId,
    ).toBeNull();

    // Things a trip does not take: another add-on, and a booking already paid.
    const esim = await addonBooking('esim');
    expect((await addPart(tripId, esim).expect(422)).body.code).toBe('unsupported');
    const hotel = await hotelBooking();
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${hotel}/payments`)
      .set('Idempotency-Key', nextKey('e2e-trip-own'))
      .set(traveller.headers)
      .send({})
      .expect(201);
    await complete(referenceOf(payment.body.checkoutUrl as string));
    expect((await addPart(tripId, hotel).expect(422)).body.code).toBe('not_payable');

    // An unpaid part can leave the trip; the booking itself is not cancelled.
    const left = await ctx
      .http()
      .delete(`/v1/trips/${tripId}/parts/${newer}`)
      .set(traveller.headers)
      .expect(200);
    expect(left.body).toMatchObject({ state: 'empty', parts: [] });
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: newer } })).status).toBe(
      'PRICED',
    );
    await ctx
      .http()
      .delete(`/v1/trips/${tripId}/parts/${newer}`)
      .set(traveller.headers)
      .expect(404);

    // The plan itself is checked: the same airport twice is not a trip.
    const bad = plan();
    await ctx
      .http()
      .post('/v1/trips')
      .set(traveller.headers)
      .send({ plan: { ...bad, destination: { ...(bad.destination as object), code: 'LOS' } } })
      .expect(400);
  });

  it('stops before any checkout when a part changed price, and pays once the traveller accepts', async () => {
    const tripId = (await createTrip(['flight', 'car']).expect(201)).body.id as string;
    const flight = await flightBooking();
    const car = await carBooking();
    await addPart(tripId, flight).expect(200);
    await addPart(tripId, car.bookingId).expect(200);
    const before = await getTrip(tripId);

    // The fleet raises the car's daily rate before the traveller pays.
    await ctx
      .http()
      .patch(`/v1/admin/rentals/vehicles/${car.vehicleId}`)
      .set(staff)
      .send({ dailyMinor: 5_000_000 })
      .expect(204);
    const changed = await payTrip(tripId).expect(409);
    expect(changed.body.type).toBe('urn:suskii:problem:price-changed');
    expect(await ctx.prisma.tripPayment.count()).toBe(0);
    expect(await ctx.prisma.payment.count()).toBe(0);

    // The trip shows which part moved, and cannot be paid until that booking's price is accepted.
    const pending = await getTrip(tripId);
    const part = pending.parts.find((item) => item.component === 'car');
    expect(part?.priceChange).toMatchObject({
      previous: part?.booking.total,
      current: { amountMinor: (part?.booking.total.amountMinor ?? 0) + 3 * 500_000 },
    });
    expect(pending.parts.find((item) => item.component === 'flight')?.priceChange).toBeNull();
    await payTrip(tripId).expect(409);
    await ctx
      .http()
      .post(`/v1/bookings/${car.bookingId}/price-consent`)
      .set(traveller.headers)
      .send({ total: part?.priceChange?.current })
      .expect(200);

    const session = await payTrip(tripId).expect(201);
    expect(session.body.amount).toEqual({
      amountMinor: before.total.amountMinor + 3 * 500_000,
      currency: 'NGN',
    });
    await complete(referenceOf(session.body.checkoutUrl as string));
    expect((await getTrip(tripId)).state).toBe('paid');
  });

  it('lets a part that sold out fall away, and pays for the rest', async () => {
    const tripId = (await createTrip(['flight', 'car']).expect(201)).body.id as string;
    const flight = await flightBooking();
    const car = await carBooking();
    await addPart(tripId, flight).expect(200);
    await addPart(tripId, car.bookingId).expect(200);
    // The car is withdrawn from the fleet.
    await ctx
      .http()
      .patch(`/v1/admin/rentals/vehicles/${car.vehicleId}`)
      .set(staff)
      .send({ status: 'draft' })
      .expect(204);
    const gone = await payTrip(tripId).expect(410);
    expect(gone.body.type).toBe('urn:suskii:problem:offer-unavailable');
    expect(await ctx.prisma.tripPayment.count()).toBe(0);

    const after = await getTrip(tripId);
    expect(after.parts.map((part) => [part.component, part.state])).toEqual([
      ['flight', 'to_pay'],
      ['car', 'closed'],
    ]);
    // The closed part no longer counts, and the plan asks for a car again.
    expect(after.missing).toEqual(['car']);
    expect(after.total).toEqual(after.parts[0]?.booking.total);
    const session = await payTrip(tripId).expect(201);
    expect(session.body).toMatchObject({ parts: 1, amount: after.total });
    await complete(referenceOf(session.body.checkoutUrl as string));
    expect((await getTrip(tripId)).state).toBe('paid');
  });

  it('gives every share back when the provider charged another amount', async () => {
    const tripId = (await createTrip(['flight', 'hotel']).expect(201)).body.id as string;
    await addPart(tripId, await flightBooking()).expect(200);
    await addPart(tripId, await hotelBooking()).expect(200);
    const trip = await getTrip(tripId);
    const session = await payTrip(tripId).expect(201);
    const reference = referenceOf(session.body.checkoutUrl as string);

    // The provider reports NGN 100 less than the trip's total.
    const received = trip.total.amountMinor - 10_000;
    const event = mock.signedEvent(reference, 'succeeded', {
      minor: BigInt(received),
      currency: 'NGN',
    });
    await ctx
      .http()
      .post('/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set(event.headers as Record<string, string>)
      .send(event.rawBody.toString('utf8'))
      .expect(200);
    await ctx.background.drain();
    await ctx.app.get(RefundsService).processDue();

    // Nothing was applied: no booking is paid, and the whole amount received is refunded
    // against the trip's one charge, in as many refunds as it had shares.
    const after = await getTrip(tripId);
    expect(after.parts.every((part) => part.state !== 'paid' && part.state !== 'confirmed')).toBe(
      true,
    );
    const refunds = await ctx.prisma.refund.findMany();
    expect(refunds).toHaveLength(2);
    expect(refunds.every((refund) => refund.reason === 'amount_mismatch')).toBe(true);
    expect(refunds.reduce((total, refund) => total + Number(refund.amountMinor), 0)).toBe(received);
    const atProvider = await mock.listRefunds({
      providerReference: reference,
      providerTransactionId: null,
      amount: { minor: BigInt(received), currency: 'NGN' },
    });
    expect(
      atProvider.reduce((total, refund) => total + Number(refund.amount?.minor ?? 0n), 0),
    ).toBe(received);
    expect(
      await ctx.prisma.tripPayment.findUniqueOrThrow({ where: { providerReference: reference } }),
    ).toMatchObject({ status: 'succeeded', receivedMinor: BigInt(received) });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'trip.payment_amount_mismatch' } }),
    ).toBe(1);
  });

  it('settles a trip whose webhook never came, through reconciliation', async () => {
    const tripId = (await createTrip(['flight', 'insurance']).expect(201)).body.id as string;
    await addPart(tripId, await flightBooking()).expect(200);
    await addPart(tripId, await addonBooking('insurance')).expect(200);
    const session = await payTrip(tripId).expect(201);
    const reference = referenceOf(session.body.checkoutUrl as string);

    mock.dropNextWebhooks = 1;
    await complete(reference);
    expect((await getTrip(tripId)).state).toBe('awaiting_payment');

    const result = await ctx.app
      .get(PaymentReconciliationService)
      .reconcileDue(new Date(Date.now() + 16 * 60_000));
    await ctx.background.drain();
    // The trip payment was asked about once; its shares never were (the provider does not know them).
    expect(result).toEqual({ checked: 1, settled: 1 });
    const paid = await getTrip(tripId);
    expect(paid.state).toBe('paid');
    expect(paid.parts.map((part) => part.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
  });

  it('puts the bookings back when the checkout fails, and opens a new one', async () => {
    const tripId = (await createTrip(['flight', 'hotel']).expect(201)).body.id as string;
    await addPart(tripId, await flightBooking()).expect(200);
    await addPart(tripId, await hotelBooking()).expect(200);
    const first = await payTrip(tripId).expect(201);
    await complete(referenceOf(first.body.checkoutUrl as string), 'failed');

    const failed = await getTrip(tripId);
    expect(failed.state).toBe('open');
    expect(failed.parts.map((part) => part.status)).toEqual(['PRICED', 'PRICED']);
    expect(failed.payment.open).toBeNull();
    expect((await ctx.prisma.payment.findMany()).map((payment) => payment.status).sort()).toEqual([
      'failed',
      'failed',
    ]);

    // A second checkout closes nothing that is paid and pays the same total.
    const second = await payTrip(tripId).expect(201);
    expect(second.body.amount).toEqual(failed.total);
    // Starting again before paying replaces the open checkout: only one is open at a time.
    const third = await payTrip(tripId).expect(201);
    expect(
      (await ctx.prisma.tripPayment.findMany({ orderBy: { createdAt: 'asc' } })).map(
        (payment) => payment.status,
      ),
    ).toEqual(['failed', 'cancelled', 'pending']);
    await complete(referenceOf(third.body.checkoutUrl as string));
    expect((await getTrip(tripId)).state).toBe('paid');
  });

  it("refunds one cancelled part to the trip's charge and leaves the others standing", async () => {
    const tripId = (await createTrip(['flight', 'insurance']).expect(201)).body.id as string;
    const flight = await flightBooking();
    const insurance = await addonBooking('insurance');
    await addPart(tripId, flight).expect(200);
    await addPart(tripId, insurance).expect(200);
    const trip = await getTrip(tripId);
    const session = await payTrip(tripId).expect(201);
    const reference = referenceOf(session.body.checkoutUrl as string);
    await complete(reference);

    // The traveller cancels the insurance, which is fully refundable this far ahead.
    await ctx.http().post(`/v1/bookings/${insurance}/cancel`).set(traveller.headers).expect(200);
    await ctx.background.drain();
    await ctx.app.get(RefundsService).processDue();
    await ctx.background.drain();

    const price = trip.parts.find((part) => part.component === 'insurance')?.booking.total;
    const refunds = await ctx.prisma.refund.findMany({ where: { bookingId: insurance } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      status: 'succeeded',
      provider: 'mock',
      amountMinor: BigInt(price?.amountMinor ?? 0),
    });
    // The provider refunded part of the one charge it knows: the trip payment's.
    const atProvider = await mock.listRefunds({
      providerReference: reference,
      providerTransactionId: null,
      amount: { minor: BigInt(trip.total.amountMinor), currency: 'NGN' },
    });
    expect(atProvider).toHaveLength(1);
    expect(atProvider[0]?.amount).toEqual({
      minor: BigInt(price?.amountMinor ?? 0),
      currency: 'NGN',
    });

    const after = await getTrip(tripId);
    expect(after.parts.map((part) => [part.component, part.state])).toEqual([
      ['flight', 'confirmed'],
      ['insurance', 'closed'],
    ]);
    expect(after.state).toBe('paid');
    expect(after.total).toEqual(after.parts[0]?.booking.total);
    // The books still agree with the provider after the partial refund.
    expect((await ctx.app.get(LedgerReconciliationService).run()).discrepancies).toBe(0);
  });

  it('closes an open checkout when the parts change, so the traveller pays what the trip shows', async () => {
    const tripId = (await createTrip(['flight', 'hotel', 'insurance']).expect(201)).body
      .id as string;
    const flightId = await flightBooking();
    await addPart(tripId, flightId).expect(200);
    const first = await payTrip(tripId).expect(201);
    const waiting = await getTrip(tripId);
    expect(waiting.state).toBe('awaiting_payment');
    expect(waiting.payment.open).toMatchObject({ id: first.body.paymentId });

    // Adding the hotel changes the total: the first checkout is closed and nothing is pending.
    const hotelId = await hotelBooking();
    const added = (await addPart(tripId, hotelId).expect(200)).body as Trip;
    expect(added.payment.open).toBeNull();
    expect(added.state).toBe('open');
    expect(added.parts.map((part) => [part.component, part.state])).toEqual([
      ['flight', 'to_pay'],
      ['hotel', 'to_pay'],
    ]);
    expect(added.due).toEqual(added.total);
    expect(
      await ctx.prisma.tripPayment.findUniqueOrThrow({ where: { id: first.body.paymentId } }),
    ).toMatchObject({ status: 'cancelled' });
    expect(
      await ctx.prisma.payment.count({
        where: { tripPaymentId: first.body.paymentId, status: 'pending' },
      }),
    ).toBe(0);

    // A second checkout covers both parts; removing one closes it again.
    const second = await payTrip(tripId).expect(201);
    expect(second.body).toMatchObject({ parts: 2, amount: added.total });
    const removed = await ctx
      .http()
      .delete(`/v1/trips/${tripId}/parts/${hotelId}`)
      .set(traveller.headers)
      .expect(200);
    expect(removed.body.payment.open).toBeNull();
    expect(removed.body.parts.map((part: { component: string }) => part.component)).toEqual([
      'flight',
    ]);
    // The hotel is an ordinary unpaid booking again, with no payment waiting on it.
    const hotel = await ctx
      .http()
      .get(`/v1/bookings/${hotelId}`)
      .set(traveller.headers)
      .expect(200);
    expect(hotel.body).toMatchObject({ status: 'PRICED', trip: null });
    expect(
      await ctx.prisma.payment.count({ where: { bookingId: hotelId, status: 'pending' } }),
    ).toBe(0);

    // The third checkout is for the flight alone, and paying it confirms the flight.
    const third = await payTrip(tripId).expect(201);
    expect(third.body).toMatchObject({ parts: 1, amount: removed.body.total });
    await complete(referenceOf(third.body.checkoutUrl as string));
    const paid = await getTrip(tripId);
    expect(paid.state).toBe('paid');
    expect(paid.parts.map((part) => [part.component, part.state])).toEqual([
      ['flight', 'confirmed'],
    ]);
    // A closed checkout can no longer be paid on the provider's page.
    await ctx
      .http()
      .post(`/v1/payments/mock/${referenceOf(second.body.checkoutUrl as string)}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(409);
    expect((await ctx.app.get(LedgerReconciliationService).run()).discrepancies).toBe(0);
  });

  it('deletes a trip nobody started paying, and keeps one with a payment', async () => {
    const tripId = (await createTrip(['flight', 'insurance']).expect(201)).body.id as string;
    const flightId = await flightBooking();
    await addPart(tripId, flightId).expect(200);
    // Not someone else's to delete.
    const stranger = bearer((await signUp(ctx, 'trip.deleter@example.com')).accessToken);
    await ctx.http().delete(`/v1/trips/${tripId}`).set(stranger).expect(404);
    await ctx.http().delete(`/v1/trips/${tripId}`).set(traveller.headers).expect(204);
    await ctx.http().get(`/v1/trips/${tripId}`).set(traveller.headers).expect(404);
    // The flight is not cancelled: it is an ordinary unpaid booking again.
    const flight = await ctx
      .http()
      .get(`/v1/bookings/${flightId}`)
      .set(traveller.headers)
      .expect(200);
    expect(flight.body).toMatchObject({ status: 'PRICED', trip: null });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'trip.deleted', targetId: tripId } }),
    ).toBe(1);

    // A trip with a payment started stays with its bookings.
    const kept = (await createTrip(['flight', 'insurance']).expect(201)).body.id as string;
    await addPart(kept, flightId).expect(200);
    await payTrip(kept).expect(201);
    const refused = await ctx.http().delete(`/v1/trips/${kept}`).set(traveller.headers).expect(409);
    expect(refused.body.type).toBe('urn:suskii:problem:trip-has-payments');
    await getTrip(kept);
  });

  it('counts a trip as one payment for the daily limit, and holds a trip paid beyond it', async () => {
    const reviews = () => ctx.prisma.paymentRiskReview.findMany({ orderBy: { createdAt: 'asc' } });
    /** An ordinary flight booking, paid on its own. */
    const single = async (): Promise<string> => {
      const id = await flightBooking();
      const payment = await ctx
        .http()
        .post(`/v1/bookings/${id}/payments`)
        .set('Idempotency-Key', nextKey('e2e-trip-single'))
        .set(traveller.headers)
        .expect(201);
      await complete(referenceOf(payment.body.checkoutUrl as string));
      return id;
    };

    // One charge pays five bookings. The traveller's next payment is their second of the day,
    // not their sixth, so it is not held for review (ADR-040: five payments a day).
    const { trip } = await fullTrip();
    const charge = await payTrip(trip.id).expect(201);
    await complete(referenceOf(charge.body.checkoutUrl as string));
    const next = await single();
    expect(await reviews()).toEqual([]);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: next } })).status).toBe(
      'CONFIRMED',
    );

    // Three more make five charges. A sixth is over the limit, and a trip is no way around it:
    // each of its bookings waits for finance.
    for (let count = 0; count < 3; count += 1) await single();
    expect(await reviews()).toEqual([]);
    const tripId = (await createTrip(['flight', 'hotel']).expect(201)).body.id as string;
    const flight = await flightBooking();
    const hotel = await hotelBooking();
    await addPart(tripId, flight).expect(200);
    await addPart(tripId, hotel).expect(200);
    const sixth = await payTrip(tripId).expect(201);
    await complete(referenceOf(sixth.body.checkoutUrl as string));
    const held = await reviews();
    expect(held.map((review) => review.bookingId).sort()).toEqual([flight, hotel].sort());
    for (const review of held) {
      expect(review).toMatchObject({
        status: 'open',
        signals: ['velocity_account', 'velocity_contact'],
      });
    }
    expect((await getTrip(tripId)).parts.map((part) => part.status)).toEqual(['PAID', 'PAID']);
  });

  it('caps the trips one account can leave unpaid', async () => {
    const created: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      created.push((await createTrip(['hotel']).expect(201)).body.id as string);
    }
    const refused = await createTrip(['hotel']).expect(409);
    expect(refused.body.type).toBe('urn:suskii:problem:too-many-trips');
    // Deleting a plan makes room for another.
    await ctx
      .http()
      .delete(`/v1/trips/${created[0] ?? ''}`)
      .set(traveller.headers)
      .expect(204);
    await createTrip(['hotel']).expect(201);
  });
});
