import { createHash, randomUUID } from 'node:crypto';

import { addDays, BOOKING_TERMS_VERSION, COOKIE_POLICY_VERSION, localDate } from '@suskii/shared';

import {
  MockAdConversions,
  type AdConversionsProvider,
} from '../src/marketing/ad-conversions.provider';
import { AD_CONVERSIONS_PROVIDERS } from '../src/marketing/ad-conversions.service';
import { PricingService } from '../src/pricing/pricing.service';

import { bearer, PASSWORD, signUp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  WEB_ORIGIN,
  type TestContext,
} from './helpers/test-app';

/**
 * Ads with consent (ADR-079): a booking keeps the website's ad attribution only when the recorded
 * cookie consent allows marketing; the worker's sweep sends paid bookings' Purchase events with
 * hashed contact details, retries a failing network twice, sends nothing once the visitor turned
 * marketing off, and forgets the click ids once the event is settled.
 */

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

let keySequence = 0;
const idempotencyKey = (): string => `e2e-ads-${Date.now()}-${(keySequence += 1)}`;

const contact = { email: 'Chioma@Example.com', phone: '+2348012345678' };
const CLICK_IDS = {
  fbp: 'fb.1.1714546784212.1116446470',
  fbc: 'fb.1.1714546784212.IwAR2F4-dbP0l7Mn1IawQQ',
  ttp: '2Kx4mP9qLzQ0aBcDeFgHiJ',
  ttclid: 'E.C.P.CsoBhTkQ_test-click',
};
const adult = {
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames: 'Chioma',
  surname: 'Okafor',
  dateOfBirth: '1990-04-01',
  nationality: 'NG',
};

describe('ads with consent (e2e)', () => {
  let ctx: TestContext;
  let network: MockAdConversions;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, AD_CONVERSIONS: ['mock'] });
    const [provider] = ctx.app.get<AdConversionsProvider[]>(AD_CONVERSIONS_PROVIDERS);
    if (!(provider instanceof MockAdConversions)) throw new Error('expected the mock network');
    network = provider;
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    network.sent.length = 0;
    network.failNext = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function recordConsent(
    marketing: boolean,
    consentId: string = randomUUID(),
    policyVersion = COOKIE_POLICY_VERSION,
  ): Promise<string> {
    await ctx
      .http()
      .post('/v1/privacy/cookie-consents')
      .send({ consentId, policyVersion, choices: { analytics: false, marketing } })
      .expect(201);
    return consentId;
  }

  async function quoteId(): Promise<string> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .expect(201);
    return quote.body.quoteId as string;
  }

  function createBooking(
    quote: string,
    marketing: Record<string, unknown> | undefined,
    auth: Record<string, string> = {},
  ) {
    return ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .set(auth)
      .send({
        quoteId: quote,
        passengers: [adult],
        contact,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        ...(marketing ? { marketing } : {}),
      });
  }

  async function book(
    marketing?: Record<string, unknown>,
    auth: Record<string, string> = {},
  ): Promise<{ id: string; access: Record<string, string>; total: { amountMinor: number } }> {
    const created = await createBooking(await quoteId(), marketing, auth).expect(201);
    const access = created.body.accessToken
      ? { 'X-Booking-Token': created.body.accessToken as string }
      : auth;
    return { id: created.body.booking.id, access, total: created.body.booking.price.total };
  }

  async function pay(bookingId: string, access: Record<string, string>): Promise<void> {
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(access)
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
  }

  const sweep = async () =>
    (await ctx.http().post('/v1/internal/ad-conversions/run').set(INTERNAL).expect(200)).body as {
      sent: number;
      retried: number;
      failed: number;
      withdrawn: number;
    };
  const conversion = (bookingId: string) =>
    ctx.prisma.adConversion.findUnique({ where: { bookingId } });
  /** Lets a retry fall due without waiting. */
  const due = (bookingId: string) =>
    ctx.prisma.adConversion.update({
      where: { bookingId },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

  it('keeps the attribution only when the recorded consent allows marketing', async () => {
    const allowed = await recordConsent(true);
    const kept = await book({ consentId: allowed, ...CLICK_IDS });
    expect(await conversion(kept.id)).toMatchObject({
      consentId: allowed,
      clickIds: CLICK_IDS,
      status: 'waiting',
      attempts: 0,
    });

    // Marketing refused, a consent id the API never recorded, and a choice made under the old
    // policy: the booking goes through and nothing is kept.
    const refused = await book({ consentId: await recordConsent(false), ...CLICK_IDS });
    const unknown = await book({ consentId: randomUUID(), fbp: CLICK_IDS.fbp });
    const stale = await book({ consentId: await recordConsent(true, randomUUID(), 1) });
    for (const booking of [refused, unknown, stale])
      expect(await conversion(booking.id)).toBeNull();

    // Only click ids: anything else is refused before a booking exists.
    await createBooking(await quoteId(), {
      consentId: allowed,
      email: 'chioma@example.com',
    }).expect(400);
    expect(await ctx.prisma.booking.count()).toBe(4);
  });

  it('sends the Purchase once the booking is paid, with hashed contact details, then forgets the click ids', async () => {
    const booking = await book({ consentId: await recordConsent(true), ...CLICK_IDS });
    expect(await sweep()).toEqual({ sent: 0, retried: 0, failed: 0, withdrawn: 0 });
    expect(network.sent).toHaveLength(0);

    await pay(booking.id, booking.access);
    expect(await sweep()).toEqual({ sent: 1, retried: 0, failed: 0, withdrawn: 0 });
    expect(network.sent).toEqual([
      {
        eventId: booking.id,
        eventTime: expect.any(Date),
        value: (booking.total.amountMinor / 100).toFixed(2),
        currency: 'NGN',
        sourceUrl: `${WEB_ORIGIN}/bookings/${booking.id}`,
        contentIds: ['flights'],
        hashedEmail: sha256('chioma@example.com'),
        hashedPhone: sha256('2348012345678'),
        clickIds: CLICK_IDS,
      },
    ]);
    expect(await conversion(booking.id)).toMatchObject({
      status: 'sent',
      sentTo: ['mock'],
      clickIds: null,
      sentAt: expect.any(Date),
    });

    // Sent once: a second sweep has nothing to do.
    expect(await sweep()).toEqual({ sent: 0, retried: 0, failed: 0, withdrawn: 0 });
    expect(network.sent).toHaveLength(1);
  });

  it('retries a network that failed, and gives up after three sends', async () => {
    const recovers = await book({ consentId: await recordConsent(true), ttp: CLICK_IDS.ttp });
    await pay(recovers.id, recovers.access);
    network.failNext = 1;
    expect(await sweep()).toMatchObject({ retried: 1, sent: 0 });
    const waiting = await conversion(recovers.id);
    expect(waiting).toMatchObject({ status: 'waiting', attempts: 1, sentTo: [] });
    expect(waiting?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // Not before its time.
    expect(await sweep()).toMatchObject({ retried: 0, sent: 0 });
    await due(recovers.id);
    expect(await sweep()).toMatchObject({ sent: 1 });
    expect(network.sent.map((event) => event.eventId)).toEqual([recovers.id]);

    const lost = await book({ consentId: await recordConsent(true), ttp: CLICK_IDS.ttp });
    await pay(lost.id, lost.access);
    network.failNext = 3;
    expect(await sweep()).toMatchObject({ retried: 1 });
    await due(lost.id);
    expect(await sweep()).toMatchObject({ retried: 1 });
    await due(lost.id);
    expect(await sweep()).toMatchObject({ failed: 1 });
    expect(await conversion(lost.id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      clickIds: null,
    });
    expect(network.sent).toHaveLength(1);
  });

  it('sends nothing when the visitor turned marketing off before it went out', async () => {
    const consentId = await recordConsent(true);
    const booking = await book({ consentId, ...CLICK_IDS });
    await recordConsent(false, consentId);
    await pay(booking.id, booking.access);

    expect(await sweep()).toEqual({ sent: 0, retried: 0, failed: 0, withdrawn: 1 });
    expect(network.sent).toHaveLength(0);
    expect(await conversion(booking.id)).toMatchObject({ status: 'withdrawn', clickIds: null });
  });

  it('shows the record in the data export and deletes it with the account', async () => {
    const session = await signUp(ctx, 'ads@example.com');
    const auth = bearer(session.accessToken);
    const booking = await book({ consentId: await recordConsent(true), fbp: CLICK_IDS.fbp }, auth);

    const exported = await ctx
      .http()
      .post('/v1/me/data-export')
      .set(auth)
      .send({ password: PASSWORD })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks).toString('utf8')));
      })
      .expect(200);
    const document = JSON.parse(exported.body as string) as {
      data: {
        activity: { action: string; targetId: string; metadata: Record<string, unknown> }[];
      };
    };
    expect(document.data.activity).toContainEqual(
      expect.objectContaining({
        action: 'ads.purchase_conversion',
        targetId: booking.id,
        metadata: expect.objectContaining({ clickIds: { fbp: CLICK_IDS.fbp }, status: 'waiting' }),
      }),
    );

    // An unpaid booking that expired does not block the deletion.
    await ctx.prisma.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } });
    await ctx
      .http()
      .post('/v1/me/deletion')
      .set(auth)
      .send({ password: PASSWORD, confirm: 'DELETE' })
      .expect(200);
    expect(await conversion(booking.id)).toBeNull();
  });
});
