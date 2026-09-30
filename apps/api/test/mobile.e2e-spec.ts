import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { type MockPushProvider, PushProvider } from '../src/notifications/push';
import { PricingService } from '../src/pricing/pricing.service';

import { bearer, login, PASSWORD, signUp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  WEB_ORIGIN,
  type TestContext,
} from './helpers/test-app';

/**
 * Phase 7 API for the mobile app (ADR-020 to ADR-023): the Trips list, push tokens and delivery,
 * device attestation as the mobile guest bot check and on sensitive routes, and the payment
 * return through the web.
 */

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const MOBILE = { 'X-Suskii-Client': 'mobile-android/1.0.0' };
const WEB = { 'X-Suskii-Client': 'web/1.0.0' };
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const DEVICE_A = 'ExponentPushToken[device-aaaaaaaaaaaa]';
const DEVICE_B = 'ExponentPushToken[device-bbbbbbbbbbbb]';

let keySequence = 0;
const idempotencyKey = (): string => `e2e-mobile-${Date.now()}-${(keySequence += 1)}`;

const contact = { email: 'amaka@example.com', phone: '+2348012345678' };
const adult = {
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames: 'Amaka',
  surname: 'Obi',
  dateOfBirth: '1992-05-06',
  nationality: 'NG',
  document: null,
};

describe('mobile (e2e): trips, push, attestation and the app payment return', () => {
  let ctx: TestContext;
  let push: MockPushProvider;

  beforeAll(async () => {
    ctx = await createTestApp();
    push = ctx.app.get<PushProvider, MockPushProvider>(PushProvider);
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    push.outbox.length = 0;
    push.unregistered.clear();
    ctx.config.ATTESTATION_MODE = 'off';
  });
  afterAll(() => ctx.close());

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function quote(slices: { origin: string; destination: string; departureDate: string }[]) {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({ slices, passengers: { adults: 1, children: 0, infants: 0 }, cabinClass: 'economy' })
      .expect(200);
    const offer = (search.body.offers as { id: string }[])[0];
    const created = await ctx.http().post(`/v1/flights/offers/${offer?.id}/quote`).expect(201);
    return created.body.quoteId as string;
  }

  const oneWay = () => quote([{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }]);

  async function challenge(): Promise<string> {
    const response = await ctx.http().post('/v1/attestation/challenges').expect(201);
    expect(Date.parse(response.body.expiresAt as string)).toBeGreaterThan(Date.now());
    return response.body.challenge as string;
  }

  const attestation = (value: string, token = `mock:${value}`): string =>
    Buffer.from(
      JSON.stringify({ v: 1, platform: 'android', kind: 'integrity', challenge: value, token }),
    ).toString('base64url');

  function createBooking(
    quoteId: string,
    headers: Record<string, string>,
    turnstileToken: string | null = null,
  ) {
    return ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .set(headers)
      .send({
        quoteId,
        contact,
        passengers: [adult],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken,
      });
  }

  async function payAndConfirm(bookingId: string, headers: Record<string, string>) {
    const started = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(headers)
      .send({})
      .expect(201);
    const reference = (started.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const booking = await ctx.http().get(`/v1/bookings/${bookingId}`).set(headers).expect(200);
    expect(booking.body.status).toBe('CONFIRMED');
    return reference;
  }

  // -------------------------------------------------------------------------
  // Trips
  // -------------------------------------------------------------------------

  it('lists only the account trips, newest first, a page at a time, without traveller data', async () => {
    const amaka = await signUp(ctx, 'amaka@example.com');
    const other = await signUp(ctx, 'other@example.com');
    const auth = { ...MOBILE, ...bearer(amaka.accessToken) };
    const first = await createBooking(await oneWay(), auth).expect(201);
    const roundTrip = await quote([
      { origin: 'LOS', destination: 'ABV', departureDate: inDays(40) },
      { origin: 'ABV', destination: 'LOS', departureDate: inDays(45) },
    ]);
    const second = await createBooking(roundTrip, auth).expect(201);
    const multi = await quote([
      { origin: 'LOS', destination: 'ABV', departureDate: inDays(50) },
      { origin: 'ABV', destination: 'PHC', departureDate: inDays(55) },
    ]);
    const third = await createBooking(multi, auth).expect(201);
    await createBooking(await oneWay(), { ...MOBILE, ...bearer(other.accessToken) }).expect(201);

    const page = await ctx
      .http()
      .get('/v1/me/bookings?limit=2')
      .set(bearer(amaka.accessToken))
      .expect(200);
    expect(page.body.bookings.map((trip: { id: string }) => trip.id)).toEqual([
      third.body.booking.id,
      second.body.booking.id,
    ]);
    expect(page.body.bookings[0]).toMatchObject({
      status: 'PRICED',
      vertical: 'flights',
      startsOn: inDays(50),
      endsOn: inDays(55),
      flight: { tripType: 'multi_city', origin: { code: 'LOS' }, destination: { code: 'PHC' } },
      hotel: null,
    });
    expect(page.body.bookings[1]).toMatchObject({
      flight: { tripType: 'round_trip', origin: { code: 'LOS' }, destination: { code: 'ABV' } },
    });
    expect(JSON.stringify(page.body)).not.toMatch(/Amaka|Obi|amaka@/);

    const next = await ctx
      .http()
      .get(`/v1/me/bookings?limit=2&cursor=${page.body.nextCursor as string}`)
      .set(bearer(amaka.accessToken))
      .expect(200);
    expect(next.body).toMatchObject({
      bookings: [{ id: first.body.booking.id, endsOn: null, flight: { tripType: 'one_way' } }],
      nextCursor: null,
    });
    await ctx.http().get('/v1/me/bookings').expect(401);
  });

  // -------------------------------------------------------------------------
  // Attestation
  // -------------------------------------------------------------------------

  it('lets a mobile guest check out with a device attestation instead of Turnstile, once', async () => {
    const quoteId = await oneWay();
    const value = await challenge();
    const header = { ...MOBILE, 'X-Suskii-Attestation': attestation(value) };
    const created = await createBooking(quoteId, header).expect(201);
    expect(created.body.accessToken).toEqual(expect.any(String));

    // The challenge was consumed: the same header cannot vouch for another booking.
    const replay = await createBooking(quoteId, header).expect(400);
    expect(replay.body.type).toContain('bot-check-failed');
    // A token bound to another challenge, or no proof at all, fails the same way.
    const other = await challenge();
    await createBooking(quoteId, {
      ...MOBILE,
      'X-Suskii-Attestation': attestation(other, `mock:${'x'.repeat(43)}`),
    }).expect(400);
    await createBooking(quoteId, MOBILE).expect(400);
    await createBooking(quoteId, { ...MOBILE, 'X-Suskii-Attestation': 'garbage' }).expect(400);
    // The web keeps using Turnstile.
    await createBooking(quoteId, WEB, 'e2e-turnstile').expect(201);
  });

  it('sends app payments back through the web return page', async () => {
    const quoteId = await oneWay();
    const created = await createBooking(quoteId, {
      ...MOBILE,
      'X-Suskii-Attestation': attestation(await challenge()),
    }).expect(201);
    const id = created.body.booking.id as string;
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const started = await ctx
      .http()
      .post(`/v1/bookings/${id}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set({ ...MOBILE, ...token })
      .send({})
      .expect(201);
    const reference = (started.body.checkoutUrl as string).split('/').pop() ?? '';
    const page = await ctx.http().get(`/v1/payments/mock/${reference}`).expect(200);
    expect(page.body.returnUrl).toBe(`${WEB_ORIGIN}/mobile/payment-return?booking=${id}`);
    const done = await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    expect(done.body.returnUrl).toBe(`${WEB_ORIGIN}/mobile/payment-return?booking=${id}`);

    const web = await createBooking(await oneWay(), WEB, 'e2e-turnstile').expect(201);
    const webStart = await ctx
      .http()
      .post(`/v1/bookings/${web.body.booking.id as string}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set({ ...WEB, 'X-Booking-Token': web.body.accessToken as string })
      .send({})
      .expect(201);
    const webPage = await ctx
      .http()
      .get(`/v1/payments/mock/${(webStart.body.checkoutUrl as string).split('/').pop() ?? ''}`)
      .expect(200);
    expect(webPage.body.returnUrl).toBe(`${WEB_ORIGIN}/bookings/${web.body.booking.id as string}`);
  });

  it('enforces attestation on mobile login and payment start only when configured', async () => {
    await signUp(ctx, 'amaka@example.com');
    const credentials = { email: 'amaka@example.com', password: PASSWORD };

    ctx.config.ATTESTATION_MODE = 'report';
    await ctx.http().post('/v1/auth/login').set(MOBILE).send(credentials).expect(200);

    ctx.config.ATTESTATION_MODE = 'enforce';
    const refused = await ctx.http().post('/v1/auth/login').set(MOBILE).send(credentials);
    expect(refused.status).toBe(403);
    expect(refused.body.type).toContain('attestation-required');
    // Build the header first: a request started inside the chain would reuse the test server.
    const attested = { ...MOBILE, 'X-Suskii-Attestation': attestation(await challenge()) };
    await ctx.http().post('/v1/auth/login').set(attested).send(credentials).expect(200);
    // Requests that do not claim to be the app are left to the other controls (ADR-023).
    const session = await ctx.http().post('/v1/auth/login').set(WEB).send(credentials).expect(200);

    const auth = bearer(session.body.accessToken as string);
    const created = await createBooking(await oneWay(), { ...MOBILE, ...auth }).expect(201);
    const pay = (headers: Record<string, string>) =>
      ctx
        .http()
        .post(`/v1/bookings/${created.body.booking.id as string}/payments`)
        .set('Idempotency-Key', idempotencyKey())
        .set({ ...MOBILE, ...auth, ...headers })
        .send({});
    await pay({}).expect(403);
    await pay({ 'X-Suskii-Attestation': attestation(await challenge()) }).expect(201);
  });

  // -------------------------------------------------------------------------
  // Push
  // -------------------------------------------------------------------------

  it('pushes booking events once per device to active account sessions and guest devices', async () => {
    const amaka = await signUp(ctx, 'amaka@example.com');
    const tablet = await login(ctx, 'amaka@example.com');
    const register = (token: string, device: string) =>
      ctx
        .http()
        .put('/v1/me/push-token')
        .set(bearer(token))
        .send({ token: device, platform: 'android' });
    await register(amaka.accessToken, DEVICE_A).expect(204);
    await register(amaka.accessToken, DEVICE_A).expect(204);
    await register(tablet.accessToken, DEVICE_B).expect(204);
    await register(amaka.accessToken, 'not-a-push-token').expect(400);
    await ctx
      .http()
      .put('/v1/me/push-token')
      .send({ token: DEVICE_A, platform: 'android' })
      .expect(401);

    const auth = { ...MOBILE, ...bearer(amaka.accessToken) };
    const created = await createBooking(await oneWay(), auth).expect(201);
    const id = created.body.booking.id as string;
    // The same phone also follows the booking itself: it still gets one push.
    await ctx
      .http()
      .put(`/v1/bookings/${id}/push-token`)
      .set(auth)
      .send({ token: DEVICE_A, platform: 'android' })
      .expect(204);
    await payAndConfirm(id, auth);
    expect(push.outbox.map((message) => message.to).sort()).toEqual([DEVICE_A, DEVICE_B]);
    const reference = created.body.booking.reference as string;
    for (const message of push.outbox) {
      expect(message).toMatchObject({
        title: `Booking ${reference} is confirmed`,
        path: `/trips/${id}`,
      });
      expect(`${message.title} ${message.body}`).not.toMatch(/Amaka|Obi|Lagos|Abuja|₦|NGN/);
    }
    const stored = await ctx.prisma.pushToken.findFirstOrThrow({
      where: { scope: { startsWith: 'session:' } },
    });
    expect(stored.tokenEncrypted).not.toContain('device-aaaa');

    // Signing out on the tablet stops its pushes; a device that uninstalled the app is forgotten.
    await ctx
      .http()
      .post('/v1/auth/logout')
      .send({ refreshToken: tablet.refreshToken })
      .expect(204);
    push.outbox.length = 0;
    push.unregistered.add(DEVICE_A);
    const again = await createBooking(await oneWay(), auth).expect(201);
    await payAndConfirm(again.body.booking.id as string, auth);
    expect(push.outbox).toEqual([]);
    expect(await ctx.prisma.pushToken.count({ where: { tokenHash: stored.tokenHash } })).toBe(0);
  });

  it('lets a guest follow their booking on this device, and nobody else', async () => {
    const created = await createBooking(await oneWay(), {
      ...MOBILE,
      'X-Suskii-Attestation': attestation(await challenge()),
    }).expect(201);
    const id = created.body.booking.id as string;
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const follow = (headers: Record<string, string>) =>
      ctx
        .http()
        .put(`/v1/bookings/${id}/push-token`)
        .set(headers)
        .send({ token: DEVICE_B, platform: 'ios' });
    await follow({}).expect(404);
    await follow({ 'X-Booking-Token': 'wrong-token-wrong-token' }).expect(404);
    await follow(token).expect(204);
    await payAndConfirm(id, { ...MOBILE, ...token });
    expect(push.outbox.map((message) => message.to)).toEqual([DEVICE_B]);
  });

  it('prunes push tokens of ended sessions', async () => {
    const amaka = await signUp(ctx, 'amaka@example.com');
    await ctx
      .http()
      .put('/v1/me/push-token')
      .set(bearer(amaka.accessToken))
      .send({ token: DEVICE_A, platform: 'android' })
      .expect(204);
    const kept = await login(ctx, 'amaka@example.com');
    await ctx
      .http()
      .put('/v1/me/push-token')
      .set(bearer(kept.accessToken))
      .send({ token: DEVICE_B, platform: 'android' })
      .expect(204);
    await ctx.http().post('/v1/auth/logout').send({ refreshToken: amaka.refreshToken }).expect(204);
    const run = await ctx.http().post('/v1/internal/push-tokens/prune').set(INTERNAL).expect(200);
    expect(run.body).toEqual({ deleted: 1 });
    expect(await ctx.prisma.pushToken.count()).toBe(1);

    await ctx.http().delete('/v1/me/push-token').set(bearer(kept.accessToken)).expect(204);
    expect(await ctx.prisma.pushToken.count()).toBe(0);
  });
});
