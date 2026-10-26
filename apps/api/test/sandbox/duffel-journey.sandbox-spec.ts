import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { createTestApp, type TestContext } from '../helpers/test-app';

/**
 * The app's journey against Duffel's test mode (ADR-062): our API, called as the website and the
 * app call it, with FLIGHT_SUPPLIERS and HOTEL_SUPPLIERS set to `duffel`. Search, quote, guest
 * booking, mock payment, then the order or stay booking Duffel confirms. Not part of the e2e
 * suite (no test may call a real provider): only the manual duffel-sandbox workflow runs it,
 * through jest-sandbox.config.mjs, with a test token. Travellers and contacts are made up.
 */

const token = process.env.DUFFEL_API_TOKEN ?? '';
const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const contact = { email: 'sandbox@example.com', phone: '+2348012345678' };

let keySequence = 0;
const idempotencyKey = (): string =>
  `sandbox-${Date.now().toString()}-${(keySequence += 1).toString()}`;

/** What happened at each step, printed so the workflow log reads like a report. */
function note(step: string, detail: unknown): void {
  process.stdout.write(`[journey] ${step}: ${JSON.stringify(detail)}\n`);
}

describe('Duffel test mode through our API (sandbox)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    if (!token.startsWith('duffel_test_')) {
      throw new Error('DUFFEL_API_TOKEN must be a Duffel test token (duffel_test_...)');
    }
    ctx = await createTestApp({
      FLIGHT_SUPPLIERS: ['duffel'],
      HOTEL_SUPPLIERS: ['duffel'],
      DUFFEL_API_TOKEN: token,
      // A local stand-in when set (to check this journey itself); Duffel otherwise.
      ...(process.env.DUFFEL_API_URL ? { DUFFEL_API_URL: process.env.DUFFEL_API_URL } : {}),
      // Test-mode searches take longer than our production budgets allow.
      SEARCH_TIMEOUT_MS: 30_000,
      SUPPLIER_TIMEOUT_MS: 25_000,
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  function createBooking(body: Record<string, unknown>) {
    return ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        contact,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        ...body,
      });
  }

  /** Pays on the mock provider's page, as a traveller would, and waits for fulfilment. */
  async function pay(bookingId: string, access: Record<string, string>): Promise<void> {
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(access);
    note('payment', { status: payment.status, type: payment.body.type as unknown });
    expect(payment.status).toBe(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
  }

  it('books a flight: search, quote, guest booking, payment, Duffel order', async () => {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LHR', destination: 'JFK', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      });
    const offers = (search.body.offers ?? []) as { id: string; owner: { code: string } }[];
    note('flight search', {
      status: search.status,
      offers: offers.length,
      suppliers: search.body.suppliers as unknown,
    });
    expect(search.status).toBe(200);
    // Duffel Airways (ZZ) is Duffel's test airline: the most predictable one to book.
    const offer = offers.find((candidate) => candidate.owner.code === 'ZZ') ?? offers[0];
    if (!offer) throw new Error('Duffel returned no flight offers');

    const quote = await ctx.http().post(`/v1/flights/offers/${offer.id}/quote`);
    note('flight quote', { status: quote.status, owner: offer.owner.code });
    expect(quote.status).toBe(201);

    const created = await createBooking({
      quoteId: quote.body.quoteId as string,
      passengers: [
        {
          type: 'adult',
          title: 'mr',
          gender: 'm',
          givenNames: 'Sandbox',
          surname: 'Tester',
          dateOfBirth: '1990-01-15',
          nationality: 'NG',
          document: { number: 'B1234567', issuingCountry: 'NG', expiryDate: inDays(3650) },
        },
      ],
    });
    note('flight booking', { status: created.status, problem: created.body.type as unknown });
    expect(created.status).toBe(201);
    const id = created.body.booking.id as string;
    const access = { 'X-Booking-Token': created.body.accessToken as string };

    await pay(id, access);
    const booking = await ctx.http().get(`/v1/bookings/${id}`).set(access).expect(200);
    note('flight result', {
      status: booking.body.status as unknown,
      airlineReference: Boolean(booking.body.flight?.airlineReference),
      documents: (booking.body.documents as { type: string }[]).map((document) => document.type),
    });
    expect(booking.body.status).toBe('CONFIRMED');
    expect(booking.body.flight.airlineReference).toEqual(expect.any(String));
  });

  // Bags come with the quote (search results carry no extras); the order pays for fare and bag.
  it('books a flight with a checked bag: the quote lists it, Duffel orders it', async () => {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LHR', destination: 'JFK', departureDate: inDays(32) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offers = search.body.offers as { id: string; owner: { code: string } }[];
    const offer = offers.find((candidate) => candidate.owner.code === 'ZZ') ?? offers[0];
    if (!offer) throw new Error('Duffel returned no flight offers');

    const quote = await ctx.http().post(`/v1/flights/offers/${offer.id}/quote`);
    const services = (quote.body.offer?.services ?? []) as {
      id: string;
      weightKg: number;
      maxQuantity: number;
      price: unknown;
    }[];
    note('bag quote', {
      status: quote.status,
      owner: offer.owner.code,
      bags: services.map(({ weightKg, maxQuantity, price }) => ({ weightKg, maxQuantity, price })),
    });
    expect(quote.status).toBe(201);
    const bag = services[0];
    if (!bag) throw new Error('Duffel sells no checked bag we can offer on this flight');

    const created = await createBooking({
      quoteId: quote.body.quoteId as string,
      passengers: [
        {
          type: 'adult',
          title: 'mr',
          gender: 'm',
          givenNames: 'Sandbox',
          surname: 'Bags',
          dateOfBirth: '1990-01-15',
          nationality: 'NG',
          document: { number: 'B7654321', issuingCountry: 'NG', expiryDate: inDays(3650) },
        },
      ],
      extras: [{ serviceId: bag.id, passengerIndex: 0, quantity: 1 }],
    });
    note('bag booking', {
      status: created.status,
      problem: created.body.type as unknown,
      extras: created.body.booking?.price?.extras as unknown,
    });
    expect(created.status).toBe(201);
    const id = created.body.booking.id as string;
    const access = { 'X-Booking-Token': created.body.accessToken as string };

    await pay(id, access);
    const booking = await ctx.http().get(`/v1/bookings/${id}`).set(access).expect(200);
    note('bag result', {
      status: booking.body.status as unknown,
      extraBags: (booking.body.passengers as { extraBags: number }[])[0]?.extraBags,
    });
    expect(booking.body.status).toBe('CONFIRMED');
    expect(booking.body.passengers[0].extraBags).toBe(1);
  });

  // Duffel takes one order per offer request, and identical searches share one search here
  // (the cache). Each quote searches again, so two travellers on one search both book.
  it('books two flights from one shared search: each quote has its own offer request', async () => {
    const request = {
      slices: [{ origin: 'LHR', destination: 'JFK', departureDate: inDays(31) }],
      passengers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'economy',
    };
    const first = await ctx.http().post('/v1/flights/searches').send(request).expect(200);
    const second = await ctx.http().post('/v1/flights/searches').send(request).expect(200);
    expect(second.body.searchId).toBe(first.body.searchId);
    const offers = first.body.offers as { id: string; owner: { code: string } }[];
    const offer = offers.find((candidate) => candidate.owner.code === 'ZZ') ?? offers[0];
    if (!offer) throw new Error('Duffel returned no flight offers');

    const references: string[] = [];
    for (const [index, givenNames] of ['Sandbox', 'Second'].entries()) {
      const quote = await ctx.http().post(`/v1/flights/offers/${offer.id}/quote`);
      note(`shared search quote ${index.toString()}`, { status: quote.status });
      expect(quote.status).toBe(201);
      const created = await createBooking({
        quoteId: quote.body.quoteId as string,
        passengers: [
          {
            type: 'adult',
            title: 'mr',
            gender: 'm',
            givenNames,
            surname: 'Tester',
            dateOfBirth: '1990-01-15',
            nationality: 'NG',
            document: {
              number: `B123456${index.toString()}`,
              issuingCountry: 'NG',
              expiryDate: inDays(3650),
            },
          },
        ],
      });
      expect(created.status).toBe(201);
      const id = created.body.booking.id as string;
      const access = { 'X-Booking-Token': created.body.accessToken as string };
      await pay(id, access);
      const booking = await ctx.http().get(`/v1/bookings/${id}`).set(access).expect(200);
      note(`shared search result ${index.toString()}`, { status: booking.body.status as unknown });
      expect(booking.body.status).toBe('CONFIRMED');
      references.push(booking.body.flight.airlineReference as string);
    }
    expect(new Set(references).size).toBe(2);
  });

  it('books a hotel: search, every rate, quote, guest booking, payment, Duffel stay', async () => {
    const cityId =
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LHR' } })).cityId ?? '';
    const search = await ctx
      .http()
      .post('/v1/hotels/searches')
      .send({
        destination: { type: 'city', cityId },
        checkIn: inDays(30),
        checkOut: inDays(32),
        rooms: [{ adults: 2, childAges: [] }],
      });
    const hotels = (search.body.hotels ?? []) as { id: string; name: string }[];
    note('hotel search', {
      status: search.status,
      hotels: hotels.length,
      suppliers: search.body.suppliers as unknown,
      problem: search.body.type as unknown,
    });
    // 503 here usually means Stays is not enabled on the Duffel account.
    expect(search.status).toBe(200);
    const hotel = hotels[0];
    if (!hotel) throw new Error('Duffel returned no hotels for London');

    const detail = await ctx.http().get(`/v1/hotels/results/${hotel.id}`);
    const rates = (detail.body.rates ?? []) as { id: string }[];
    note('hotel rates', { status: detail.status, rates: rates.length, first: rates[0]?.id });
    expect(detail.status).toBe(200);
    const rate = rates[0];
    if (!rate) throw new Error('The hotel has no rate we can sell');

    const quote = await ctx.http().post(`/v1/hotels/rates/${rate.id}/quote`);
    note('hotel quote', { status: quote.status, priceChange: quote.body.priceChange as unknown });
    expect(quote.status).toBe(201);

    const created = await createBooking({
      quoteId: quote.body.quoteId as string,
      guests: [{ givenNames: 'Sandbox', surname: 'Tester' }],
    });
    note('hotel booking', { status: created.status, problem: created.body.type as unknown });
    expect(created.status).toBe(201);
    const id = created.body.booking.id as string;
    const access = { 'X-Booking-Token': created.body.accessToken as string };

    await pay(id, access);
    const booking = await ctx.http().get(`/v1/bookings/${id}`).set(access).expect(200);
    note('hotel result', {
      status: booking.body.status as unknown,
      confirmationNumber: Boolean(booking.body.hotel?.confirmationNumber),
      documents: (booking.body.documents as { type: string }[]).map((document) => document.type),
    });
    expect(booking.body.status).toBe('CONFIRMED');
    expect(booking.body.hotel.confirmationNumber).toEqual(expect.any(String));
  });
});
