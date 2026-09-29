import { PricingService } from '../src/pricing/pricing.service';
import { SupplierUnavailableError } from '../src/suppliers/supplier.errors';
import { FlightSupplier, type SupplierFlightOffer } from '../src/suppliers/supplier.types';
import { FLIGHT_SUPPLIERS } from '../src/suppliers/suppliers.module';

import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

class BrokenSupplier extends FlightSupplier {
  readonly name = 'broken';
  search(): Promise<SupplierFlightOffer[]> {
    return Promise.reject(new SupplierUnavailableError(this.name, 'HTTP 503'));
  }
  reprice(): Promise<SupplierFlightOffer> {
    return Promise.reject(new SupplierUnavailableError(this.name, 'HTTP 503'));
  }
}

interface Deal {
  routeSlug: string;
  origin: { code: string; cityName: string };
  price: { amountMinor: number; currency: string };
  sample: boolean;
  updatedAt: string;
}

const HOUR = 3_600_000;

describe('homepage data (e2e): content, deals, destinations, newsletter', () => {
  let ctx: TestContext;

  const internal = (method: 'get' | 'post', path: string) =>
    ctx.http()[method](path).set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`);

  const targets = async () =>
    (await internal('get', '/v1/internal/refresh-targets').expect(200)).body as {
      dealRoutes: { id: string; slug: string }[];
      hotelDestinations: { id: string; slug: string }[];
    };

  /** Refreshes a seeded deal route through the internal API and returns the response. */
  const refreshRoute = async (slug: string, status = 200) => {
    const route = (await targets()).dealRoutes.find((entry) => entry.slug === slug);
    if (!route) throw new Error(`route ${slug} not seeded`);
    return internal('post', `/v1/internal/deals/routes/${route.id}/refresh`).expect(status);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('content', () => {
    it('returns only verified trust signals and empty business facts', async () => {
      const { body } = await ctx.http().get('/v1/content/site').expect(200);
      expect(body.trustSignals.map((signal: { key: string }) => signal.key)).toEqual([
        'support_24_7',
        'flexible_payment',
        'secure_payments',
      ]);
      expect(JSON.stringify(body)).not.toMatch(/IATA|2M\+|Travellers served/);
      expect(body).toMatchObject({
        contact: { phone: null, whatsapp: null, email: null },
        social: [],
        apps: { iosUrl: null, androidUrl: null },
        pages: [],
        paymentMethods: [],
      });
    });

    it('serves published homepage blocks and FAQs, with a locale fallback', async () => {
      const { body } = await ctx.http().get('/v1/content/home?locale=en-GB').expect(200);
      expect(body.hero.headline).toBe('Your one-stop travel shop');
      expect(body.prime).toMatchObject({ priceMonthly: null, priceYearly: null });
      expect(body.prime.benefits).toHaveLength(3);
      expect(body.whyBook.items).toHaveLength(4);
      expect(body.faqs.length).toBeGreaterThanOrEqual(3);
      await ctx.http().get('/v1/content/home?locale=fr-FR').expect(400);
    });

    it('hides drafts and ignores malformed CMS content', async () => {
      const where = { key_locale: { key: 'home.hero', locale: 'en-NG' } };
      const original = await ctx.prisma.cmsBlock.findUniqueOrThrow({ where });
      try {
        await ctx.prisma.cmsBlock.update({ where, data: { publishedAt: null } });
        expect((await ctx.http().get('/v1/content/home').expect(200)).body.hero).toBeNull();
        await ctx.prisma.cmsBlock.update({
          where,
          data: { publishedAt: new Date(), content: { headline: 42 } },
        });
        expect((await ctx.http().get('/v1/content/home').expect(200)).body.hero).toBeNull();
        await ctx.prisma.cmsBlock.update({
          where: { key_locale: { key: 'site.apps', locale: 'en-NG' } },
          data: { content: { iosUrl: 'https://evil.example/app', androidUrl: null } },
        });
        expect((await ctx.http().get('/v1/content/site').expect(200)).body.apps.iosUrl).toBeNull();
      } finally {
        await ctx.prisma.cmsBlock.update({
          where,
          data: { publishedAt: original.publishedAt, content: original.content ?? {} },
        });
        await ctx.prisma.cmsBlock.update({
          where: { key_locale: { key: 'site.apps', locale: 'en-NG' } },
          data: { content: { iosUrl: null, androidUrl: null } },
        });
      }
    });

    it('serves published structured pages and lists them for the footer', async () => {
      await ctx.prisma.cmsBlock.createMany({
        data: [
          {
            key: 'page.terms',
            content: {
              title: 'Terms of use',
              group: 'legal',
              sections: [{ heading: 'Scope', paragraphs: ['These terms apply to bookings.'] }],
            },
            publishedAt: new Date(),
          },
          {
            key: 'page.privacy',
            content: {
              title: 'Privacy policy',
              group: 'legal',
              sections: [{ paragraphs: ['Draft'] }],
            },
          },
        ],
      });
      try {
        const page = await ctx.http().get('/v1/content/pages/terms').expect(200);
        expect(page.body).toMatchObject({
          slug: 'terms',
          title: 'Terms of use',
          group: 'legal',
          sections: [{ heading: 'Scope', paragraphs: ['These terms apply to bookings.'] }],
        });
        await ctx.http().get('/v1/content/pages/privacy').expect(404);
        await ctx.http().get('/v1/content/pages/Not_A_Slug').expect(400);
        const site = await ctx.http().get('/v1/content/site').expect(200);
        expect(site.body.pages).toEqual([{ slug: 'terms', title: 'Terms of use', group: 'legal' }]);
      } finally {
        await ctx.prisma.cmsBlock.deleteMany({
          where: { key: { in: ['page.terms', 'page.privacy'] } },
        });
      }
    });
  });

  describe('internal routes', () => {
    it('require the service token', async () => {
      await ctx.http().get('/v1/internal/refresh-targets').expect(401);
      await ctx
        .http()
        .get('/v1/internal/refresh-targets')
        .set('Authorization', 'Bearer not-the-token-not-the-token-not-the-token')
        .expect(401);
      const { body } = await internal('get', '/v1/internal/refresh-targets').expect(200);
      expect(body.dealRoutes).toHaveLength(22);
      expect(body.hotelDestinations).toHaveLength(9);
    });

    it('do not exist when no token is configured', async () => {
      const bare = await createTestApp({ INTERNAL_API_TOKEN: undefined });
      try {
        await bare
          .http()
          .get('/v1/internal/refresh-targets')
          .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`)
          .expect(404);
      } finally {
        await bare.close();
      }
    });
  });

  describe('flight deals', () => {
    it('refreshes a route and serves a priced, labelled, timestamped deal', async () => {
      const refreshed = await refreshRoute('lagos-to-london');
      expect(refreshed.body).toMatchObject({ status: 'refreshed' });

      const { body } = await ctx.http().get('/v1/deals/flights').expect(200);
      expect(body.origins).toEqual([{ code: 'LOS', cityName: 'Lagos' }]);
      const [deal] = body.deals as Deal[];
      expect(deal).toMatchObject({
        routeSlug: 'lagos-to-london',
        origin: { code: 'LOS', cityName: 'Lagos' },
        destination: { code: 'LHR', cityName: 'London' },
        cabinClass: 'economy',
        sample: true,
        price: { currency: 'NGN' },
      });
      expect(deal?.price.amountMinor).toBeGreaterThan(0);
      expect(Date.parse(deal?.updatedAt ?? '')).toBeGreaterThan(Date.now() - 60_000);

      const usd = await ctx.http().get('/v1/deals/flights?currency=USD').expect(200);
      expect(usd.body.deals[0].price.currency).toBe('USD');
      const abuja = await ctx.http().get('/v1/deals/flights?origin=ABV').expect(200);
      expect(abuja.body.deals).toEqual([]);
    });

    it('prices on read, so new markup rules apply immediately', async () => {
      await refreshRoute('lagos-to-dubai');
      const before = (await ctx.http().get('/v1/deals/flights').expect(200)).body.deals[0] as Deal;
      await ctx.prisma.markupRule.create({
        data: {
          name: 'Test LOS 10%',
          vertical: 'flights',
          originCode: 'LOS',
          type: 'percentage',
          value: 1000n,
        },
      });
      ctx.app.get(PricingService).invalidate();
      const after = (await ctx.http().get('/v1/deals/flights').expect(200)).body.deals[0] as Deal;
      expect(after.price.amountMinor).toBeGreaterThan(before.price.amountMinor);
    });

    it('never serves stale deals and prunes old snapshots', async () => {
      await refreshRoute('nairobi-to-zanzibar');
      await ctx.prisma.dealSnapshot.updateMany({
        data: { fetchedAt: new Date(Date.now() - 25 * HOUR) },
      });
      expect((await ctx.http().get('/v1/deals/flights').expect(200)).body.deals).toEqual([]);
      const route = await ctx.http().get('/v1/deals/routes/nairobi-to-zanzibar').expect(200);
      expect(route.body.deal).toBeNull();

      await ctx.prisma.dealSnapshot.updateMany({
        data: { fetchedAt: new Date(Date.now() - 8 * 24 * HOUR) },
      });
      const pruned = await internal('post', '/v1/internal/snapshots/prune').expect(200);
      expect(pruned.body).toEqual({ deletedDeals: 1, deletedDestinations: 0 });
    });

    it('describes routes for SEO pages', async () => {
      await refreshRoute('abuja-to-london');
      const { body } = await ctx.http().get('/v1/deals/routes/abuja-to-london').expect(200);
      expect(body).toMatchObject({
        slug: 'abuja-to-london',
        origin: { code: 'ABV', cityName: 'Abuja' },
        destination: { code: 'LHR' },
        stayNights: 7,
        deal: { routeSlug: 'abuja-to-london', sample: true },
      });
      expect(body.relatedRoutes.map((route: { slug: string }) => route.slug)).toEqual([
        'abuja-to-dubai',
        'abuja-to-lagos',
        'abuja-to-istanbul',
      ]);
      const all = await ctx.http().get('/v1/deals/routes').expect(200);
      expect(all.body.routes).toHaveLength(22);
      await ctx.http().get('/v1/deals/routes/lagos-to-atlantis').expect(404);
    });

    it('answers 503 when every supplier search fails, so the worker retries', async () => {
      const broken = await createTestApp(
        {},
        { overrides: [{ provide: FLIGHT_SUPPLIERS, useValue: [new BrokenSupplier()] }] },
      );
      try {
        const route = (
          await broken
            .http()
            .get('/v1/internal/refresh-targets')
            .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`)
        ).body.dealRoutes[0] as { id: string };
        await broken
          .http()
          .post(`/v1/internal/deals/routes/${route.id}/refresh`)
          .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`)
          .expect(503);
        expect(await broken.prisma.dealSnapshot.count()).toBe(0);
      } finally {
        await broken.close();
      }
    });
  });

  describe('hotel destinations', () => {
    it('lists featured destinations and adds prices after a refresh', async () => {
      const before = await ctx.http().get('/v1/destinations/hotels').expect(200);
      expect(before.body.destinations.map((entry: { slug: string }) => entry.slug)).toEqual([
        'dubai',
        'london',
        'accra',
        'nairobi',
        'cape-town',
        'istanbul',
        'zanzibar',
        'lagos',
        'abuja',
      ]);
      expect(before.body.destinations[0]).toMatchObject({
        city: { name: 'Dubai' },
        country: { code: 'AE', name: 'United Arab Emirates' },
        hotelCount: null,
        fromPricePerNight: null,
        imageUrl: null,
      });

      const dubai = (await targets()).hotelDestinations.find((entry) => entry.slug === 'dubai');
      await internal('post', `/v1/internal/destinations/${dubai?.id}/refresh`)
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('refreshed'));
      const { body } = await ctx
        .http()
        .get('/v1/destinations/hotels/dubai?currency=USD')
        .expect(200);
      expect(body.hotelCount).toBeGreaterThan(0);
      expect(body.fromPricePerNight).toMatchObject({ currency: 'USD' });
      expect(body.sample).toBe(true);
      await ctx.http().get('/v1/destinations/hotels/atlantis').expect(404);
    });
  });

  describe('newsletter', () => {
    const subscribe = (body: Record<string, unknown>) =>
      ctx
        .http()
        .post('/v1/newsletter/subscriptions')
        .send({ consent: true, turnstileToken: 'ok', ...body });
    const tokenFrom = (text: string, page: string): string => {
      const match = new RegExp(`/newsletter/${page}#token=([^\\s]+)`).exec(text);
      if (!match?.[1]) throw new Error(`no ${page} link in email`);
      return match[1];
    };

    it('runs the double opt-in with fragment tokens', async () => {
      await subscribe({ email: 'Ada@Example.com' })
        .expect(202)
        .expect(({ body }) => expect(body).toEqual({ status: 'pending_confirmation' }));
      const [email] = ctx.emails.outbox;
      expect(email).toMatchObject({ to: 'ada@example.com', template: 'newsletter-confirm' });
      const row = await ctx.prisma.newsletterSubscription.findUniqueOrThrow({
        where: { email: 'ada@example.com' },
      });
      expect(row).toMatchObject({
        status: 'pending',
        consentVersion: '2026-09-29',
        source: 'homepage',
      });
      expect(row.consentIpHash).toEqual(expect.any(String));
      const confirmToken = tokenFrom(email?.text ?? '', 'confirm');
      expect(row.confirmTokenHash).not.toContain(confirmToken);

      await ctx.http().post('/v1/newsletter/confirm').send({ token: confirmToken }).expect(200);
      await ctx.http().post('/v1/newsletter/confirm').send({ token: confirmToken }).expect(200);
      expect(
        (await ctx.prisma.newsletterSubscription.findUniqueOrThrow({ where: { id: row.id } }))
          .status,
      ).toBe('confirmed');

      const unsubscribeToken = tokenFrom(email?.text ?? '', 'unsubscribe');
      await ctx
        .http()
        .post('/v1/newsletter/unsubscribe')
        .send({ token: unsubscribeToken })
        .expect(200);
      await ctx
        .http()
        .post('/v1/newsletter/unsubscribe')
        .send({ token: unsubscribeToken })
        .expect(200);
      expect(
        (await ctx.prisma.newsletterSubscription.findUniqueOrThrow({ where: { id: row.id } }))
          .status,
      ).toBe('unsubscribed');
      await ctx.http().post('/v1/newsletter/confirm').send({ token: confirmToken }).expect(400);
    });

    it('answers the same for new, pending and confirmed addresses', async () => {
      await subscribe({ email: 'known@example.com' }).expect(202);
      await subscribe({ email: 'known@example.com' }).expect(202);
      expect(ctx.emails.outbox).toHaveLength(1);
      await ctx.prisma.newsletterSubscription.update({
        where: { email: 'known@example.com' },
        data: { status: 'confirmed' },
      });
      await subscribe({ email: 'known@example.com' })
        .expect(202)
        .expect(({ body }) => expect(body).toEqual({ status: 'pending_confirmation' }));
      expect(ctx.emails.outbox).toHaveLength(1);
    });

    it('records WhatsApp opt-in as pending verification', async () => {
      await subscribe({ email: 'wa@example.com', whatsapp: { phone: '+2348012345678' } }).expect(
        202,
      );
      expect(
        await ctx.prisma.newsletterSubscription.findUniqueOrThrow({
          where: { email: 'wa@example.com' },
        }),
      ).toMatchObject({ whatsappPhone: '+2348012345678', whatsappStatus: 'pending_verification' });
    });

    it('requires consent, a valid email and a passing bot check', async () => {
      await subscribe({ email: 'x@example.com', consent: false }).expect(400);
      await subscribe({ email: 'not-an-email' }).expect(400);
      await subscribe({ email: 'x@example.com', whatsapp: { phone: '0801' } }).expect(400);
      await subscribe({ email: 'x@example.com', turnstileToken: 'fail' })
        .expect(400)
        .expect(({ body }) => expect(body.type).toMatch(/bot-check-failed$/));
      expect(await ctx.prisma.newsletterSubscription.count()).toBe(0);
    });

    it('rejects forged and expired links', async () => {
      await ctx
        .http()
        .post('/v1/newsletter/confirm')
        .send({ token: 'forged-token-forged-token' })
        .expect(400);
      await subscribe({ email: 'late@example.com' }).expect(202);
      const text = ctx.emails.outbox[0]?.text ?? '';
      const unsubscribe = tokenFrom(text, 'unsubscribe');
      await ctx
        .http()
        .post('/v1/newsletter/unsubscribe')
        .send({ token: `${unsubscribe.slice(0, -2)}xx` })
        .expect(400);
      await ctx.prisma.newsletterSubscription.update({
        where: { email: 'late@example.com' },
        data: { confirmTokenExpiresAt: new Date(Date.now() - 1000) },
      });
      await ctx
        .http()
        .post('/v1/newsletter/confirm')
        .send({ token: tokenFrom(text, 'confirm') })
        .expect(400);
    });

    it('limits sign-ups per email address', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await subscribe({ email: 'spam@example.com' }).expect(202);
      }
      await subscribe({ email: 'spam@example.com' }).expect(429);
    });
  });
});
