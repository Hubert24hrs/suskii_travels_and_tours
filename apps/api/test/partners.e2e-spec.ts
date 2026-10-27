import { staffSession } from './helpers/admin';
import { book, inDays, passenger, payInFull } from './helpers/cars';
import { bearer, signUp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

import { AccountDeletionService } from '../src/privacy/account-deletion.service';

const SECRET = 'e2e-postback-secret-0123456789abcdef';

interface Offer {
  id: string;
  programId: string;
  category: string;
  title: string | null;
  fromPrice: { amountMinor: number; currency: string } | null;
  href: string;
  sample: boolean;
}

/**
 * Partner offers and affiliate tracking (ADR-069, ADR-070): offers for a place and a booked trip,
 * the sealed redirect that records each click, network postbacks that record conversions, the
 * staff summary, and the privacy treatment of clicks. Mock network and activities only.
 */
describe('partner offers and tracking (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, TRAVELPAYOUTS_POSTBACK_SECRET: SECRET });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  const offersFor = (query: string, headers: Record<string, string> = {}) =>
    ctx.http().get(`/v1/partners/offers?${query}`).set(headers);
  const tokenOf = (href: string) => href.slice('/v1/go/'.length);
  const offer = (offers: Offer[], programId: string): Offer => {
    const found = offers.find((candidate) => candidate.programId === programId);
    if (!found) throw new Error(`no offer from ${programId}`);
    return found;
  };

  it('lists partner pages and priced sample activities for a place', async () => {
    const response = await offersFor(
      `countryCode=NG&cityName=Lagos&startDate=${inDays(10)}&endDate=${inDays(14)}&currency=NGN`,
    ).expect(200);
    const offers = response.body.offers as Offer[];
    expect(response.body).toMatchObject({
      trip: { countryCode: 'NG', cityName: 'Lagos', startDate: inDays(10) },
      partial: false,
    });
    expect(offers.map((entry) => entry.programId)).toEqual([
      'discovercars',
      'localrent',
      'economybookings',
      'gettransfer',
      'kiwitaxi',
      'airalo',
      'ekta',
      'viator',
      'viator',
      'viator',
    ]);
    const activity = offers.filter((entry) => entry.category === 'activity');
    for (const entry of activity) {
      expect(entry).toMatchObject({ sample: true, fromPrice: { currency: 'NGN' } });
      expect(entry.fromPrice?.amountMinor).toBeGreaterThan(0);
    }
    expect(offers.every((entry) => entry.href.startsWith('/v1/go/v2.'))).toBe(true);
    // Nothing internal or personal in the links.
    expect(JSON.stringify(response.body)).not.toContain('discovercars.com');

    const esim = await offersFor('countryCode=AE&categories=esim').expect(200);
    expect((esim.body.offers as Offer[]).map((entry) => entry.programId)).toEqual(['airalo']);
    await offersFor('countryCode=NG&categories=flights').expect(400);
    await offersFor('countryCode=nigeria').expect(400);
    await offersFor(`countryCode=NG&startDate=${inDays(5)}&endDate=${inDays(2)}`).expect(400);
  });

  it('records a click and redirects to the partner with its id', async () => {
    const session = await signUp(ctx, 'partner-clicker@example.com');
    const listed = await offersFor('countryCode=AE&cityName=Dubai', {
      ...bearer(session.accessToken),
      'X-Suskii-Client': 'mobile-android/1.0.0',
    }).expect(200);
    const offers = listed.body.offers as Offer[];

    // The system browser follows the link without the app's session.
    const car = await ctx.http().get(offer(offers, 'discovercars').href).expect(302);
    expect(car.headers['cache-control']).toBe('no-store');
    const location = new URL(car.headers.location!);
    expect(`${location.origin}${location.pathname}`).toBe('https://www.discovercars.com/');
    const clickId = location.searchParams.get('sub_id') ?? '';
    const click = await ctx.prisma.partnerClick.findUniqueOrThrow({ where: { id: clickId } });
    expect(click).toMatchObject({
      programId: 'discovercars',
      category: 'car_rental',
      network: 'mock',
      userId: session.userId,
      bookingId: null,
      channel: 'mobile',
    });

    const esim = await ctx.http().get(offer(offers, 'airalo').href).expect(302);
    expect(esim.headers.location).toMatch(
      /^https:\/\/www\.airalo\.com\/united-arab-emirates-esim\?sub_id=/,
    );

    // Activity links go to the product page as the partner returned it.
    const tour = await ctx.http().get(offer(offers, 'viator').href).expect(302);
    expect(tour.headers.location).toMatch(/^https:\/\/www\.viator\.com\/tours\/dubai\/sample-1\//);
    expect(await ctx.prisma.partnerClick.count({ where: { programId: 'viator' } })).toBe(1);
  });

  it('refuses tokens it did not seal', async () => {
    const listed = await offersFor('countryCode=NG').expect(200);
    const href = (listed.body.offers as Offer[])[0]?.href ?? '';
    const token = tokenOf(href);
    const parts = token.split('.');
    // Always a different first character: an 'A' replaced by 'A' would leave the token intact.
    const sealed = parts[3] ?? '';
    const swapped = `${sealed.startsWith('A') ? 'B' : 'A'}${sealed.slice(1)}`;
    const altered = [...parts.slice(0, 3), swapped, parts[4]].join('.');
    await ctx.http().get(`/v1/go/${altered}`).expect(404);
    await ctx.http().get('/v1/go/v2.k1.AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA').expect(404);
    await ctx.http().get('/v1/go/short').expect(400);
    expect(await ctx.prisma.partnerClick.count()).toBe(0);
  });

  it('offers partner products for a booked trip to its owner only', async () => {
    const owner = await signUp(ctx, 'partner-owner@example.com');
    const headers = bearer(owner.accessToken);
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [
          { origin: 'LOS', destination: 'ABV', departureDate: inDays(20) },
          { origin: 'ABV', destination: 'LOS', departureDate: inDays(27) },
        ],
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
    const bookingId = created.body.booking.id as string;

    // Unpaid trips get no cross-sell yet.
    const unpaid = await ctx
      .http()
      .get(`/v1/bookings/${bookingId}/partner-offers`)
      .set(headers)
      .expect(200);
    expect(unpaid.body.offers).toEqual([]);

    await payInFull(ctx, bookingId, headers);
    const response = await ctx
      .http()
      .get(`/v1/bookings/${bookingId}/partner-offers?currency=USD`)
      .set(headers)
      .expect(200);
    expect(response.body.trip).toMatchObject({
      countryCode: 'NG',
      cityName: 'Abuja',
      startDate: inDays(20),
      endDate: inDays(27),
    });
    const offers = response.body.offers as Offer[];
    expect(offers.length).toBeGreaterThan(5);
    expect(offer(offers, 'viator').fromPrice).toMatchObject({ currency: 'USD', amountMinor: 2500 });

    const followed = await ctx.http().get(offer(offers, 'gettransfer').href).expect(302);
    const clickId = new URL(followed.headers.location!).searchParams.get('sub_id') ?? '';
    expect(
      await ctx.prisma.partnerClick.findUniqueOrThrow({ where: { id: clickId } }),
    ).toMatchObject({ bookingId, userId: owner.userId });

    const stranger = await signUp(ctx, 'partner-stranger@example.com');
    await ctx
      .http()
      .get(`/v1/bookings/${bookingId}/partner-offers`)
      .set(bearer(stranger.accessToken))
      .expect(404);
    await ctx.http().get(`/v1/bookings/${bookingId}/partner-offers`).expect(404);
  });

  it('records postbacks as conversions that only move forward', async () => {
    const listed = await offersFor('countryCode=NG&categories=car_rental').expect(200);
    const followed = await ctx
      .http()
      .get(offer(listed.body.offers as Offer[], 'localrent').href)
      .expect(302);
    const clickId = new URL(followed.headers.location!).searchParams.get('sub_id') ?? '';
    const postback = (query: Record<string, string>) =>
      ctx
        .http()
        .get('/v1/partners/postbacks/travelpayouts')
        .query({ token: SECRET, ...query });

    await ctx
      .http()
      .get('/v1/partners/postbacks/travelpayouts')
      .query({ token: 'wrong-secret', id: 'TP-1', status: 'paid' })
      .expect(401);
    await ctx
      .http()
      .get('/v1/partners/postbacks/viator')
      .query({ token: SECRET, id: 'V-1', status: 'paid' })
      .expect(400);

    const pending = await postback({
      id: 'TP-1',
      click: clickId,
      status: 'processing',
      price: '250.00',
      commission: '12.50',
      currency: 'USD',
    }).expect(200);
    expect(pending.body).toEqual({ status: 'pending' });
    expect(
      await ctx.prisma.partnerConversion.findFirstOrThrow({ where: { externalId: 'TP-1' } }),
    ).toMatchObject({
      network: 'travelpayouts',
      clickId,
      programId: 'localrent',
      status: 'pending',
      priceMinor: 25000n,
      commissionMinor: 1250n,
      commissionCurrency: 'USD',
    });

    const paid = await ctx
      .http()
      .post('/v1/partners/postbacks/travelpayouts')
      .query({ token: SECRET })
      .send({ id: 'TP-1', status: 'paid', commission: '13.00', currency: 'USD' })
      .expect(200);
    expect(paid.body).toEqual({ status: 'confirmed' });
    // A late "processing" does not undo the payment.
    expect((await postback({ id: 'TP-1', status: 'processing' }).expect(200)).body).toEqual({
      status: 'confirmed',
    });
    const row = await ctx.prisma.partnerConversion.findFirstOrThrow({
      where: { externalId: 'TP-1' },
    });
    expect(row).toMatchObject({ status: 'confirmed', commissionMinor: 1300n, priceMinor: 25000n });
    expect(row.confirmedAt).not.toBeNull();

    // A booking the network reports without a known click is still recorded.
    await postback({
      id: 'TP-2',
      click: '0192d3a0-7c1e-7b2a-9f00-00000000dead',
      status: 'paid',
      commission: '4.00',
      currency: 'USD',
    }).expect(200);
    expect(
      await ctx.prisma.partnerConversion.findFirstOrThrow({ where: { externalId: 'TP-2' } }),
    ).toMatchObject({ clickId: null, programId: null, status: 'confirmed' });

    // Malformed postbacks are refused so the network retries after the dashboard is fixed.
    await postback({ id: 'TP-3', status: 'paid', commission: '4,00', currency: 'USD' }).expect(400);
    await postback({ id: 'TP-3', status: 'paid', commission: '4.00' }).expect(400);
    await postback({ id: 'TP-3', status: 'shipped' }).expect(400);
    expect(await ctx.prisma.partnerConversion.count({ where: { externalId: 'TP-3' } })).toBe(0);

    await postback({ id: 'TP-1', status: 'cancelled' }).expect(200);
    expect((await postback({ id: 'TP-1', status: 'paid' }).expect(200)).body).toEqual({
      status: 'cancelled',
    });

    // Staff reports: clicks, conversions and commission per partner.
    const finance = await staffSession(ctx, 'partner-finance@suskii.test', ['finance']);
    const summary = await ctx
      .http()
      .get('/v1/admin/partners/summary')
      .set(bearer(finance.accessToken))
      .expect(200);
    const localrent = (summary.body.programs as { programId: string }[]).find(
      (entry) => entry.programId === 'localrent',
    );
    expect(localrent).toEqual({
      programId: 'localrent',
      partnerName: 'Localrent',
      category: 'car_rental',
      clicks: 1,
      conversions: { pending: 0, confirmed: 0, cancelled: 1 },
      confirmedCommission: [],
      pendingCommission: [],
    });
    expect(summary.body.unattributed).toEqual({
      conversions: { pending: 0, confirmed: 1, cancelled: 0 },
      confirmedCommission: [{ amountMinor: 400, currency: 'USD' }],
      pendingCommission: [],
    });
    const customer = await signUp(ctx, 'partner-customer@example.com');
    await ctx
      .http()
      .get('/v1/admin/partners/summary')
      .set(bearer(customer.accessToken))
      .expect(403);
  });

  it('anonymises clicks when the account is deleted', async () => {
    const session = await signUp(ctx, 'partner-leaver@example.com');
    const listed = await offersFor('countryCode=GH', bearer(session.accessToken)).expect(200);
    await ctx
      .http()
      .get(offer(listed.body.offers as Offer[], 'ekta').href)
      .expect(302);
    expect(await ctx.prisma.partnerClick.count({ where: { userId: session.userId } })).toBe(1);

    await ctx.app.get(AccountDeletionService).delete(session.userId, { ip: '127.0.0.1' });
    expect(await ctx.prisma.partnerClick.count({ where: { userId: session.userId } })).toBe(0);
    expect(await ctx.prisma.partnerClick.count({ where: { programId: 'ekta' } })).toBe(1);
  });

  it('answers 404 while partner offers or postbacks are off', async () => {
    const off = await createTestApp({ PARTNER_OFFERS_ENABLED: false });
    try {
      await off.http().get('/v1/partners/offers?countryCode=NG').expect(404);
      await off
        .http()
        .get('/v1/partners/postbacks/travelpayouts')
        .query({ token: SECRET, id: 'TP-9', status: 'paid' })
        .expect(404);
    } finally {
      await off.close();
    }
  });
});
