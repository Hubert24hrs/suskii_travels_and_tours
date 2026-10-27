import { addDays, localDate } from '@suskii/shared';

import { staffSession } from './helpers/admin';
import { book, passenger, payInFull } from './helpers/cars';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/** ADR-072: tax on Suskii's own service, from the admin console to the first search result. */
const inDays = (days: number): string => addDays(localDate(new Date(), 'UTC'), days);

interface WireMoney {
  amountMinor: number;
  currency: string;
}
interface WirePrice {
  fare: WireMoney;
  taxes: WireMoney;
  fees: { code: string; amount: WireMoney }[];
  serviceTaxes: {
    code: string;
    label: string;
    rateBps: number;
    amount: WireMoney;
    registrationNumber: string | null;
  }[];
  discount: { amount: WireMoney } | null;
  total: WireMoney;
}

const rule = (overrides: Record<string, unknown> = {}) => ({
  country: 'NG',
  code: 'vat',
  label: 'VAT',
  rateBps: 750,
  basis: 'margin',
  vertical: 'flights',
  active: true,
  registrationNumber: 'TIN 01234567-0001',
  validFrom: null,
  validTo: null,
  ...overrides,
});

const serviceFee = {
  code: 'service_fee',
  label: 'Service fee',
  vertical: 'flights',
  active: true,
  sortOrder: 0,
  channel: null,
  userTier: null,
  type: 'fixed',
  value: 200_000,
  currency: 'NGN',
  basis: 'per_booking',
  minAmountMinor: null,
  maxAmountMinor: null,
  validFrom: null,
  validTo: null,
};

describe('tax rules (e2e)', () => {
  let ctx: TestContext;
  let staff: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    await resetState(ctx);
    staff = await staffSession(ctx, 'tax-admin@suskii.test', ['super_admin']);
  });
  afterAll(async () => {
    await resetState(ctx);
    await ctx.close();
  });

  const search = async (): Promise<WirePrice[]> => {
    const response = await ctx
      .http()
      .post('/v1/flights/searches?currency=NGN')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    return (response.body.offers as { price: WirePrice }[]).map((offer) => offer.price);
  };

  it("adds the selling country's tax on our fee to every search result, inside the total", async () => {
    const before = await search();
    expect(before.every((price) => price.serviceTaxes.length === 0)).toBe(true);

    await ctx
      .http()
      .post('/v1/admin/pricing/fees')
      .set(bearer(staff.accessToken))
      .send(serviceFee)
      .expect(201);
    const created = await ctx
      .http()
      .post('/v1/admin/pricing/taxes')
      .set(bearer(staff.accessToken))
      .send(rule())
      .expect(201);
    // Another country's rule is kept for later and never applied here.
    await ctx
      .http()
      .post('/v1/admin/pricing/taxes')
      .set(bearer(staff.accessToken))
      .send(rule({ country: 'GH', code: 'vat_gh', rateBps: 1500 }))
      .expect(201);

    const listed = await ctx
      .http()
      .get('/v1/admin/pricing/taxes')
      .set(bearer(staff.accessToken))
      .expect(200);
    expect(listed.body.sellerCountry).toBe('NG');
    expect((listed.body.rules as { code: string }[]).map((entry) => entry.code)).toEqual([
      'vat_gh',
      'vat',
    ]);

    const after = await search();
    expect(after.length).toBeGreaterThan(0);
    for (const price of after) {
      // 7.5% of the NGN 2,000 service fee (no markup rule): NGN 150.
      expect(price.serviceTaxes).toEqual([
        {
          code: 'vat',
          label: 'VAT',
          rateBps: 750,
          amount: { amountMinor: 15_000, currency: 'NGN' },
          registrationNumber: 'TIN 01234567-0001',
        },
      ]);
      const fees = price.fees.reduce((total, fee) => total + fee.amount.amountMinor, 0);
      expect(price.total.amountMinor).toBe(
        price.fare.amountMinor + price.taxes.amountMinor + fees + 15_000,
      );
    }

    // Deactivated: the next search is untaxed again.
    await ctx
      .http()
      .patch(`/v1/admin/pricing/taxes/${created.body.id as string}`)
      .set(bearer(staff.accessToken))
      .send({ active: false })
      .expect(200);
    expect((await search()).every((price) => price.serviceTaxes.length === 0)).toBe(true);
  });

  it('keeps the tax on the booking, its total and its e-ticket', async () => {
    await ctx
      .http()
      .post('/v1/admin/pricing/taxes')
      .set(bearer(staff.accessToken))
      .send(rule())
      .expect(201);
    const owner = await signUp(ctx, 'tax-owner@example.com');
    const headers = bearer(owner.accessToken);
    const search = await ctx
      .http()
      .post('/v1/flights/searches?currency=NGN')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .set(headers)
      .expect(201);
    const created = await book(
      ctx,
      { quoteId: quote.body.quoteId, passengers: [passenger('Ada', 'Obi')] },
      headers,
    ).expect(201);
    const price = created.body.booking.price as WirePrice;
    expect(price.serviceTaxes.map((line) => [line.code, line.amount.amountMinor])).toEqual([
      ['vat', 15_000],
    ]);
    const fees = price.fees.reduce((total, fee) => total + fee.amount.amountMinor, 0);
    expect(price.total.amountMinor).toBe(
      price.fare.amountMinor + price.taxes.amountMinor + fees + 15_000,
    );

    const confirmed = (await payInFull(ctx, created.body.booking.id as string, headers)) as {
      id: string;
      status: string;
      documents: { id: string }[];
    };
    expect(confirmed.status).toBe('CONFIRMED');
    const document = confirmed.documents[0];
    if (!document) throw new Error('No e-ticket after confirmation');
    await ctx
      .http()
      .get(`/v1/bookings/${confirmed.id}/documents/${document.id}`)
      .set(headers)
      .expect(200)
      .expect('content-type', /application\/pdf/);
  });

  it('validates rules like the console form', async () => {
    const invalid = await ctx
      .http()
      .post('/v1/admin/pricing/taxes')
      .set(bearer(staff.accessToken))
      .send(rule({ rateBps: 10_001, country: 'ng' }))
      .expect(400);
    const paths = (invalid.body.errors as { path: string }[]).map((issue) => issue.path).sort();
    expect(paths).toEqual(['country', 'rateBps']);
    const dates = await ctx
      .http()
      .post('/v1/admin/pricing/taxes')
      .set(bearer(staff.accessToken))
      .send(
        rule({
          validFrom: `${inDays(5)}T00:00:00.000Z`,
          validTo: `${inDays(1)}T00:00:00.000Z`,
        }),
      )
      .expect(400);
    expect((dates.body.errors as { path: string }[]).map((issue) => issue.path)).toEqual([
      'validTo',
    ]);
  });
});

describe('tax rules beside Cars fare VAT (e2e)', () => {
  let ctx: TestContext;
  let staff: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, CARS_VAT_BPS: 750 });
    await resetState(ctx);
    staff = await staffSession(ctx, 'tax-cars-admin@suskii.test', ['super_admin']);
  });
  afterAll(async () => {
    await resetState(ctx);
    await ctx.close();
  });

  it('refuses a whole-price rule that would tax Cars fares twice, and allows the margin', async () => {
    for (const vertical of ['buses', null]) {
      const refused = await ctx
        .http()
        .post('/v1/admin/pricing/taxes')
        .set(bearer(staff.accessToken))
        .send(rule({ basis: 'full', vertical }))
        .expect(409);
      expect(refused.body.type).toMatch(/tax-overlaps-cars-vat$/);
    }
    await ctx
      .http()
      .post('/v1/admin/pricing/taxes')
      .set(bearer(staff.accessToken))
      .send(rule({ basis: 'margin', vertical: 'buses' }))
      .expect(201);
    const tours = await ctx
      .http()
      .post('/v1/admin/pricing/taxes')
      .set(bearer(staff.accessToken))
      .send(rule({ basis: 'full', vertical: 'tours' }))
      .expect(201);
    // Widening an allowed rule to every vertical is refused the same way.
    await ctx
      .http()
      .patch(`/v1/admin/pricing/taxes/${tours.body.id as string}`)
      .set(bearer(staff.accessToken))
      .send({ vertical: null })
      .expect(409);
  });
});
