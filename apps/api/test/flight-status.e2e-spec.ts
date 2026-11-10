import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { FLIGHT_STATUS } from '../src/flight-status/flight-status.module';
import type { MockFlightStatusProvider } from '../src/flight-status/flight-status.provider';

import { E2E_TURNSTILE } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * Live flight status and delay alerts (ADR-095): a ticketed flight is followed from before it
 * leaves, a traveller reads the last status with their booking, and the sweep tells them once
 * of a delay, of a change to it and of a cancellation. The mock provider stands in for a
 * flight-data account; its rules are the test's hooks.
 */

const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const today = localDate(new Date(), 'Africa/Lagos');
let keySequence = 0;
const idempotencyKey = (): string => `e2e-flight-status-${Date.now()}-${(keySequence += 1)}`;

interface StatusFlight {
  flight: number;
  carrier: { code: string };
  flightNumber: string;
  origin: { code: string };
  destination: { code: string };
  scheduledDepartureLocal: string;
  state: string;
  estimatedDepartureLocal: string | null;
  delayMinutes: number;
  departureGate: string | null;
  departureTerminal: string | null;
  checkedAt: string | null;
}
interface Status {
  live: boolean;
  flights: StatusFlight[];
}

const contact = { email: 'status@example.com', phone: '+2348012345678' };
const traveller = {
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames: 'Chioma',
  surname: 'Okafor',
  dateOfBirth: '1990-04-01',
  nationality: 'NG',
};

/** Books and pays tomorrow's first direct Lagos to Abuja flight as a guest. */
async function confirmedFlight(ctx: TestContext): Promise<{ id: string; token: string }> {
  const search = await ctx
    .http()
    .post('/v1/flights/searches')
    .send({
      slices: [{ origin: 'LOS', destination: 'ABV', departureDate: addDays(today, 1) }],
      passengers: { adults: 1, children: 0, infants: 0 },
      cabinClass: 'economy',
    })
    .expect(200);
  const direct = (search.body.offers as { id: string; slices: { stops: number }[] }[]).find(
    (offer) => offer.slices[0]?.stops === 0,
  );
  const quoted = await ctx
    .http()
    .post(`/v1/flights/offers/${direct?.id ?? ''}/quote`)
    .expect(201);
  const created = await ctx
    .http()
    .post('/v1/bookings')
    .set('Idempotency-Key', idempotencyKey())
    .send({
      quoteId: quoted.body.quoteId as string,
      passengers: [traveller],
      contact,
      termsVersion: BOOKING_TERMS_VERSION,
      acceptTerms: true,
      turnstileToken: E2E_TURNSTILE,
    })
    .expect(201);
  const id = (created.body.booking as { id: string }).id;
  const token = created.body.accessToken as string;
  const payment = await ctx
    .http()
    .post(`/v1/bookings/${id}/payments`)
    .set('Idempotency-Key', idempotencyKey())
    .set('X-Booking-Token', token)
    .expect(201);
  const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
  await ctx
    .http()
    .post(`/v1/payments/mock/${reference}/complete`)
    .send({ outcome: 'succeeded' })
    .expect(200);
  await ctx.background.drain();
  const booking = await ctx.http().get(`/v1/bookings/${id}`).set('X-Booking-Token', token);
  expect(booking.body.status).toBe('CONFIRMED');
  return { id, token };
}

describe('live flight status (e2e)', () => {
  let ctx: TestContext;
  let provider: MockFlightStatusProvider;

  beforeAll(async () => {
    // Three days, so that tomorrow's flight is followed whatever the time of day.
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      FLIGHT_STATUS_PROVIDER: 'mock',
      FLIGHT_STATUS_WINDOW_HOURS: 72,
    });
    provider = ctx.app.get<MockFlightStatusProvider>(FLIGHT_STATUS);
  });
  beforeEach(async () => {
    await resetState(ctx);
    provider.flights.clear();
    provider.asked.length = 0;
    provider.failNext = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  const status = async (id: string, token: string): Promise<Status> =>
    (
      await ctx
        .http()
        .get(`/v1/bookings/${id}/flight-status`)
        .set('X-Booking-Token', token)
        .expect(200)
    ).body as Status;
  const item = (bookingId: string) =>
    ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId } });
  /** One run of the sweep with the booking due, as the worker would make it. */
  async function sweep(bookingId: string) {
    await ctx.prisma.bookingItem.updateMany({
      where: { bookingId },
      data: { nextStatusCheckAt: new Date(Date.now() - 1000) },
    });
    const run = await ctx
      .http()
      .post('/v1/internal/bookings/flight-status-due')
      .set(INTERNAL)
      .expect(200);
    await ctx.background.drain();
    return run.body as { checked: number; alerts: number; failed: number };
  }
  const alertsSent = () => ctx.emails.outbox.filter((email) => email.template === 'flight-status');

  it('follows a ticketed flight and shows its status with the booking', async () => {
    const { id, token } = await confirmedFlight(ctx);
    // Ticketing booked the first reading, a few minutes from now for a flight this close.
    const due = (await item(id)).nextStatusCheckAt;
    expect(due).not.toBeNull();
    expect(due?.getTime()).toBeGreaterThan(Date.now());
    expect(due?.getTime()).toBeLessThan(Date.now() + 16 * 60_000);

    const read = await status(id, token);
    expect(read.live).toBe(true);
    expect(read.flights).toHaveLength(1);
    const [flight] = read.flights;
    expect(flight).toMatchObject({
      flight: 0,
      origin: { code: 'LOS' },
      destination: { code: 'ABV' },
      state: 'scheduled',
      delayMinutes: 0,
    });
    expect(flight?.estimatedDepartureLocal).toBe(flight?.scheduledDepartureLocal);
    expect(flight?.departureGate).toMatch(/^[A-D]\d{1,2}$/);
    expect(flight?.checkedAt).not.toBeNull();

    // The provider is asked about the flight and nothing else: no traveller, no booking.
    expect(provider.asked).toHaveLength(1);
    expect(Object.keys(provider.asked[0] ?? {}).sort()).toEqual([
      'carrier',
      'departureDate',
      'destination',
      'flightNumber',
      'origin',
      'scheduledArrivalUtc',
      'scheduledDepartureUtc',
    ]);
    // A second look within the cache time costs no provider call.
    expect(await status(id, token)).toEqual(read);
    expect(provider.asked).toHaveLength(1);

    // Only the traveller reads it.
    await ctx.http().get(`/v1/bookings/${id}/flight-status`).expect(404);
    await ctx
      .http()
      .get(`/v1/bookings/${id}/flight-status`)
      .set('X-Booking-Token', 'not-the-token-not-the-token-not-the-token')
      .expect(404);
  });

  it('tells the traveller of a delay once, of a change to it and of a cancellation', async () => {
    const { id, token } = await confirmedFlight(ctx);
    const [booked] = (await status(id, token)).flights;
    if (!booked) throw new Error('the booking has a flight');
    const key = `${booked.carrier.code}${booked.flightNumber}`;
    ctx.emails.outbox.length = 0;

    // On time: a sweep reads the flight and says nothing.
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 0, failed: 0 });
    expect(alertsSent()).toHaveLength(0);

    // 45 minutes late: one alert, with the new time on the booking.
    provider.flights.set(key, { delayMinutes: 45 });
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 1, failed: 0 });
    expect(alertsSent()).toHaveLength(1);
    const [delayed] = alertsSent();
    expect(delayed?.to).toBe(contact.email);
    expect(delayed?.subject).toMatch(/^Your flight is delayed: /);
    expect(delayed?.text).toContain(
      `${booked.carrier.code} ${booked.flightNumber} from Lagos (LOS)`,
    );
    expect(delayed?.text).toContain('45 minutes after the scheduled');
    const late = (await status(id, token)).flights[0];
    expect(late).toMatchObject({ state: 'delayed', delayMinutes: 45 });
    expect(late?.estimatedDepartureLocal).not.toBe(late?.scheduledDepartureLocal);

    // The same delay, or one a few minutes longer, is not told again.
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 0, failed: 0 });
    provider.flights.set(key, { delayMinutes: 50 });
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 0, failed: 0 });
    expect(alertsSent()).toHaveLength(1);

    // A much longer one is, and so is one that shrinks: the traveller must not come late.
    provider.flights.set(key, { delayMinutes: 120 });
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 1, failed: 0 });
    expect(alertsSent().at(-1)?.text).toContain('2 hours after the scheduled');
    provider.flights.set(key, { delayMinutes: 60 });
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 1, failed: 0 });
    expect(alertsSent().at(-1)?.subject).toMatch(/^Your flight now leaves earlier: /);

    // Back on time, then a new gate.
    provider.flights.set(key, {});
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 1, failed: 0 });
    expect(alertsSent().at(-1)?.subject).toMatch(/^Your flight is back on time: /);
    provider.flights.set(key, { departureGate: 'Z9' });
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 1, failed: 0 });
    expect(alertsSent().at(-1)?.subject).toMatch(/^Your departure gate has changed: /);
    expect(alertsSent().at(-1)?.text).toContain('Gate Z9');
    expect((await status(id, token)).flights[0]?.departureGate).toBe('Z9');

    // Cancelled: told once, and the flight is not asked about again.
    provider.flights.set(key, { state: 'cancelled' });
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 1, failed: 0 });
    expect(alertsSent().at(-1)?.subject).toMatch(/^Your flight has been cancelled: /);
    expect((await status(id, token)).flights[0]).toMatchObject({ state: 'cancelled' });
    expect((await item(id)).nextStatusCheckAt).toBeNull();
    const sent = alertsSent().length;
    const asked = provider.asked.length;
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 0, failed: 0 });
    expect(alertsSent()).toHaveLength(sent);
    expect(provider.asked).toHaveLength(asked);
    // No alert names the traveller.
    expect(alertsSent().every((email) => !email.text.includes('Chioma'))).toBe(true);
  });

  it('keeps the booked times when the provider cannot answer, and tries again later', async () => {
    const { id, token } = await confirmedFlight(ctx);
    provider.failNext = 1;
    const read = await status(id, token);
    expect(read.live).toBe(true);
    expect(read.flights[0]).toMatchObject({ state: 'scheduled', checkedAt: null });

    provider.failNext = 1;
    expect(await sweep(id)).toEqual({ checked: 0, alerts: 0, failed: 1 });
    // The trip stays due: the next check is a few minutes away, not never.
    expect((await item(id)).nextStatusCheckAt?.getTime()).toBeGreaterThan(Date.now());
    expect(await sweep(id)).toEqual({ checked: 1, alerts: 0, failed: 0 });
    expect((await status(id, token)).flights[0]?.checkedAt).not.toBeNull();
  });

  it('stops following a booking that is no longer confirmed', async () => {
    const { id } = await confirmedFlight(ctx);
    await ctx.prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } });
    expect(await sweep(id)).toEqual({ checked: 0, alerts: 0, failed: 0 });
    expect((await item(id)).nextStatusCheckAt).toBeNull();
    expect(provider.asked).toHaveLength(0);
  });
});

describe('live flight status switched off (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('shows the booked times, follows nothing and sends nothing', async () => {
    const { id, token } = await confirmedFlight(ctx);
    expect(
      (await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId: id } }))
        .nextStatusCheckAt,
    ).toBeNull();
    const read = await ctx
      .http()
      .get(`/v1/bookings/${id}/flight-status`)
      .set('X-Booking-Token', token)
      .expect(200);
    expect(read.body.live).toBe(false);
    expect(read.body.flights).toHaveLength(1);
    expect(read.body.flights[0]).toMatchObject({ state: 'scheduled', checkedAt: null });

    const run = await ctx
      .http()
      .post('/v1/internal/bookings/flight-status-due')
      .set(INTERNAL)
      .expect(200);
    expect(run.body).toEqual({ checked: 0, alerts: 0, failed: 0 });
  });
});
