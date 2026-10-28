import { BOOKING_TERMS_VERSION } from '@suskii/shared';

import { staffSession } from './helpers/admin';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Suskii Prime priced per country (ADR-082): a price entry may name a country; the edge's
 * country picks it, else the currency's price for everywhere; a quote keeps the entry it was
 * priced with through the re-check before payment.
 */

let keySequence = 0;
const idempotencyKey = (): string => `e2e-prime-country-${Date.now()}-${(keySequence += 1)}`;
const EDGE = 'cf-ipcountry';

describe('Suskii Prime priced per country (e2e)', () => {
  let ctx: TestContext;
  let staff: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({ CLIENT_COUNTRY_HEADER: EDGE });
    await resetState(ctx);
    staff = await staffSession(ctx, 'prime-countries@suskii.test', ['finance']);
  });
  beforeEach(async () => {
    await ctx.prisma.primeMembership.deleteMany({});
    await ctx.prisma.$executeRawUnsafe('TRUNCATE TABLE prime_plans RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function plan(prices: object[]): Promise<{ id: string; slug: string }> {
    const created = await ctx
      .http()
      .post('/v1/admin/prime/plans')
      .set(bearer(staff.accessToken))
      .send({
        slug: 'prime-world',
        name: 'Suskii Prime',
        summary: 'Member fares for a year.',
        period: 'year',
        prices,
        benefits: { markupShareBps: 5_000, waivedFeeCodes: [], prioritySupport: false },
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/v1/admin/prime/plans/${created.body.id as string}`)
      .set(bearer(staff.accessToken))
      .send({ status: 'published' })
      .expect(200);
    return { id: created.body.id as string, slug: created.body.slug as string };
  }

  const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
  const prices = [
    { amountMinor: 2_500_000, currency: 'NGN' },
    { amountMinor: 2_500, currency: 'USD' },
    { amountMinor: 1_800, currency: 'USD', country: 'GH' },
    { amountMinor: 1_500, currency: 'GBP', country: 'GB' },
  ];

  const listed = async (country: string | null, query: Record<string, string> = {}) => {
    const call = ctx
      .http()
      .get('/v1/prime/plans')
      .query({ currency: 'USD', ...query });
    const { body } = await (country ? call.set(EDGE, country) : call).expect(200);
    return (body as { plans: { price: unknown; prices: unknown[] }[] }).plans[0];
  };

  it("lists the visitor's country price, else the currency's, and stores country entries", async () => {
    const created = await plan(prices);
    expect((await listed('GH'))?.price).toEqual(usd(1_800));
    expect((await listed('KE'))?.price).toEqual(usd(2_500));
    expect((await listed(null))?.price).toEqual(usd(2_500));
    // The website's server passes its visitor's edge country for display.
    expect((await listed(null, { country: 'GH' }))?.price).toEqual(usd(1_800));
    // One price per currency as that visitor sees it; other countries' entries stay out.
    expect((await listed('GB'))?.prices).toEqual([
      { amountMinor: 2_500_000, currency: 'NGN' },
      usd(2_500),
      { amountMinor: 1_500, currency: 'GBP' },
    ]);
    expect((await listed('NG', { currency: 'GBP' }))?.price).toBeNull();

    const admin = await ctx
      .http()
      .get('/v1/admin/prime/plans')
      .set(bearer(staff.accessToken))
      .expect(200);
    const stored = (admin.body.plans as { id: string; prices: unknown[] }[]).find(
      (row) => row.id === created.id,
    );
    expect(stored?.prices).toEqual([
      { amountMinor: 2_500_000, currency: 'NGN', country: null },
      { amountMinor: 2_500, currency: 'USD', country: null },
      { amountMinor: 1_800, currency: 'USD', country: 'GH' },
      { amountMinor: 1_500, currency: 'GBP', country: 'GB' },
    ]);
  });

  it('refuses two prices for the same currency and country', async () => {
    const { body } = await ctx
      .http()
      .post('/v1/admin/prime/plans')
      .set(bearer(staff.accessToken))
      .send({
        slug: 'prime-twice',
        name: 'Twice',
        summary: 'Duplicate country price.',
        period: 'year',
        prices: [usd(2_500), { ...usd(1_800), country: 'GH' }, { ...usd(1_700), country: 'GH' }],
        benefits: { markupShareBps: 0, waivedFeeCodes: [], prioritySupport: false },
      })
      .expect(400);
    expect(JSON.stringify(body)).toContain('one_price_per_currency_and_country');
  });

  it('prices the quote for the edge country and keeps that entry through payment', async () => {
    const { slug } = await plan(prices);
    const member = await signUp(ctx, 'ama@example.com');
    const auth = bearer(member.accessToken);

    // Only the edge's header names the country; the quote body has no such field.
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .set(auth)
      .set(EDGE, 'GH')
      .send({ kind: 'membership', planSlug: slug, currency: 'USD' })
      .expect(201);
    const offer = await ctx.prisma.offer.findUniqueOrThrow({
      where: { id: quote.body.quoteId as string },
    });
    expect(offer.payload).toMatchObject({
      kind: 'membership',
      unitPrice: { minor: { $big: '1800' }, currency: 'USD' },
      priceCountry: 'GH',
    });

    // The booking and the payment arrive through another edge location; the price holds.
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set(auth)
      .set(EDGE, 'KE')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId,
        contact: { email: 'ama@example.com', phone: '+233201234567' },
        guests: [{ givenNames: 'Ama', surname: 'Mensah' }],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      })
      .expect(201);
    const bookingId = created.body.booking.id as string;
    const before = created.body.booking.price.total as { amountMinor: number };
    await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set(auth)
      .set(EDGE, 'KE')
      .set('Idempotency-Key', idempotencyKey())
      .expect(201);
    const booking = await ctx.http().get(`/v1/bookings/${bookingId}`).set(auth).expect(200);
    expect(booking.body.price.total).toEqual(created.body.booking.price.total);
    expect(before.amountMinor).toBeGreaterThanOrEqual(1_800);

    // Without the country's entry the same plan costs the currency's price.
    const elsewhere = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .set(auth)
      .set(EDGE, 'KE')
      .send({ kind: 'membership', planSlug: slug, currency: 'USD' })
      .expect(201);
    const other = await ctx.prisma.offer.findUniqueOrThrow({
      where: { id: elsewhere.body.quoteId as string },
    });
    expect(other.payload).toMatchObject({
      unitPrice: { minor: { $big: '2500' }, currency: 'USD' },
      priceCountry: null,
    });
  });
});
