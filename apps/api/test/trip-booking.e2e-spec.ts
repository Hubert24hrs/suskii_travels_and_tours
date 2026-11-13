import { BOOKING_TERMS_VERSION, type TripPlan } from '@suskii/shared';

import { AGENT_REQUEST_CONTEXT } from '../src/agent/tools/tool-support';
import { MockPaymentProvider } from '../src/payments/mock-payment-provider';
import type { TripPreparedPart } from '../src/trips/trips.schemas';
import { TripsService } from '../src/trips/trips.service';

import { CONTACT, inDays, nextKey, staffSession } from './helpers/cars';
import { bearer, signUp } from './helpers/flows';
import { localIn, rentalVehicle } from './helpers/rentals';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

interface Wire {
  amountMinor: number;
  currency: string;
}
interface Trip {
  id: string;
  state: string;
  parts: { component: string; state: string; booking: { id: string; total: Wire } }[];
  prepared?: { component: string; quoteId: string }[];
  total: Wire;
  due: Wire;
}
interface Quote {
  quoteId: string;
  expiresAt: string;
  price: Wire;
}

const person = (
  type: 'adult' | 'child' | 'infant',
  givenNames: string,
  dateOfBirth: string,
): Record<string, unknown> => ({
  type,
  title: type === 'adult' ? 'ms' : 'miss',
  gender: 'f',
  givenNames,
  surname: 'Okafor',
  dateOfBirth,
  nationality: 'NG',
  document: null,
  travellerId: null,
});
const ADA = person('adult', 'Ada', '1988-06-15');
const BISI = person('adult', 'Bisi', '1990-02-01');
const CHIDI = person('child', 'Chidi', `${Number(inDays(0).slice(0, 4)) - 8}-03-10`);

/**
 * One details form for the whole trip (ADR-118): the traveller enters the contact and everyone
 * travelling once, and every part Ask Suskii prepared is booked from it as an ordinary booking,
 * joins the trip and is paid with the trip's one payment. All or nothing.
 */
describe('booking a whole trip from one form (e2e)', () => {
  let ctx: TestContext;
  let staff: Record<string, string>;
  let traveller: { userId: string; headers: Record<string, string> };
  let sequence = 0;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    staff = (
      await staffSession(ctx, 'trip-form-ops@suskii.test', ['content_manager', 'operations'])
    ).headers;
    const session = await signUp(ctx, 'trip.form@example.com');
    traveller = { userId: session.userId, headers: bearer(session.accessToken) };
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  const travellers = { adults: 2, children: 1, infants: 0 };

  const plan = (components: TripPlan['components']): TripPlan => ({
    origin: { code: 'LOS', name: 'Lagos', cityName: 'Lagos', countryCode: 'NG' },
    destination: { code: 'ABV', name: 'Abuja', cityName: 'Abuja', countryCode: 'NG', cityId: null },
    departDate: inDays(30),
    returnDate: inDays(33),
    adults: 2,
    children: 1,
    components,
  });

  async function flightQuote(): Promise<Quote> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .set(traveller.headers)
      .send({
        slices: [
          { origin: 'LOS', destination: 'ABV', departureDate: inDays(30) },
          { origin: 'ABV', destination: 'LOS', departureDate: inDays(33) },
        ],
        passengers: travellers,
        cabinClass: 'economy',
      })
      .expect(200);
    const offerId = (search.body.offers as { id: string }[])[0]?.id ?? '';
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${offerId}/quote`)
      .set(traveller.headers)
      .expect(201);
    return {
      quoteId: quote.body.quoteId,
      expiresAt: quote.body.expiresAt,
      price: quote.body.offer.price.total,
    };
  }

  async function hotelQuote(): Promise<Quote> {
    const cityId =
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'ABV' } })).cityId ?? '';
    const search = await ctx
      .http()
      .post('/v1/hotels/searches')
      .set(traveller.headers)
      .send({
        destination: { type: 'city', cityId },
        checkIn: inDays(30),
        checkOut: inDays(33),
        rooms: [{ adults: 2, childAges: [8] }],
      })
      .expect(200);
    const rateId = search.body.hotels[0].cheapestRate.id as string;
    const quote = await ctx
      .http()
      .post(`/v1/hotels/rates/${rateId}/quote`)
      .set(traveller.headers)
      .expect(201);
    return {
      quoteId: quote.body.quoteId,
      expiresAt: quote.body.expiresAt,
      price: quote.body.rate.price.total,
    };
  }

  async function inhouseQuote(body: Record<string, unknown>): Promise<Quote> {
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .set(traveller.headers)
      .send(body)
      .expect(201);
    return {
      quoteId: quote.body.quoteId,
      expiresAt: quote.body.expiresAt,
      price: quote.body.price.total,
    };
  }

  async function carQuote(): Promise<Quote> {
    const car = await rentalVehicle(ctx, staff);
    return inhouseQuote({
      kind: 'rental',
      vehicleId: car.id,
      pickupAtLocal: localIn(24 * 30),
      returnAtLocal: localIn(24 * 33),
      chauffeur: false,
      delivery: null,
      driverAge: 35,
    });
  }

  async function addonQuote(
    type: 'airport_transfer' | 'insurance',
    counts: Record<string, number> = travellers,
  ): Promise<Quote> {
    const created = await ctx
      .http()
      .post('/v1/admin/addons')
      .set(staff)
      .send({
        slug: `trip-form-${type.replace('_', '-')}-${(sequence += 1)}`,
        type,
        title: type === 'insurance' ? 'Travel insurance' : 'Airport transfer',
        summary: 'For the trip.',
        description: 'Sold with a trip.',
        countryCodes: [],
        pricingBasis: type === 'insurance' ? 'per_person_per_day' : 'per_booking',
        price: { amountMinor: type === 'insurance' ? 150_000 : 2_500_000, currency: 'NGN' },
        maxTravellers: 4,
        requiredDetails:
          type === 'insurance' ? ['dates_of_birth'] : ['flight_number', 'arrival_time'],
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
    return inhouseQuote({
      kind: 'addon',
      addonId: created.body.id,
      startDate: inDays(30),
      endDate: type === 'insurance' ? inDays(33) : inDays(30),
      travellers: counts,
      linkToken: null,
    });
  }

  /** A trip whose parts Ask Suskii prepared, as `trips.prepare_checkout` leaves one. */
  async function preparedTrip(parts: Partial<Record<TripPreparedPart['component'], Quote>>) {
    const prepared = Object.entries(parts).map(([component, quote]): TripPreparedPart => ({
      component: component as TripPreparedPart['component'],
      quoteId: quote.quoteId,
      title: `Prepared ${component}`,
      price: quote.price,
      expiresAt: quote.expiresAt,
    }));
    const trip = await ctx.app.get(TripsService).prepare(
      traveller.userId,
      {
        tripId: null,
        plan: plan(prepared.map((part) => part.component)),
        currency: 'NGN',
        prepared,
      },
      AGENT_REQUEST_CONTEXT,
    );
    if (!trip) throw new Error('no trip');
    return trip.id;
  }

  const bookTrip = (tripId: string, body: Record<string, unknown>, headers = traveller.headers) =>
    ctx
      .http()
      .post(`/v1/trips/${tripId}/book`)
      .set('Idempotency-Key', nextKey('e2e-trip-form'))
      .set(headers)
      .send({
        contact: CONTACT,
        travellers: [{ ...ADA, saveTraveller: true }, BISI, CHIDI],
        addonDetails: { flightNumber: 'P4 7121', arrivalTime: `${inDays(30)}T09:40` },
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        ...body,
      });

  it('books every prepared part from one set of details, and the trip is paid once', async () => {
    const quotes = {
      flight: await flightQuote(),
      hotel: await hotelQuote(),
      car: await carQuote(),
      transfer: await addonQuote('airport_transfer'),
      insurance: await addonQuote('insurance'),
    };
    const tripId = await preparedTrip(quotes);

    const booked = await bookTrip(tripId, {}).expect(200);
    const trip = booked.body as Trip;
    expect(trip.parts.map((part) => [part.component, part.state])).toEqual([
      ['flight', 'to_pay'],
      ['hotel', 'to_pay'],
      ['car', 'to_pay'],
      ['transfer', 'to_pay'],
      ['insurance', 'to_pay'],
    ]);
    // Nothing waits for details any more, and the trip's one total covers every part.
    expect(trip.prepared).toEqual([]);
    const sum = trip.parts.reduce((total, part) => total + part.booking.total.amountMinor, 0);
    expect(trip.total).toEqual({ amountMinor: sum, currency: 'NGN' });
    expect(trip.due).toEqual(trip.total);

    // Each part took the travellers its own quote was priced for.
    const travellersOf = async (component: string) => {
      const bookingId = trip.parts.find((part) => part.component === component)?.booking.id;
      const booking = await ctx
        .http()
        .get(`/v1/bookings/${bookingId ?? ''}`)
        .set(traveller.headers)
        .expect(200);
      return (booking.body.passengers as { givenNames: string; type: string }[]).map(
        (passenger) => `${passenger.givenNames}:${passenger.type}`,
      );
    };
    expect(await travellersOf('flight')).toEqual(['ADA:adult', 'BISI:adult', 'CHIDI:child']);
    expect(await travellersOf('insurance')).toEqual(['ADA:adult', 'BISI:adult', 'CHIDI:child']);
    // The hotel's lead guest and the car's renter are the first adult.
    expect(await travellersOf('hotel')).toEqual(['ADA:adult']);
    expect(await travellersOf('car')).toEqual(['ADA:adult']);
    // The transfer kept the arriving flight it asked for.
    const transfer = await ctx.prisma.bookingItem.findFirstOrThrow({
      where: { bookingId: trip.parts.find((part) => part.component === 'transfer')?.booking.id },
    });
    expect((transfer.payload as { detailsEncrypted?: string }).detailsEncrypted).toEqual(
      expect.any(String),
    );
    // Ada asked to be saved: she is saved once, not once per part.
    expect(await ctx.prisma.traveller.count({ where: { userId: traveller.userId } })).toBe(1);

    // One payment for all five.
    const mock = ctx.app.get(MockPaymentProvider);
    mock.dropNextWebhooks = 0;
    const session = await ctx
      .http()
      .post(`/v1/trips/${tripId}/payments`)
      .set('Idempotency-Key', nextKey('e2e-trip-form-pay'))
      .set(traveller.headers)
      .send({})
      .expect(201);
    expect(session.body).toMatchObject({ parts: 5, amount: trip.total });
    const reference = (session.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const paid = (await ctx.http().get(`/v1/trips/${tripId}`).set(traveller.headers).expect(200))
      .body as Trip;
    expect(paid.state).toBe('paid');
  });

  it('books nothing when one part cannot be booked, and names the part', async () => {
    const tripId = await preparedTrip({
      flight: await flightQuote(),
      transfer: await addonQuote('airport_transfer'),
    });
    // The transfer asks for the arriving flight, and the form left it out.
    const refused = await bookTrip(tripId, { addonDetails: null }).expect(422);
    expect(refused.body).toMatchObject({
      type: expect.stringContaining('addon-details-invalid') as string,
      part: 'transfer',
    });

    // The flight booked first was cancelled again, and both parts still wait for details.
    const flights = await ctx.prisma.booking.findMany({ where: { userId: traveller.userId } });
    expect(flights.map((booking) => booking.status)).toEqual(['CANCELLED']);
    const trip = (await ctx.http().get(`/v1/trips/${tripId}`).set(traveller.headers).expect(200))
      .body as Trip;
    expect(trip.parts).toEqual([]);
    expect(trip.prepared?.map((part) => part.component)).toEqual(['flight', 'transfer']);

    // With the details, the same trip books.
    const booked = await bookTrip(tripId, {}).expect(200);
    expect((booked.body as Trip).parts.map((part) => part.component)).toEqual([
      'flight',
      'transfer',
    ]);
  });

  it('points at the traveller in the form whose detail a part refused', async () => {
    // Insurance for one adult and one child: it takes Ada and the third traveller.
    const tripId = await preparedTrip({
      insurance: await addonQuote('insurance', { adults: 1, children: 1, infants: 0 }),
    });
    const grownUp = person('child', 'Chidi', '1980-01-01');
    const refused = await bookTrip(tripId, { travellers: [ADA, BISI, grownUp] }).expect(422);
    expect(refused.body).toMatchObject({
      type: expect.stringContaining('passengers-invalid') as string,
      part: 'insurance',
    });
    // The insurance's second traveller is the form's third.
    expect(refused.body.issues).toEqual([
      expect.objectContaining({ index: 2, code: 'passenger_type_mismatch' }),
    ]);
    expect(await ctx.prisma.booking.count()).toBe(0);
  });

  it('says when the form names fewer travellers than a part was priced for, or nothing waits', async () => {
    const tripId = await preparedTrip({ flight: await flightQuote() });
    const short = await bookTrip(tripId, { travellers: [ADA, BISI] }).expect(422);
    expect(short.body).toMatchObject({
      type: expect.stringContaining('trip-travellers-short') as string,
      part: 'flight',
    });
    expect(await ctx.prisma.booking.count()).toBe(0);
    // Somebody else's trip does not exist for them.
    const other = await signUp(ctx, 'someone.else@example.com');
    await bookTrip(tripId, {}, bearer(other.accessToken)).expect(404);
    // Booked once, there is nothing left to book.
    await bookTrip(tripId, {}).expect(200);
    const again = await bookTrip(tripId, {}).expect(409);
    expect(again.body).toMatchObject({
      type: expect.stringContaining('trip-nothing-prepared') as string,
    });
  });
});
