import { addDays, BOOKING_TERMS_VERSION, localDate, primeTermEnd } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';

import { bearer, enrolTotp, grantRoles, PASSWORD, signUp, totp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
let keySequence = 0;
const idempotencyKey = (): string => `e2e-prime-${Date.now()}-${(keySequence += 1)}`;

interface Money {
  amountMinor: number;
  currency: string;
}

describe('Suskii Prime (e2e): plans, purchase and member pricing', () => {
  let ctx: TestContext;
  let staffHeaders: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    staffHeaders = await staff('finance@example.com');
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function staff(email: string): Promise<Record<string, string>> {
    const initial = await signUp(ctx, email);
    await grantRoles(ctx, initial.userId, ['finance']);
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

  async function publishedPlan(
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; slug: string }> {
    const created = await ctx
      .http()
      .post('/v1/admin/prime/plans')
      .set(staffHeaders)
      .send({
        slug: 'prime-yearly',
        name: 'Suskii Prime Yearly',
        summary: 'Lower fares and no service fee for a year.',
        period: 'year',
        prices: [{ amountMinor: 2_500_000, currency: 'NGN' }],
        benefits: { markupShareBps: 5_000, waivedFeeCodes: ['service_fee'], prioritySupport: true },
        ...overrides,
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/v1/admin/prime/plans/${created.body.id as string}`)
      .set(staffHeaders)
      .send({ status: 'published' })
      .expect(200);
    return { id: created.body.id as string, slug: created.body.slug as string };
  }

  /** Quote, book and pay a membership; returns the confirmed booking body. */
  async function buy(accessToken: string, slug: string) {
    const auth = bearer(accessToken);
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .set(auth)
      .send({ kind: 'membership', planSlug: slug, currency: 'NGN' })
      .expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId,
        contact: { email: 'member@example.com', phone: '+2348012345678' },
        guests: [{ givenNames: 'Ngozi', surname: 'Eze' }],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      })
      .expect(201);
    const bookingId = created.body.booking.id as string;
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const booking = await ctx.http().get(`/v1/bookings/${bookingId}`).set(auth).expect(200);
    return { quote: quote.body, booking: booking.body };
  }

  async function pricingRules(): Promise<void> {
    await ctx.prisma.markupRule.create({
      data: { name: '10% flights', vertical: 'flights', type: 'percentage', value: 1000n },
    });
    await ctx.prisma.feeRule.create({
      data: {
        code: 'service_fee',
        label: 'Service fee',
        vertical: 'flights',
        type: 'fixed',
        value: 500_000n,
        currency: 'NGN',
        basis: 'per_booking',
      },
    });
    ctx.app.get(PricingService).invalidate();
  }

  const searchBody = {
    slices: [{ origin: 'LOS', destination: 'ABV', departureDate: addDays(today, 40) }],
    passengers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'economy',
  };

  it('sells only published plans, in the currencies they are priced in', async () => {
    const empty = await ctx.http().get('/v1/prime/plans').expect(200);
    expect(empty.body).toEqual({ plans: [] });

    const draft = await ctx
      .http()
      .post('/v1/admin/prime/plans')
      .set(staffHeaders)
      .send({
        slug: 'prime-monthly',
        name: 'Suskii Prime Monthly',
        summary: 'Member fares, month by month.',
        period: 'month',
        prices: [
          { amountMinor: 250_000, currency: 'NGN' },
          { amountMinor: 500, currency: 'USD' },
        ],
        benefits: { markupShareBps: 2_500, waivedFeeCodes: [], prioritySupport: false },
      })
      .expect(201);
    expect(draft.body).toMatchObject({ status: 'draft', activeMembers: 0, sample: false });
    const duplicate = await ctx
      .http()
      .post('/v1/admin/prime/plans')
      .set(staffHeaders)
      .send({
        slug: 'prime-monthly',
        name: 'Another',
        summary: 'Same slug.',
        period: 'month',
        prices: [{ amountMinor: 1, currency: 'NGN' }],
        benefits: { markupShareBps: 0, waivedFeeCodes: [], prioritySupport: false },
      })
      .expect(409);
    expect(duplicate.body.type).toBe('urn:suskii:problem:slug-taken');
    expect((await ctx.http().get('/v1/prime/plans').expect(200)).body.plans).toEqual([]);

    // Customers cannot manage plans.
    const customer = await signUp(ctx, 'customer@example.com');
    await ctx.http().get('/v1/admin/prime/plans').set(bearer(customer.accessToken)).expect(403);

    await ctx
      .http()
      .patch(`/v1/admin/prime/plans/${draft.body.id as string}`)
      .set(staffHeaders)
      .send({ status: 'published' })
      .expect(200);
    const listed = await ctx.http().get('/v1/prime/plans').query({ currency: 'USD' }).expect(200);
    expect(listed.body.plans).toEqual([
      expect.objectContaining({
        slug: 'prime-monthly',
        period: 'month',
        price: { amountMinor: 500, currency: 'USD' },
        benefits: { memberFares: true, waivedFeeCodes: [], prioritySupport: false },
      }),
    ]);
    // The margin share is internal.
    expect(JSON.stringify(listed.body)).not.toContain('markupShareBps');
    const ghs = await ctx.http().get('/v1/prime/plans').query({ currency: 'GHS' }).expect(200);
    expect(ghs.body.plans[0].price).toBeNull();
    await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .set(bearer(customer.accessToken))
      .send({ kind: 'membership', planSlug: 'prime-monthly', currency: 'GHS' })
      .expect(410);
  });

  it('buys a membership through the booking pipeline and extends it from the current end', async () => {
    const plan = await publishedPlan();
    await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({ kind: 'membership', planSlug: plan.slug, currency: 'NGN' })
      .expect(401);

    const session = await signUp(ctx, 'member@example.com');
    const auth = bearer(session.accessToken);
    expect((await ctx.http().get('/v1/me/prime').set(auth).expect(200)).body).toEqual({
      member: false,
      current: null,
      terms: [],
    });

    const { quote, booking } = await buy(session.accessToken, plan.slug);
    expect(quote).toMatchObject({
      vertical: 'prime',
      membership: {
        product: { slug: 'prime-yearly', title: 'Suskii Prime Yearly' },
        period: 'year',
        benefits: { memberFares: true, waivedFeeCodes: ['service_fee'], prioritySupport: true },
        term: null,
      },
      price: { total: { amountMinor: 2_500_000, currency: 'NGN' } },
      payment: { hold: null, installments: null },
    });
    expect(booking).toMatchObject({
      status: 'CONFIRMED',
      vertical: 'prime',
      passengers: [{ givenNames: 'NGOZI', surname: 'EZE' }],
      documents: [],
    });
    const term = booking.membership.term as { startsAt: string; endsAt: string };
    expect(new Date(term.endsAt).toISOString()).toBe(
      primeTermEnd(new Date(term.startsAt), 'year').toISOString(),
    );

    const mine = await ctx.http().get('/v1/me/prime').set(auth).expect(200);
    expect(mine.body).toMatchObject({
      member: true,
      current: { plan: { slug: 'prime-yearly' }, until: term.endsAt },
      terms: [{ bookingId: booking.id, status: 'active' }],
    });
    // Memberships are not trips.
    const trips = await ctx.http().get('/v1/me/bookings').set(auth).expect(200);
    expect(trips.body.bookings).toEqual([]);

    // Buying again while a member adds a term after the current one.
    const again = await buy(session.accessToken, plan.slug);
    expect(again.booking.membership.term.startsAt).toBe(term.endsAt);
    const extended = await ctx.http().get('/v1/me/prime').set(auth).expect(200);
    expect(extended.body.current.until).toBe(again.booking.membership.term.endsAt);
    expect(extended.body.terms).toHaveLength(2);

    const confirmation = ctx.emails.outbox.filter((mail) => mail.to === 'member@example.com');
    expect(confirmation.length).toBeGreaterThan(0);
  });

  it('prices members lower once their session carries the membership', async () => {
    await pricingRules();
    const plan = await publishedPlan();
    const session = await signUp(ctx, 'saver@example.com');

    const search = async (token: string) =>
      (
        await ctx
          .http()
          .post('/v1/flights/searches')
          .set(bearer(token))
          .send(searchBody)
          .expect(200)
      ).body.offers[0] as {
        id: string;
        price: { total: Money; fees: { code: string }[]; memberSaving: Money | null };
      };
    const before = await search(session.accessToken);
    expect(before.price.memberSaving).toBeNull();
    expect(before.price.fees.map((fee) => fee.code)).toEqual(['service_fee']);

    await buy(session.accessToken, plan.slug);

    // The old access token predates the membership; a refreshed session carries it.
    const refreshed = await ctx
      .http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    const member = await search(refreshed.body.accessToken as string);
    expect(member.price.fees).toEqual([]);
    expect(member.price.memberSaving?.amountMinor).toBeGreaterThan(500_000);
    expect(member.price.total.amountMinor).toBe(
      before.price.total.amountMinor - (member.price.memberSaving?.amountMinor ?? 0),
    );

    // Quotes and bookings read the membership from the database, whatever the token says.
    const auth = bearer(session.accessToken);
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${before.id}/quote`)
      .set(auth)
      .expect(201);
    const checkout = await ctx
      .http()
      .get(`/v1/quotes/${quote.body.quoteId as string}`)
      .set(auth)
      .expect(200);
    expect(checkout.body.flight.offer.price.memberSaving).toEqual(member.price.memberSaving);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId,
        contact: { email: 'saver@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'mr',
            gender: 'm',
            givenNames: 'Tunde',
            surname: 'Bello',
            dateOfBirth: '1985-06-01',
            nationality: 'NG',
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      })
      .expect(201);
    expect(created.body.booking.price).toMatchObject({
      total: member.price.total,
      memberSaving: member.price.memberSaving,
      fees: [],
    });

    // A membership that has ended no longer prices anything.
    await ctx.prisma.primeMembership.updateMany({
      where: { userId: session.userId },
      data: { startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() - 1000) },
    });
    const lapsed = await ctx
      .http()
      .get(`/v1/quotes/${quote.body.quoteId as string}`)
      .set(bearer(refreshed.body.accessToken as string))
      .expect(200);
    expect(lapsed.body.flight.offer.price.memberSaving).toBeNull();
    expect(lapsed.body.flight.offer.price.total).toEqual(before.price.total);
  });
});
