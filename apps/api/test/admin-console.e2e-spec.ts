import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';

import { cleanAdminContent, staffSession } from './helpers/admin';
import { bearer, enrolTotp, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Phase 10 admin API behaviour (ADR-035, ADR-036): booking search and support tools, account
 * controls, validated pricing and promo edits, deal routes, destinations, CMS publishing, trust
 * signal verification and the dashboard. Permissions and audit coverage have their own suites.
 */

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
let keySequence = 0;
const idempotencyKey = (): string => `e2e-admin-console-${Date.now()}-${(keySequence += 1)}`;

const adult = {
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames: 'Ngozi',
  surname: 'Adeyemi',
  dateOfBirth: '1991-03-05',
  nationality: 'NG',
  document: { number: 'A1234567', issuingCountry: 'NG', expiryDate: inDays(3000) },
};

const markup = (overrides: Record<string, unknown> = {}) => ({
  name: 'Flights base',
  vertical: 'flights',
  priority: 100,
  active: true,
  channel: null,
  userTier: null,
  supplier: null,
  originCode: null,
  destinationCode: null,
  originCountry: null,
  destinationCountry: null,
  carrierCode: null,
  cabinClass: null,
  type: 'percentage',
  value: 250,
  currency: null,
  minAmountMinor: null,
  maxAmountMinor: null,
  validFrom: null,
  validTo: null,
  ...overrides,
});

const promo = (overrides: Record<string, unknown> = {}) => ({
  code: 'welcome10',
  description: null,
  type: 'percentage',
  value: 1000,
  currency: null,
  maxDiscountMinor: null,
  minSpendMinor: null,
  verticals: [],
  validFrom: null,
  validTo: null,
  maxRedemptions: null,
  maxRedemptionsPerUser: null,
  requiresAccount: false,
  active: true,
  ...overrides,
});

describe('admin console API (e2e)', () => {
  let ctx: TestContext;
  let admin: TokenSession;
  let headers: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await cleanAdminContent(ctx);
    admin = await staffSession(ctx, 'console-admin@suskii.test', ['super_admin']);
    headers = bearer(admin.accessToken);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await cleanAdminContent(ctx);
    await ctx.close();
  });

  const get = (path: string) => ctx.http().get(`/v1/admin/${path}`).set(headers);
  const post = (path: string, body: object = {}) =>
    ctx.http().post(`/v1/admin/${path}`).set(headers).send(body);
  const patch = (path: string, body: object) =>
    ctx.http().patch(`/v1/admin/${path}`).set(headers).send(body);
  const put = (path: string, body: object) =>
    ctx.http().put(`/v1/admin/${path}`).set(headers).send(body);

  /** A domestic flight booked as a guest; paid (and ticketed by the mock supplier) on request. */
  async function flightBooking(options: { pay: boolean; email?: string }) {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offerId = (search.body.offers as { id: string }[])[0]?.id ?? '';
    const quote = await ctx.http().post(`/v1/flights/offers/${offerId}/quote`).expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId,
        contact: { email: options.email ?? 'ngozi@example.com', phone: '+2348012345678' },
        passengers: [adult],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    const id = created.body.booking.id as string;
    const reference = created.body.booking.reference as string;
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    if (options.pay) {
      const payment = await ctx
        .http()
        .post(`/v1/bookings/${id}/payments`)
        .set('Idempotency-Key', idempotencyKey())
        .set(token)
        .send({})
        .expect(201);
      const ref = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
      await ctx
        .http()
        .post(`/v1/payments/mock/${ref}/complete`)
        .send({ outcome: 'succeeded' })
        .expect(200);
      await ctx.background.drain();
    }
    return { id, reference, token };
  }

  describe('bookings', () => {
    it('finds bookings by reference or contact email only, and shows the timeline and notes', async () => {
      const paid = await flightBooking({ pay: true, email: 'Ngozi.A@Example.com' });
      const unpaid = await flightBooking({ pay: false, email: 'someone@example.com' });

      const byReference = await get(`bookings?q=${paid.reference.toLowerCase()}`).expect(200);
      expect(byReference.body.items).toEqual([
        expect.objectContaining({
          id: paid.id,
          reference: paid.reference,
          vertical: 'flights',
          trip: expect.objectContaining({
            flight: expect.objectContaining({
              origin: { code: 'LOS', cityName: expect.any(String) },
            }),
          }),
        }),
      ]);
      const byEmail = await get('bookings?q=ngozi.a@example.com').expect(200);
      expect(byEmail.body.items.map((row: { id: string }) => row.id)).toEqual([paid.id]);
      // Names and partial emails are not searchable: contact details are only stored as HMACs.
      expect((await get('bookings?q=Adeyemi').expect(200)).body.items).toEqual([]);
      expect((await get('bookings?q=ngozi').expect(200)).body.items).toEqual([]);
      const all = await get('bookings?limit=1').expect(200);
      expect(all.body.items).toHaveLength(1);
      expect(all.body.items[0].id).toBe(unpaid.id);
      expect(all.body.nextCursor).toBe(unpaid.id);

      await post(`bookings/${paid.id}/notes`, { text: 'Prefers WhatsApp.' }).expect(201);
      const stored = await ctx.prisma.bookingNote.findFirstOrThrow({
        where: { bookingId: paid.id },
      });
      expect(stored.bodyEncrypted).not.toContain('WhatsApp');
      const detail = await get(`bookings/${paid.id}`).expect(200);
      expect(detail.body.notes).toEqual([
        expect.objectContaining({ authorId: admin.userId, text: 'Prefers WhatsApp.' }),
      ]);
      expect(detail.body.history.map((row: { toStatus: string }) => row.toStatus)).toContain(
        'PAID',
      );
      expect(detail.body.payments).toEqual([
        expect.objectContaining({ kind: 'checkout', status: 'succeeded' }),
      ]);
      // The booking view masks the contact; revealing it is a separate, audited call.
      expect(JSON.stringify(detail.body.booking)).not.toContain('ngozi.a@example.com');
      const contact = await post(`bookings/${paid.id}/contact`).expect(200);
      expect(contact.body).toEqual({
        email: 'ngozi.a@example.com',
        phone: '+2348012345678',
        redacted: false,
      });

      const resend = await post(`bookings/${unpaid.id}/confirmation`).expect(409);
      expect(resend.body.type).toBe('urn:suskii:problem:booking-not-confirmed');
      await get('bookings/0192f0e0-0000-7000-8000-000000000000').expect(404);
    });
  });

  describe('users', () => {
    it('searches accounts, disables them (signing them out) and resets MFA', async () => {
      const customer = await signUp(ctx, 'tolu@example.com');
      const found = await get('users?q=TOLU').expect(200);
      expect(found.body.items).toEqual([
        expect.objectContaining({ id: customer.userId, roles: ['customer'], mfaEnabled: false }),
      ]);
      const staff = await get('users?staffOnly=true').expect(200);
      expect(staff.body.items.map((user: { id: string }) => user.id)).toEqual([admin.userId]);

      const disabled = await post(`users/${customer.userId}/disable`).expect(200);
      expect(disabled.body.status).toBe('disabled');
      await ctx.http().get('/v1/me').set(bearer(customer.accessToken)).expect(401);
      expect((await post(`users/${customer.userId}/enable`).expect(200)).body.status).toBe(
        'active',
      );

      const own = await post(`users/${admin.userId}/disable`).expect(409);
      expect(own.body.type).toBe('urn:suskii:problem:cannot-change-own-account');
      const none = await post(`users/${customer.userId}/mfa-reset`).expect(409);
      expect(none.body.type).toBe('urn:suskii:problem:mfa-not-enabled');

      const enrolled = await signUp(ctx, 'mfa@example.com');
      await enrolTotp(ctx, enrolled.accessToken);
      const reset = await post(`users/${enrolled.userId}/mfa-reset`).expect(200);
      expect(reset.body.mfaEnabled).toBe(false);
      expect(await ctx.prisma.mfaRecoveryCode.count({ where: { userId: enrolled.userId } })).toBe(
        0,
      );
    });
  });

  describe('pricing and promos', () => {
    it('validates markup and fee rules, merged patches included, and clears the rule cache', async () => {
      const invalidate = jest.spyOn(ctx.app.get(PricingService), 'invalidate');
      const tooLarge = await post('pricing/markups', markup({ value: 10_001 })).expect(400);
      expect(tooLarge.body.errors).toEqual([
        expect.objectContaining({ path: 'value', message: 'percent_too_large' }),
      ]);
      const noCurrency = await post('pricing/markups', markup({ type: 'fixed' })).expect(400);
      expect(noCurrency.body.errors).toEqual([
        expect.objectContaining({ path: 'currency', message: 'currency_required' }),
      ]);
      await post('pricing/markups', markup({ value: -1 })).expect(400);

      const created = await post('pricing/markups', markup()).expect(201);
      expect(invalidate).toHaveBeenCalledTimes(1);
      const merged = await patch(`pricing/markups/${created.body.id as string}`, {
        type: 'fixed',
      }).expect(400);
      expect(merged.body.errors).toEqual([
        expect.objectContaining({ path: 'currency', message: 'currency_required' }),
      ]);
      const changed = await patch(`pricing/markups/${created.body.id as string}`, {
        type: 'fixed',
        value: 500_000,
        currency: 'NGN',
      }).expect(200);
      expect(changed.body).toMatchObject({ type: 'fixed', value: 500_000, currency: 'NGN' });
      expect(invalidate).toHaveBeenCalledTimes(2);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'pricing.markup_updated', targetId: created.body.id as string },
      });
      expect(audit.metadata).toEqual({
        changes: {
          type: { from: 'percentage', to: 'fixed' },
          value: { from: 250, to: 500_000 },
          currency: { from: null, to: 'NGN' },
        },
      });
      expect((await get('pricing/markups?vertical=hotels').expect(200)).body.rules).toEqual([]);
      invalidate.mockRestore();
    });

    it('normalises promo codes, refuses duplicates and locks a redeemed code', async () => {
      const created = await post('promos', promo()).expect(201);
      expect(created.body).toMatchObject({ code: 'WELCOME10', redemptions: 0 });
      const duplicate = await post('promos', promo({ code: 'Welcome10' })).expect(409);
      expect(duplicate.body.type).toBe('urn:suskii:problem:promo-code-taken');
      await post('promos', promo({ code: 'ABC' })).expect(400);
      await post('promos', promo({ code: 'BIG', value: 20_000 })).expect(400);

      await ctx.prisma.promoRedemption.create({
        data: {
          promoCodeId: created.body.id as string,
          amountMinor: 100n,
          currency: 'NGN',
        },
      });
      const locked = await patch(`promos/${created.body.id as string}`, {
        code: 'WELCOME20',
      }).expect(409);
      expect(locked.body.type).toBe('urn:suskii:problem:promo-code-locked');
      const deactivated = await patch(`promos/${created.body.id as string}`, {
        active: false,
      }).expect(200);
      expect(deactivated.body).toMatchObject({ active: false, redemptions: 1 });
      const page = await get('promos?q=wel&active=false').expect(200);
      expect(page.body.items.map((item: { code: string }) => item.code)).toEqual(['WELCOME10']);
    });
  });

  describe('deal routes and destinations', () => {
    it('checks airports and uniqueness, and keeps the first publication time', async () => {
      const route = {
        slug: 'e2e-lagos-to-kano-first',
        originCode: 'LOS',
        destinationCode: 'KAN',
        cabinClass: 'first',
        stayNights: 4,
        active: false,
        sortOrder: 900,
      };
      await post('deal-routes', { ...route, destinationCode: 'LOS' }).expect(400);
      const unknown = await post('deal-routes', { ...route, destinationCode: 'QQQ' }).expect(422);
      expect(unknown.body.type).toBe('urn:suskii:problem:airport-unknown');
      const created = await post('deal-routes', route).expect(201);
      expect(created.body.lastRefreshedAt).toBeNull();
      const duplicate = await post('deal-routes', { ...route, slug: 'e2e-other' }).expect(409);
      expect(duplicate.body.type).toBe('urn:suskii:problem:deal-route-exists');

      const city = await ctx.prisma.city.findFirstOrThrow({
        where: { destination: null, countryCode: 'NG' },
        orderBy: { name: 'asc' },
      });
      const destination = {
        cityId: city.id,
        slug: 'e2e-city',
        featured: false,
        sortOrder: 900,
        imageUrl: null,
        published: false,
      };
      const missing = await post('destinations', {
        ...destination,
        cityId: '0192f0e0-0000-7000-8000-000000000000',
      }).expect(422);
      expect(missing.body.type).toBe('urn:suskii:problem:city-unknown');
      await post('destinations', { ...destination, imageUrl: 'http://example.com/a.jpg' }).expect(
        400,
      );
      const draft = await post('destinations', destination).expect(201);
      expect(draft.body).toMatchObject({ cityName: city.name, publishedAt: null });
      const id = draft.body.id as string;
      const published = await patch(`destinations/${id}`, { published: true }).expect(200);
      expect(published.body.publishedAt).toEqual(expect.any(String));
      const featured = await patch(`destinations/${id}`, { featured: true }).expect(200);
      expect(featured.body.publishedAt).toBe(published.body.publishedAt);
      expect(
        (await patch(`destinations/${id}`, { published: false }).expect(200)).body,
      ).toMatchObject({ published: false, publishedAt: null });
    });
  });

  describe('content and trust signals', () => {
    it('validates CMS blocks against the public schemas and publishes them', async () => {
      const page = {
        title: 'Careers',
        group: 'company',
        sections: [{ heading: 'Join us', paragraphs: ['We are hiring.'] }],
      };
      const invalid = await put('content/blocks/en-NG/page.e2e-careers', {
        content: { ...page, title: '' },
        published: true,
      }).expect(400);
      expect(invalid.body.errors).toEqual([expect.objectContaining({ path: 'content.title' })]);
      await put('content/blocks/en-NG/home.unknown', { content: {}, published: true }).expect(400);
      await put('content/blocks/fr-FR/page.e2e-careers', { content: page, published: true }).expect(
        400,
      );

      await put('content/blocks/en-NG/page.e2e-careers', {
        content: page,
        published: false,
      }).expect(200);
      await ctx.http().get('/v1/content/pages/e2e-careers').expect(404);
      const live = await put('content/blocks/en-NG/page.e2e-careers', {
        content: page,
        published: true,
      }).expect(200);
      expect(live.body).toMatchObject({ published: true, valid: true });
      const shown = await ctx.http().get('/v1/content/pages/e2e-careers').expect(200);
      expect(shown.body).toMatchObject({ title: 'Careers', group: 'company' });
      const audit = await ctx.prisma.auditLog.findMany({
        where: { action: 'cms.block_saved', actorUserId: admin.userId },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((row) => row.metadata)).toEqual([
        {
          key: 'page.e2e-careers',
          locale: 'en-NG',
          contentChanged: true,
          published: { from: null, to: false },
        },
        {
          key: 'page.e2e-careers',
          locale: 'en-NG',
          contentChanged: false,
          published: { from: false, to: true },
        },
      ]);
      const list = await get('content/blocks?locale=en-NG').expect(200);
      expect(list.body.fixedKeys).toContain('home.hero');
    });

    it('publishes FAQs per locale', async () => {
      const created = await post('content/faqs', {
        locale: 'en-US',
        question: 'E2E: can I pay later?',
        answer: 'Yes, with a payment plan.',
        sortOrder: 1,
        published: true,
      }).expect(201);
      const home = await ctx.http().get('/v1/content/home?locale=en-US').expect(200);
      expect(home.body.faqs).toEqual([
        expect.objectContaining({ id: created.body.id, question: 'E2E: can I pay later?' }),
      ]);
      await patch(`content/faqs/${created.body.id as string}`, { published: false }).expect(200);
      const after = await ctx.http().get('/v1/content/home?locale=en-US').expect(200);
      expect(after.body.faqs.map((faq: { id: string }) => faq.id)).not.toContain(created.body.id);
    });

    it('shows a trust signal only while verified with evidence; editing the claim hides it', async () => {
      await ctx.prisma.trustSignal.create({
        data: { key: 'e2e_award', label: 'Award winning', sortOrder: 900 },
      });
      const keys = async () =>
        (
          (await ctx.http().get('/v1/content/site').expect(200)).body.trustSignals as {
            key: string;
          }[]
        ).map((signal) => signal.key);
      expect(await keys()).not.toContain('e2e_award');

      await post('trust-signals/e2e_award/verify', {
        evidenceUrl: 'http://example.com/award.pdf',
      }).expect(400);
      const verified = await post('trust-signals/e2e_award/verify', {
        evidenceUrl: 'https://example.com/award.pdf',
      }).expect(200);
      expect(verified.body).toMatchObject({
        verified: true,
        verifiedBy: admin.userId,
        evidenceUrl: 'https://example.com/award.pdf',
      });
      expect(await keys()).toContain('e2e_award');

      const reordered = await patch('trust-signals/e2e_award', { sortOrder: 901 }).expect(200);
      expect(reordered.body.verified).toBe(true);
      const edited = await patch('trust-signals/e2e_award', { value: '3x' }).expect(200);
      expect(edited.body).toMatchObject({ verified: false, verifiedAt: null, value: '3x' });
      expect(await keys()).not.toContain('e2e_award');
      const notVerified = await post('trust-signals/e2e_award/unverify', {
        reason: 'Checking again',
      }).expect(409);
      expect(notVerified.body.type).toBe('urn:suskii:problem:trust-signal-not-verified');

      // Content managers edit claims; only super admins verify them.
      const editor = await staffSession(ctx, 'editor@suskii.test', ['content_manager']);
      await ctx
        .http()
        .post('/v1/admin/trust-signals/e2e_award/verify')
        .set(bearer(editor.accessToken))
        .send({ evidenceUrl: 'https://example.com/award.pdf' })
        .expect(403);
    });
  });

  describe('dashboard', () => {
    it('counts bookings, sums ledger money per currency and lists the top routes', async () => {
      await flightBooking({ pay: true });
      await flightBooking({ pay: true, email: 'second@example.com' });
      await flightBooking({ pay: false, email: 'unpaid@example.com' });

      const dashboard = await get('dashboard').expect(200);
      expect(dashboard.body.range).toEqual({ from: inDays(-29), to: today });
      expect(dashboard.body.bookings.total).toBe(3);
      expect(dashboard.body.bookings.byVertical).toEqual([{ vertical: 'flights', count: 3 }]);
      const paidTotal = await ctx.prisma.payment.aggregate({
        where: { status: 'succeeded' },
        _sum: { amountMinor: true },
      });
      expect(dashboard.body.money).toEqual([
        {
          currency: 'NGN',
          captured: { amountMinor: Number(paidTotal._sum.amountMinor), currency: 'NGN' },
          fromWallet: { amountMinor: 0, currency: 'NGN' },
          refunded: { amountMinor: 0, currency: 'NGN' },
        },
      ]);
      expect(dashboard.body.topRoutes).toEqual([
        { origin: 'LOS', destination: 'ABV', bookings: 2 },
      ]);
      expect(dashboard.body.queues).toEqual({
        refundsAwaitingApproval: 0,
        refundsNeedingReview: 0,
        bookingsRefundPending: 0,
        visaApplicationsToReview: 0,
        referralsInReview: 0,
      });
      expect(dashboard.body.accounts.created).toBeGreaterThanOrEqual(1);
      // No personal data: counts and sums only.
      expect(JSON.stringify(dashboard.body)).not.toMatch(/example\.com|Adeyemi/);

      const old = await get('dashboard?from=2020-01-01&to=2020-01-31').expect(200);
      expect(old.body.bookings.total).toBe(0);
      expect(old.body.money).toEqual([]);
      await get(`dashboard?from=2020-01-01&to=${today}`).expect(400);
      await get('dashboard?from=2020-02-01&to=2020-01-01').expect(400);
    });
  });
});
