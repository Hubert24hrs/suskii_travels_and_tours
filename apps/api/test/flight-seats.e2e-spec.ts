import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { MockFlightSupplier } from '../src/suppliers/mock/mock-flight-supplier';
import { SupplierUnavailableError } from '../src/suppliers/supplier.errors';

import { E2E_TURNSTILE } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Seat selection on flights (ADR-094): the airline's seat map for a quote, seats booked at the
 * airline's price inside the total, the choices the API refuses, and the check against the map
 * again right before payment. The mock airline sells seats on every flight.
 */

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
let keySequence = 0;
const idempotencyKey = (): string => `e2e-flight-seats-${Date.now()}-${(keySequence += 1)}`;

interface Money {
  amountMinor: number;
  currency: string;
}
interface Seat {
  designator: string;
  available: boolean;
  price: Money;
  features: string[];
}
interface SeatMaps {
  quoteId: string;
  currency: string;
  seated: number;
  flights: {
    flight: number;
    origin: { code: string };
    destination: { code: string };
    flightNumber: string;
    cabinClass: string;
    rows: { number: number; sections: (Seat | null)[][] }[];
  }[];
}

const seatsOf = (maps: SeatMaps, flight = 0): Seat[] =>
  (maps.flights.find((entry) => entry.flight === flight)?.rows ?? []).flatMap((row) =>
    row.sections.flat().filter((seat): seat is Seat => seat !== null),
  );

describe('flight seat selection (e2e)', () => {
  let ctx: TestContext;
  let airline: MockFlightSupplier;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    airline = ctx.app.get(MockFlightSupplier);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    airline.sellsSeats = true;
    airline.takenSeats.clear();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const contact = { email: 'seats@example.com', phone: '+2348012345678' };
  const adult = (extra: Record<string, unknown> = {}) => ({
    type: 'adult',
    title: 'ms',
    gender: 'f',
    givenNames: 'Chioma',
    surname: 'Okafor',
    dateOfBirth: '1990-04-01',
    nationality: 'NG',
    ...extra,
  });

  async function quote(passengers = { adults: 1, children: 0, infants: 0 }) {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers,
        cabinClass: 'economy',
      })
      .expect(200);
    // A direct flight, so the trip has exactly one seat map.
    const direct = (search.body.offers as { id: string; slices: { stops: number }[] }[]).find(
      (offer) => offer.slices[0]?.stops === 0,
    );
    const quoted = await ctx
      .http()
      .post(`/v1/flights/offers/${direct?.id ?? ''}/quote`)
      .expect(201);
    return quoted.body as { quoteId: string; offer: { price: { total: Money } } };
  }
  const seatMaps = async (quoteId: string): Promise<SeatMaps> =>
    (await ctx.http().get(`/v1/quotes/${quoteId}/seat-maps`).expect(200)).body as SeatMaps;
  const book = (quoteId: string, passengers: unknown[], seats: unknown[]) =>
    ctx.http().post('/v1/bookings').set('Idempotency-Key', idempotencyKey()).send({
      quoteId,
      passengers,
      seats,
      contact,
      termsVersion: BOOKING_TERMS_VERSION,
      acceptTerms: true,
      turnstileToken: E2E_TURNSTILE,
    });
  const startPayment = (bookingId: string, token: string) =>
    ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set('X-Booking-Token', token);

  it("shows the airline's seat map for a quote, priced without a markup", async () => {
    const { quoteId } = await quote();
    const maps = await seatMaps(quoteId);

    expect(maps).toMatchObject({ quoteId, currency: 'NGN', seated: 1 });
    expect(maps.flights).toHaveLength(1);
    const [flight] = maps.flights;
    expect(flight).toMatchObject({
      flight: 0,
      origin: { code: 'LOS' },
      destination: { code: 'ABV' },
      cabinClass: 'economy',
    });
    // Three and three across, rows 10 to 33.
    expect(flight?.rows).toHaveLength(24);
    expect(flight?.rows[0]?.sections.map((section) => section.length)).toEqual([3, 3]);

    const seats = seatsOf(maps);
    const seat = (designator: string) => seats.find((entry) => entry.designator === designator);
    expect(seat('10A')?.features).toEqual(['window']);
    expect(seat('10C')?.features).toEqual(['aisle']);
    expect(seat('10B')?.features).toEqual([]);
    expect(seat('12A')?.features).toEqual(['window', 'extra_legroom', 'exit_row']);
    // The mock airline's own prices, in naira: nothing for a middle seat, more for an exit row.
    expect(seat('10B')?.price).toEqual({ amountMinor: 0, currency: 'NGN' });
    expect(seat('10A')?.price).toEqual({ amountMinor: 200_000, currency: 'NGN' });
    expect(seat('12A')?.price).toEqual({ amountMinor: 750_000, currency: 'NGN' });
    // Some seats are taken, most are free, and the same flight always shows the same map.
    const taken = seats.filter((entry) => !entry.available).length;
    expect(taken).toBeGreaterThan(20);
    expect(taken).toBeLessThan(80);
    expect(await seatMaps(quoteId)).toEqual(maps);
  });

  it('answers no seat maps when the airline sells none, and 404 for anything but a flight quote', async () => {
    const { quoteId } = await quote();
    airline.sellsSeats = false;
    expect((await seatMaps(quoteId)).flights).toEqual([]);
    // With no map there is nothing to choose from.
    const refused = await book(
      quoteId,
      [adult()],
      [{ flight: 0, passengerIndex: 0, designator: '10A' }],
    ).expect(422);
    expect(refused.body).toMatchObject({
      type: 'urn:suskii:problem:seats-invalid',
      reason: 'unknown_flight',
    });

    await ctx.http().get('/v1/quotes/01900000-0000-7000-8000-000000000000/seat-maps').expect(404);
  });

  it('books chosen seats at the airline price inside the total and passes them to the airline', async () => {
    const quoted = await quote({ adults: 2, children: 0, infants: 0 });
    const free = seatsOf(await seatMaps(quoted.quoteId)).filter((seat) => seat.available);
    const window = free.find(
      (seat) => seat.features.includes('window') && seat.price.amountMinor === 200_000,
    );
    const middle = free.find((seat) => seat.features.length === 0);
    if (!window || !middle) throw new Error('the mock map has a free window and middle seat');
    const booked = jest.spyOn(airline, 'book');

    const created = await book(
      quoted.quoteId,
      [adult(), adult({ givenNames: 'Ngozi', title: 'mrs' })],
      [
        { flight: 0, passengerIndex: 0, designator: window.designator },
        { flight: 0, passengerIndex: 1, designator: middle.designator },
      ],
    ).expect(201);
    const { booking, accessToken } = created.body as {
      booking: {
        id: string;
        price: { total: Money; seats: unknown[]; extras: unknown[] };
        passengers: { seats: unknown[]; extraBags: number }[];
        paymentOptions: { hold: unknown; installments: unknown } | null;
      };
      accessToken: string;
    };
    expect(booking.price.seats).toEqual([
      { flight: 0, designator: window.designator, passengerPosition: 0, amount: window.price },
      { flight: 0, designator: middle.designator, passengerPosition: 1, amount: middle.price },
    ]);
    expect(booking.price.total.amountMinor).toBe(
      quoted.offer.price.total.amountMinor + window.price.amountMinor,
    );
    // A seat is not a bag, and each traveller sees their own.
    expect(booking.price.extras).toEqual([]);
    expect(booking.passengers.map((passenger) => passenger.extraBags)).toEqual([0, 0]);
    expect(booking.passengers.map((passenger) => passenger.seats)).toEqual([
      [{ flight: 0, designator: window.designator }],
      [{ flight: 0, designator: middle.designator }],
    ]);
    // Like a paid bag, a chosen seat is never held unpaid or paid in installments.
    expect(booking.paymentOptions).toMatchObject({ hold: null, installments: null });

    const payment = await startPayment(booking.id, accessToken).expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();

    const confirmed = await ctx
      .http()
      .get(`/v1/bookings/${booking.id}`)
      .set('X-Booking-Token', accessToken)
      .expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(booked).toHaveBeenCalledTimes(1);
    const request = booked.mock.calls[0]?.[0];
    expect(request?.services).toEqual([]);
    expect(request?.seats?.map((seat) => ({ ...seat, price: Number(seat.price.minor) }))).toEqual([
      { flight: 0, designator: window.designator, passengerIndex: 0, price: 200_000 },
      { flight: 0, designator: middle.designator, passengerIndex: 1, price: 0 },
    ]);
    booked.mockRestore();
  });

  it('refuses a taken or unknown seat, a seat shared, two seats for one traveller and a seat for a lap infant', async () => {
    const quoted = await quote({ adults: 2, children: 0, infants: 1 });
    const seats = seatsOf(await seatMaps(quoted.quoteId));
    const [first, second] = seats.filter((seat) => seat.available);
    const taken = seats.find((seat) => !seat.available);
    if (!first || !second || !taken) throw new Error('the mock map has free and taken seats');
    const infant = adult({
      type: 'infant',
      title: 'miss',
      givenNames: 'Ada',
      dateOfBirth: addDays(today, -300),
    });
    // The infant is sent first; seats still follow the travellers, not the order sent.
    const travellers = [infant, adult(), adult({ givenNames: 'Ngozi', title: 'mrs' })];
    const refusal = async (chosen: unknown[]): Promise<string> => {
      const response = await book(quoted.quoteId, travellers, chosen).expect(422);
      expect(response.body.type).toBe('urn:suskii:problem:seats-invalid');
      return response.body.reason as string;
    };
    const choice = (passengerIndex: number, designator: string, flight = 0) => ({
      flight,
      passengerIndex,
      designator,
    });

    expect(await refusal([choice(1, taken.designator)])).toBe('seat_taken');
    expect(await refusal([choice(1, '99A')])).toBe('unknown_seat');
    expect(await refusal([choice(1, first.designator, 3)])).toBe('unknown_flight');
    expect(await refusal([choice(1, first.designator), choice(2, first.designator)])).toBe(
      'seat_chosen_twice',
    );
    expect(await refusal([choice(1, first.designator), choice(1, second.designator)])).toBe(
      'two_seats_one_traveller',
    );
    expect(await refusal([choice(0, first.designator)])).toBe('no_seat_for_infant');
    expect(await refusal([choice(7, first.designator)])).toBe('unknown_traveller');
    // A designator that is not a seat never reaches the airline.
    await book(quoted.quoteId, travellers, [choice(1, 'A1')]).expect(400);

    // The two adults in the order sent (after the infant) get their seats.
    const created = await book(quoted.quoteId, travellers, [
      choice(1, first.designator),
      choice(2, second.designator),
    ]).expect(201);
    expect(
      (created.body.booking.passengers as { type: string; seats: { designator: string }[] }[]).map(
        (passenger) => [passenger.type, passenger.seats.map((seat) => seat.designator)],
      ),
    ).toEqual([
      ['adult', [first.designator]],
      ['adult', [second.designator]],
      ['infant', []],
    ]);
  });

  it('checks the seat again right before payment and ends the booking when someone else took it', async () => {
    const quoted = await quote();
    const seat = seatsOf(await seatMaps(quoted.quoteId)).find((entry) => entry.available);
    if (!seat) throw new Error('the mock map has a free seat');
    const created = await book(
      quoted.quoteId,
      [adult()],
      [{ flight: 0, passengerIndex: 0, designator: seat.designator }],
    ).expect(201);
    const { id } = created.body.booking as { id: string };

    // A map that cannot be read charges nothing and leaves the booking as it was.
    const down = jest
      .spyOn(airline, 'seatMaps')
      .mockRejectedValueOnce(new SupplierUnavailableError('mock', 'Seat maps are down'));
    const later = await startPayment(id, created.body.accessToken as string).expect(503);
    expect(later.body.type).toBe('urn:suskii:problem:supplier-unavailable');
    down.mockRestore();
    expect(await ctx.prisma.payment.count({ where: { bookingId: id } })).toBe(0);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('PRICED');

    // Someone else takes the seat between checkout and payment.
    airline.takenSeats.add(`0:${seat.designator}`);
    const refused = await startPayment(id, created.body.accessToken as string).expect(410);
    expect(refused.body.type).toBe('urn:suskii:problem:offer-unavailable');
    // Nothing was charged and nothing is booked without the seat the traveller chose.
    expect(await ctx.prisma.payment.count({ where: { bookingId: id } })).toBe(0);
    const stored = await ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe('FAILED');
  });
});
