import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { bearer, enrolTotp, grantRoles, PASSWORD, signUp, totp } from './flows';
import type { TestContext } from './test-app';

/** Helpers shared by the Cars e2e suites (ADR-049 to ADR-053). */

let sequence = 0;
export const nextKey = (prefix: string): string => `${prefix}-${Date.now()}-${(sequence += 1)}`;

export const lagosToday = (): string => localDate(new Date(), 'Africa/Lagos');
export const inDays = (days: number): string => addDays(lagosToday(), days);

export const CONTACT = { email: 'traveller@example.com', phone: '+2348012345678' };

/** A bus or tour passenger: names, an adult date of birth, no passport (domestic trip). */
export const passenger = (givenNames: string, surname: string): Record<string, unknown> => ({
  type: 'adult',
  title: 'mr',
  gender: 'm',
  givenNames,
  surname,
  dateOfBirth: '1988-06-15',
  nationality: 'NG',
  document: null,
  travellerId: null,
});

/** A staff member signed in with MFA (admin routes need both). */
export async function staffSession(
  ctx: TestContext,
  email: string,
  roles: Parameters<typeof grantRoles>[2],
): Promise<{ userId: string; headers: Record<string, string> }> {
  const initial = await signUp(ctx, email);
  await grantRoles(ctx, initial.userId, roles);
  const { secret } = await enrolTotp(ctx, initial.accessToken);
  const pending = await ctx
    .http()
    .post('/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const verified = await ctx
    .http()
    .post('/v1/auth/mfa/verify')
    .send({ mfaToken: pending.body.mfaToken, code: totp(secret, 1) })
    .expect(200);
  return { userId: initial.userId, headers: bearer(verified.body.accessToken as string) };
}

export function book(
  ctx: TestContext,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return ctx
    .http()
    .post('/v1/bookings')
    .set('Idempotency-Key', nextKey('e2e-cars-book'))
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
}

/** Pays a booking in full through the mock provider's signed-webhook path. */
export async function payInFull(
  ctx: TestContext,
  bookingId: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const payment = await ctx
    .http()
    .post(`/v1/bookings/${bookingId}/payments`)
    .set('Idempotency-Key', nextKey('e2e-cars-pay'))
    .set(headers)
    .send({})
    .expect(201);
  const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
  await ctx
    .http()
    .post(`/v1/payments/mock/${reference}/complete`)
    .send({ outcome: 'succeeded' })
    .expect(200);
  await ctx.background.drain();
  const response = await ctx.http().get(`/v1/bookings/${bookingId}`).set(headers).expect(200);
  return response.body as Record<string, unknown>;
}

export interface BusInventory {
  operatorId: string;
  otherOperatorId: string;
  routeId: string;
  layoutId: string;
  tripId: string;
}

/** An operator with a Lagos to Ibadan route, a 2x2 coach and one departure, through the admin API. */
export async function busInventory(
  ctx: TestContext,
  staff: Record<string, string>,
  options: { departureInDays?: number; fareMinor?: number } = {},
): Promise<BusInventory> {
  const admin = (method: 'post' | 'patch', path: string, body: object) =>
    ctx.http()[method](`/v1/admin/${path}`).set(staff).send(body);
  const policy = [
    { daysBefore: 2, refundBps: 9_000 },
    { daysBefore: 0, refundBps: 0 },
  ];
  const operator = await admin('post', 'ground/operators', {
    slug: nextKey('lagoon').toLowerCase(),
    name: 'Lagoon Express',
    cancellationPolicy: policy,
  }).expect(201);
  const other = await admin('post', 'ground/operators', {
    slug: nextKey('savannah').toLowerCase(),
    name: 'Savannah Coaches',
    cancellationPolicy: policy,
  }).expect(201);
  for (const id of [operator.body.id as string, other.body.id as string]) {
    await admin('patch', `ground/operators/${id}`, { status: 'published' }).expect(204);
  }
  const terminal = async (name: string, city: string, state: string, lat: number, lng: number) =>
    (
      await admin('post', 'ground/terminals', {
        slug: nextKey(name).toLowerCase(),
        name,
        cityName: city,
        stateName: state,
        countryCode: 'NG',
        address: `${name} road`,
        lat,
        lng,
        timeZone: 'Africa/Lagos',
      }).expect(201)
    ).body.id as string;
  const originId = await terminal('jibowu', 'Lagos', 'Lagos', 6.5165, 3.3716);
  const destinationId = await terminal('challenge', 'Ibadan', 'Oyo', 7.3537, 3.8714);
  const route = await admin('post', 'ground/routes', {
    operatorId: operator.body.id,
    originId,
    destinationId,
    distanceKm: 128,
    durationMinutes: 150,
  }).expect(201);
  const rows = Array.from({ length: 10 }, (_, index) =>
    ['A', 'B', null, 'C', 'D'].map((cell) => (cell ? `${index + 1}${cell}` : null)),
  );
  const layout = await admin('post', 'ground/layouts', {
    operatorId: operator.body.id,
    name: 'Coach 2+2',
    layout: { rows },
    amenities: ['air_conditioning'],
  }).expect(201);
  const trip = await admin('post', 'ground/trips', {
    routeId: route.body.id,
    layoutId: layout.body.id,
    departsAtLocal: `${inDays(options.departureInDays ?? 5)}T07:00`,
    fareMinor: options.fareMinor ?? 850_000,
    currency: 'NGN',
  }).expect(201);
  return {
    operatorId: operator.body.id as string,
    otherOperatorId: other.body.id as string,
    routeId: route.body.id as string,
    layoutId: layout.body.id as string,
    tripId: trip.body.id as string,
  };
}
