import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';

import { bearer, enrolTotp, grantRoles, PASSWORD, signUp, totp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * Verified reviews (ADR-077): only someone who holds the booking reviews a finished trip, once
 * per item and within the window; reviews wait for a moderator; published ones make up the
 * subject's verified score, which hotel results carry across suppliers; invitations go out once,
 * the morning after the trip.
 */

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });

let keySequence = 0;
const idempotencyKey = (): string => `e2e-reviews-${Date.now()}-${(keySequence += 1)}`;

const contact = { email: 'funmi@example.com', phone: '+2348012345678' };
const person = (givenNames: string, surname: string) => ({
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames,
  surname,
  dateOfBirth: '1990-04-01',
  nationality: 'NG',
  document: {
    number: `A${Math.floor(Math.random() * 1e7)}`,
    issuingCountry: 'NG',
    expiryDate: inDays(3650),
  },
});
const policy = [
  { daysBefore: 7, refundBps: 10_000 },
  { daysBefore: 0, refundBps: 0 },
];

describe('verified reviews (e2e)', () => {
  let ctx: TestContext;
  let moderator: Record<string, string>;
  let lagosId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    moderator = await staff('reviews@suskii.test', ['content_manager', 'operations']);
    lagosId = (
      await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Lagos', countryCode: 'NG' } })
    ).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function staff(
    email: string,
    roles: Parameters<typeof grantRoles>[2],
  ): Promise<Record<string, string>> {
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
    return bearer(verified.body.accessToken as string);
  }

  async function tour(): Promise<{ tourId: string; departureId: string }> {
    const slug = `lagos-walk-${(keySequence += 1)}`;
    const created = await ctx
      .http()
      .post('/v1/admin/tours')
      .set(moderator)
      .send({
        slug,
        title: 'Lagos walking tour',
        summary: 'Markets and history on foot.',
        cityId: lagosId,
        timeZone: 'Africa/Lagos',
        durationMinutes: 180,
        meetingPoint: { name: 'Tafawa Balewa Square', address: 'Lagos Island', notes: null },
        cancellationPolicy: policy,
      })
      .expect(201);
    const tourId = created.body.id as string;
    const departure = await ctx
      .http()
      .post(`/v1/admin/tours/${tourId}/departures`)
      .set(moderator)
      .send({
        startsAtLocal: `${inDays(10)}T09:00`,
        capacity: 8,
        prices: { adult: ngn(30_000), child: null, infant: null },
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/v1/admin/tours/${tourId}`)
      .set(moderator)
      .send({ status: 'published' })
      .expect(204);
    return { tourId, departureId: departure.body.id as string };
  }

  function book(body: Record<string, unknown>, headers: Record<string, string> = {}) {
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

  async function pay(bookingId: string, access: Record<string, string>): Promise<void> {
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(access)
      .send({})
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const booking = await ctx.http().get(`/v1/bookings/${bookingId}`).set(access).expect(200);
    expect(booking.body.status).toBe('CONFIRMED');
  }

  /** A confirmed tour booking; `access` is the guest token, or the account's bearer token. */
  async function bookedTour(account?: Record<string, string>) {
    const { tourId, departureId } = await tour();
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({ kind: 'tour', departureId, travellers: { adults: 1, children: 0, infants: 0 } })
      .expect(201);
    const created = await book(
      { quoteId: quote.body.quoteId, passengers: [person('FUNMI', 'BELLO')] },
      account,
    ).expect(201);
    const bookingId = created.body.booking.id as string;
    const access = account ?? { 'X-Booking-Token': created.body.accessToken as string };
    await pay(bookingId, access);
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId } });
    return { tourId, bookingId, itemId: item.id, access };
  }

  /** Moves a tour item's date, as if the booking had been made for another day. */
  async function tourOn(itemId: string, date: string): Promise<void> {
    await ctx.prisma.$executeRaw`
      UPDATE booking_items
         SET payload = jsonb_set(payload, '{startsAtLocal}', to_jsonb(${`${date}T09:00`}::text))
       WHERE id = ${itemId}::uuid`;
  }

  const review = {
    rating: 9,
    title: 'A guide who knew every street',
    liked: 'Balogun market at its busiest. Call me on +234 801 234 5678 for tips.',
    disliked: '',
    tripType: 'couple',
    showName: true,
  };

  const reviewPath = (bookingId: string, itemId: string) =>
    `/v1/bookings/${bookingId}/items/${itemId}/review`;

  it('lets the booking holder review a finished trip, once a moderator agrees', async () => {
    const { tourId, bookingId, itemId, access } = await bookedTour();

    // Before the trip: listed, but not open yet.
    const before = await ctx
      .http()
      .get(`/v1/bookings/${bookingId}/reviews`)
      .set(access)
      .expect(200);
    expect(before.body.items).toEqual([
      {
        itemId,
        kind: 'tour',
        name: 'Lagos walking tour',
        endsOn: inDays(10),
        canReview: false,
        windowEndsOn: addDays(inDays(10), 90),
        review: null,
      },
    ]);
    const early = await ctx.http().put(reviewPath(bookingId, itemId)).set(access).send(review);
    expect(early.status).toBe(409);
    expect(early.body.type).toContain('review-not-eligible');

    await tourOn(itemId, inDays(-2));

    // Only the booking's holder: no token, or someone else's account, gets 404.
    await ctx.http().get(`/v1/bookings/${bookingId}/reviews`).expect(404);
    await ctx.http().put(reviewPath(bookingId, itemId)).send(review).expect(404);
    const stranger = await signUp(ctx, 'stranger@example.com');
    await ctx
      .http()
      .put(reviewPath(bookingId, itemId))
      .set(bearer(stranger.accessToken))
      .send(review)
      .expect(404);
    await ctx
      .http()
      .put(reviewPath(bookingId, '0192f0aa-0000-7000-8000-000000000000'))
      .set(access)
      .send(review)
      .expect(404);
    await ctx
      .http()
      .put(reviewPath(bookingId, itemId))
      .set(access)
      .send({ ...review, rating: 11 })
      .expect(400);

    const written = await ctx
      .http()
      .put(reviewPath(bookingId, itemId))
      .set(access)
      .send(review)
      .expect(200);
    expect(written.body).toMatchObject({
      status: 'pending',
      rating: 9,
      disliked: null,
      tripType: 'couple',
      showName: true,
      publishedAt: null,
    });
    // Changed while it waits; still one review.
    await ctx
      .http()
      .put(reviewPath(bookingId, itemId))
      .set(access)
      .send({ ...review, rating: 8 })
      .expect(200);
    expect(await ctx.prisma.review.count()).toBe(1);

    // Nothing public before moderation.
    const hidden = await ctx.http().get(`/v1/reviews?kind=tour&ref=${tourId}`).expect(200);
    expect(hidden.body).toEqual({ summary: null, items: [], nextCursor: null });

    // The queue: waiting reviews with what the text was flagged for.
    const customer = await signUp(ctx, 'shopper@example.com');
    await ctx.http().get('/v1/admin/reviews').set(bearer(customer.accessToken)).expect(403);
    const queue = await ctx.http().get('/v1/admin/reviews').set(moderator).expect(200);
    expect(queue.body.items).toEqual([
      expect.objectContaining({
        id: written.body.id,
        status: 'pending',
        rating: 8,
        subject: { id: expect.any(String), kind: 'tour', name: 'Lagos walking tour' },
        displayName: 'Funmi B.',
        flags: ['contact_details'],
        bookingReference: expect.any(String),
      }),
    ]);

    const published = await ctx
      .http()
      .post(`/v1/admin/reviews/${written.body.id as string}/publish`)
      .set(moderator)
      .expect(200);
    expect(published.body).toMatchObject({ status: 'published', moderatedAt: expect.any(String) });
    await ctx
      .http()
      .post(`/v1/admin/reviews/${written.body.id as string}/publish`)
      .set(moderator)
      .expect(409);

    const page = await ctx.http().get(`/v1/reviews?kind=tour&ref=${tourId}`).expect(200);
    expect(page.body.summary).toEqual({ subjectId: expect.any(String), score: 8, count: 1 });
    expect(page.body.items).toEqual([
      {
        id: written.body.id,
        rating: 8,
        title: 'A guide who knew every street',
        liked: review.liked,
        disliked: null,
        tripType: 'couple',
        displayName: 'Funmi B.',
        locale: 'en-NG',
        travelledOn: inDays(-2).slice(0, 7),
        publishedAt: expect.any(String),
      },
    ]);
    await ctx
      .http()
      .get(`/v1/reviews?subject=${page.body.summary.subjectId as string}`)
      .expect(200)
      .expect((response) => expect(response.body.items).toHaveLength(1));

    // Decided: it can be withdrawn, not changed.
    const closed = await ctx
      .http()
      .put(reviewPath(bookingId, itemId))
      .set(access)
      .send({ ...review, rating: 2 })
      .expect(409);
    expect(closed.body.type).toContain('review-closed');

    const audit = await ctx.prisma.auditLog.findMany({
      where: {
        action: { in: ['review.submitted', 'review.published'] },
        targetId: written.body.id as string,
      },
      select: { action: true, metadata: true },
    });
    expect(audit.map((entry) => entry.action).sort()).toEqual([
      'review.published',
      'review.submitted',
    ]);
    // Ids only in the audit log, never the text.
    expect(JSON.stringify(audit)).not.toContain('Balogun');

    await ctx.http().delete(reviewPath(bookingId, itemId)).set(access).expect(204);
    await ctx.http().delete(reviewPath(bookingId, itemId)).set(access).expect(404);
    const after = await ctx.http().get(`/v1/reviews?kind=tour&ref=${tourId}`).expect(200);
    expect(after.body).toEqual({ summary: null, items: [], nextCursor: null });
  });

  it('rejects with a reason, keeps the name back on request, and closes the window', async () => {
    const account = await signUp(ctx, 'member@example.com');
    const { tourId, bookingId, itemId, access } = await bookedTour(bearer(account.accessToken));
    await tourOn(itemId, inDays(-1));

    const written = await ctx
      .http()
      .put(reviewPath(bookingId, itemId))
      .set(access)
      .send({ ...review, liked: 'Lovely', showName: false })
      .expect(200);
    expect(written.body.showName).toBe(false);
    const queued = await ctx.prisma.review.findUniqueOrThrow({ where: { id: written.body.id } });
    expect(queued).toMatchObject({ displayName: null, userId: account.userId, flags: [] });

    await ctx
      .http()
      .post(`/v1/admin/reviews/${written.body.id as string}/reject`)
      .set(moderator)
      .send({ reason: 'off_topic' })
      .expect(200)
      .expect((response) =>
        expect(response.body).toMatchObject({ status: 'rejected', rejectReason: 'off_topic' }),
      );
    const mine = await ctx.http().get(`/v1/bookings/${bookingId}/reviews`).set(access).expect(200);
    expect(mine.body.items[0].review).toMatchObject({ status: 'rejected' });
    const page = await ctx.http().get(`/v1/reviews?kind=tour&ref=${tourId}`).expect(200);
    expect(page.body.summary).toBeNull();
    const decided = await ctx
      .http()
      .get('/v1/admin/reviews?status=rejected')
      .set(moderator)
      .expect(200);
    expect(decided.body.items).toHaveLength(1);

    // Rejected reviews are purged after 90 days.
    await ctx.prisma.review.update({
      where: { id: written.body.id as string },
      data: { moderatedAt: new Date(Date.now() - 91 * 86_400_000) },
    });
    const swept = await ctx.http().post('/v1/internal/retention/run').set(INTERNAL).expect(200);
    expect(swept.body['rejected-reviews']).toBe(1);

    // The window closes 90 days after the trip.
    await tourOn(itemId, inDays(-91));
    await ctx.http().put(reviewPath(bookingId, itemId)).set(access).send(review).expect(409);
  });

  it('invites once, the morning after the trip: guests by email, members by preference', async () => {
    const guest = await bookedTour();
    const member = await signUp(ctx, 'member@example.com');
    const owned = await bookedTour(bearer(member.accessToken));
    const upcoming = await bookedTour();
    await tourOn(guest.itemId, inDays(-2));
    await tourOn(owned.itemId, inDays(-3));
    ctx.emails.outbox.length = 0;

    await ctx.http().post('/v1/internal/reviews/invitations/run').expect(401);
    const run = await ctx
      .http()
      .post('/v1/internal/reviews/invitations/run')
      .set(INTERNAL)
      .expect(200);
    expect(run.body).toEqual({ planned: 3, sent: 2, skipped: 0 });

    const planned = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: upcoming.bookingId },
    });
    expect(planned.reviewInvitedAt).toBeNull();
    expect(planned.reviewInviteAt?.toISOString()).toBe(`${inDays(11)}T08:00:00.000Z`);

    const invitations = ctx.emails.outbox.filter(
      (message) => message.template === 'review-invitation',
    );
    expect(invitations.map((message) => message.to).sort()).toEqual([
      'funmi@example.com',
      'member@example.com',
    ]);
    const toGuest = invitations.find((message) => message.to === 'funmi@example.com');
    // Guests get a link that opens their booking; members sign in.
    expect(toGuest?.text).toContain('#access=');
    expect(toGuest?.text).toContain('Lagos walking tour');
    expect(invitations.find((message) => message.to === 'member@example.com')?.text).not.toContain(
      '#access=',
    );
    expect(
      await ctx.prisma.notification.count({
        where: { userId: member.userId, category: 'review_requests' },
      }),
    ).toBeGreaterThan(0);

    // Never twice.
    const again = await ctx
      .http()
      .post('/v1/internal/reviews/invitations/run')
      .set(INTERNAL)
      .expect(200);
    expect(again.body).toEqual({ planned: 0, sent: 0, skipped: 0 });
  });

  it('shows the verified score on hotel results, whichever supplier lists the hotel', async () => {
    const cityId =
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LOS' } })).cityId ?? '';
    const search = (checkIn: string) =>
      ctx
        .http()
        .post('/v1/hotels/searches')
        .send({
          destination: { type: 'city', cityId },
          checkIn,
          checkOut: addDays(checkIn, 2),
          rooms: [{ adults: 1, childAges: [] }],
        })
        .expect(200);
    const first = await search(inDays(20));
    const hotel = first.body.hotels[0] as { name: string; verifiedReviews: unknown };
    expect(hotel.verifiedReviews).toBeNull();
    const quote = await ctx
      .http()
      .post(`/v1/hotels/rates/${first.body.hotels[0].cheapestRate.id as string}/quote`)
      .expect(201);
    const created = await book({
      quoteId: quote.body.quoteId,
      guests: [{ givenNames: 'Ngozi', surname: 'Eze' }],
    }).expect(201);
    const bookingId = created.body.booking.id as string;
    const access = { 'X-Booking-Token': created.body.accessToken as string };
    await pay(bookingId, access);
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId } });
    await ctx.prisma.$executeRaw`
      UPDATE booking_items
         SET payload = jsonb_set(jsonb_set(payload, '{request,checkIn}', to_jsonb(${inDays(-4)}::text)),
                                 '{request,checkOut}', to_jsonb(${inDays(-2)}::text))
       WHERE id = ${item.id}::uuid`;

    const written = await ctx
      .http()
      .put(reviewPath(bookingId, item.id))
      .set(access)
      .send({ ...review, rating: 7 })
      .expect(200);
    await ctx
      .http()
      .post(`/v1/admin/reviews/${written.body.id as string}/publish`)
      .set(moderator)
      .expect(200);

    // A new search (other dates) lists the same hotel with its verified score.
    const later = await search(inDays(40));
    const again = (
      later.body.hotels as { name: string; id: string; verifiedReviews: unknown }[]
    ).find((candidate) => candidate.name === hotel.name);
    expect(again?.verifiedReviews).toEqual({ subjectId: expect.any(String), score: 7, count: 1 });
    const detail = await ctx
      .http()
      .get(`/v1/hotels/results/${again?.id ?? ''}`)
      .expect(200);
    expect(detail.body.verifiedReviews).toEqual(again?.verifiedReviews);
  });
});
