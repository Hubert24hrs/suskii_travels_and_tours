import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { TicketingService } from '../src/bookings/ticketing.service';

import { staffSession } from './helpers/admin';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
let keySequence = 0;
const idempotencyKey = (): string => `e2e-risk-${Date.now()}-${(keySequence += 1)}`;
const problem = (slug: string) => `urn:suskii:problem:${slug}`;

interface Card {
  country: string | null;
  fingerprint: string | null;
}

/**
 * ADR-040: a captured payment is scored from velocity, card country against connection country,
 * distinct cards and listed routes. At or above the review score the paid booking waits for
 * finance: approving releases it to fulfilment, rejecting refunds it in full.
 */
describe('payment risk review (e2e)', () => {
  let ctx: TestContext;
  let finance: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      CLIENT_COUNTRY_HEADER: 'cf-ipcountry',
      PAYMENT_RISK_ROUTES: ['LOS-ABV'],
      PAYMENT_RISK_MAX_PAYMENTS_PER_DAY: 2,
    });
    await resetState(ctx);
    finance = await staffSession(ctx, 'risk-finance@example.com', ['finance']);
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function quote(destination: string): Promise<string> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination, departureDate: addDays(today, 30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quoted = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .expect(201);
    return quoted.body.quoteId as string;
  }

  /** Books and pays a one-way flight, connecting from `country`, with `card`. */
  async function paidBooking(
    session: TokenSession,
    { destination, country, card }: { destination: string; country: string; card: Card | null },
  ): Promise<string> {
    const auth = bearer(session.accessToken);
    const quoteId = await quote(destination);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId,
        // One contact per customer, so contact velocity counts only their own bookings.
        contact: { email: `payer-${session.userId}@example.com`, phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'mr',
            gender: 'm',
            givenNames: 'Tunde',
            surname: 'Bello',
            dateOfBirth: '1987-03-12',
            nationality: 'NG',
            document: {
              number: 'C7654321',
              issuingCountry: 'NG',
              expiryDate: addDays(today, 3650),
            },
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      })
      .expect(201);
    const bookingId = created.body.booking.id as string;
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set(auth)
      .set('cf-ipcountry', country)
      .set('Idempotency-Key', idempotencyKey())
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded', card })
      .expect(200);
    await ctx.background.drain();
    return bookingId;
  }

  const status = async (bookingId: string) =>
    (await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status;
  const reviewOf = (bookingId: string) =>
    ctx.prisma.paymentRiskReview.findFirstOrThrow({ where: { bookingId } });
  const admin = () => bearer(finance.accessToken);

  it('holds a risky payment for review and releases it on approval', async () => {
    const customer = await signUp(ctx, 'risky@example.com');
    // A listed route (+30) and a Nigerian card used from abroad (+30) reach the score of 60.
    const held = await paidBooking(customer, {
      destination: 'ABV',
      country: 'GB',
      card: { country: 'NG', fingerprint: 'card-alpha' },
    });
    expect(await status(held)).toBe('PAID');
    const review = await reviewOf(held);
    expect(review).toMatchObject({ status: 'open', score: 60 });
    expect([...review.signals].sort()).toEqual(['card_country_mismatch', 'high_risk_route']);

    // The payment keeps only pseudonymous signals.
    const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: review.paymentId } });
    expect(payment).toMatchObject({ ipCountry: 'GB', cardCountry: 'NG' });
    expect(payment.cardFingerprintHash).not.toContain('card-alpha');
    expect(payment.ipHash).not.toBeNull();

    // Fulfilment waits, even when the ticketing sweep comes round.
    await ctx.app.get(TicketingService).processDue(new Date(Date.now() + 3_600_000));
    expect(await status(held)).toBe('PAID');

    const queue = await ctx.http().get('/v1/admin/payment-reviews').set(admin()).expect(200);
    expect(queue.body.items).toEqual([
      expect.objectContaining({
        id: review.id,
        bookingId: held,
        score: 60,
        status: 'open',
        amount: expect.objectContaining({ currency: 'NGN' }),
      }),
    ]);

    const approved = await ctx
      .http()
      .post(`/v1/admin/payment-reviews/${review.id}/approve`)
      .set(admin())
      .expect(200);
    expect(approved.body).toMatchObject({
      status: 'approved',
      reason: 'verified',
      decidedByUserId: finance.userId,
    });
    await ctx.background.drain();
    expect(await status(held)).toBe('CONFIRMED');
    const again = await ctx
      .http()
      .post(`/v1/admin/payment-reviews/${review.id}/reject`)
      .set(admin())
      .send({ reason: 'confirmed_fraud' })
      .expect(409);
    expect(again.body.type).toBe(problem('payment-review-closed'));
  });

  it('refunds a rejected payment in full', async () => {
    const customer = await signUp(ctx, 'rejected@example.com');
    const held = await paidBooking(customer, {
      destination: 'ABV',
      country: 'US',
      card: { country: 'NG', fingerprint: 'card-beta' },
    });
    const review = await reviewOf(held);
    await ctx
      .http()
      .post(`/v1/admin/payment-reviews/${review.id}/reject`)
      .set(admin())
      .send({ reason: 'confirmed_fraud' })
      .expect(200);
    await ctx.background.drain();
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: held } });
    expect(refund).toMatchObject({ reason: 'risk_rejected', automatic: true });
    expect(['REFUND_PENDING', 'REFUNDED']).toContain(await status(held));
    const history = await ctx.prisma.bookingStatusHistory.findFirstOrThrow({
      where: { bookingId: held, toStatus: 'REFUND_PENDING' },
    });
    expect(history).toMatchObject({ reason: 'risk_rejected', actorType: 'staff' });
  });

  it('lets ordinary payments through and counts velocity per account', async () => {
    const customer = await signUp(ctx, 'regular@example.com');
    // A listed route alone (+30) stays below the score.
    const first = await paidBooking(customer, { destination: 'ABV', country: 'NG', card: null });
    expect(await status(first)).toBe('CONFIRMED');
    const second = await paidBooking(customer, { destination: 'PHC', country: 'NG', card: null });
    expect(await status(second)).toBe('CONFIRMED');
    // The third payment in a day: account (+40) and contact (+40) velocity.
    const third = await paidBooking(customer, { destination: 'PHC', country: 'NG', card: null });
    expect(await status(third)).toBe('PAID');
    expect([...(await reviewOf(third)).signals].sort()).toEqual([
      'velocity_account',
      'velocity_contact',
    ]);
  });

  it('keeps the queue for staff who may review payments', async () => {
    const support = await staffSession(ctx, 'risk-support@example.com', ['support']);
    await ctx.http().get('/v1/admin/payment-reviews').set(bearer(support.accessToken)).expect(403);
  });
});
