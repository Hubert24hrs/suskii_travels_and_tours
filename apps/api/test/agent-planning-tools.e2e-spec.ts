import type { AgentScope } from '@suskii/shared';

import { AgentGrants, type AgentGrant } from '../src/agent/agent-grants';
import { FARE_TREND_BASIS, PASSPORT_REMINDER } from '../src/agent/tools/planning-tools';
import { PricingService } from '../src/pricing/pricing.service';

import { bearer, signUp, type TokenSession } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * What the assistant reads to help someone plan (ADR-101): how fares on a route have moved
 * (a description, never a forecast), whether the passports saved on the account last long
 * enough (counts only), and the travel policy of the company the traveller books for. Called
 * through the tool gateway, as the agent service would.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefgh';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghij';
const DAY = 86_400_000;
const GUEST_SCOPES: AgentScope[] = ['catalog', 'search', 'quotes', 'support'];

interface Answer {
  status: 'ok' | 'denied' | 'error' | 'timeout';
  reason: string | null;
  result: Record<string, unknown> | null;
}

const addDays = (days: number): string =>
  new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

describe('planning tools of the assistant (e2e)', () => {
  let ctx: TestContext;
  let grants: AgentGrants;
  let ada: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'mock',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
    });
    grants = ctx.app.get(AgentGrants);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    ada = await signUp(ctx, 'plan-ada@example.com');
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  const grantFor = async (over: Partial<AgentGrant> = {}): Promise<string> => {
    const run = await ctx.prisma.agentRun.create({
      data: {
        audience: 'customer',
        channel: 'web',
        agent: 'concierge',
        trigger: 'message',
        status: 'running',
      },
    });
    return grants.issue({
      runId: run.id,
      conversationId: null,
      userId: ada.userId,
      roles: ['customer'],
      audience: 'customer',
      channel: 'web',
      scopes: [...GUEST_SCOPES, 'account'],
      locale: 'en-NG',
      currency: 'NGN',
      country: 'NG',
      ...over,
    });
  };
  const guestGrant = (): Promise<string> =>
    grantFor({ userId: null, roles: [], scopes: GUEST_SCOPES });

  const call = async (
    tool: string,
    agent: string,
    args: Record<string, unknown>,
    grant?: string,
  ): Promise<Answer> => {
    const response = await ctx
      .http()
      .post(`/v1/internal/agent-tools/${tool}`)
      .set('authorization', `Bearer ${TOOLS_TOKEN}`)
      .send({ grant: grant ?? (await grantFor()), agent, arguments: args });
    expect(response.status).toBe(200);
    return response.body as Answer;
  };

  describe('fares.trend', () => {
    const routeId = async (slug: string): Promise<string> =>
      (await ctx.prisma.dealRoute.findUniqueOrThrow({ where: { slug } })).id;

    /** Today's fares copied to earlier days, each at `percent` of today's. */
    const history = async (slug: string, days: { ago: number; percent: number }[]) => {
      const all = await ctx.prisma.routeFare.findMany({
        where: { routeId: await routeId(slug) },
        orderBy: { observedOn: 'desc' },
      });
      const today = all[0]?.observedOn ?? new Date();
      // Only the day the refresh ran is copied, however many days were copied before.
      const rows = all.filter((row) => row.observedOn.getTime() === today.getTime());
      for (const { ago, percent } of days) {
        for (const row of rows) {
          const { id: _id, updatedAt: _updatedAt, ...copy } = row;
          const scale = (value: bigint): bigint => (value * BigInt(percent)) / 100n;
          await ctx.prisma.routeFare.create({
            data: {
              ...copy,
              observedOn: new Date(today.getTime() - ago * DAY),
              baseMinor: scale(row.baseMinor),
              taxesMinor: scale(row.taxesMinor),
              usdMinor: scale(row.usdMinor),
            },
          });
        }
      }
    };
    const refresh = async (slug: string) =>
      ctx
        .http()
        .post(`/v1/internal/deals/routes/${await routeId(slug)}/refresh`)
        .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`)
        .expect(200);

    it('says a route has no history, or not enough, instead of guessing', async () => {
      const unknown = await call(
        'fares.trend',
        'flights',
        { origin: 'ABV', destination: 'CDG' },
        await guestGrant(),
      );
      expect(unknown).toMatchObject({
        status: 'ok',
        result: {
          followed: false,
          enoughHistory: false,
          lowestRecentFare: null,
          typicalFare: null,
          recentFaresComparedWithEarlier: 'unknown',
          basis: FARE_TREND_BASIS,
          cards: [],
        },
      });

      // One day of fares is a price, not a history.
      await refresh('lagos-to-london');
      const thin = await call('fares.trend', 'flights', { origin: 'LOS', destination: 'LHR' });
      expect(thin.result).toMatchObject({
        followed: true,
        enoughHistory: false,
        lowestRecentFare: null,
        recentFaresComparedWithEarlier: 'unknown',
      });
      // Whatever is said about this route's fares is read with the note (ADR-107).
      expect(thin.result?.cards).toEqual([
        expect.objectContaining({ kind: 'link', href: '/flights/lagos-to-london' }),
        { kind: 'note', title: 'fare_trend', lines: [] },
      ]);
    });

    it('describes what was found: the recent low, the typical fare and how the month compares', async () => {
      await refresh('lagos-to-london');
      await history('lagos-to-london', [
        // The last month, at today's level.
        ...[1, 2, 3, 4, 5].map((ago) => ({ ago, percent: 100 })),
        // The two months before, a third dearer.
        ...[40, 45, 50, 55, 60, 65].map((ago) => ({ ago, percent: 133 })),
      ]);

      const answer = await call('fares.trend', 'trip_builder', {
        origin: 'LOS',
        destination: 'LHR',
      });
      expect(answer.status).toBe('ok');
      const result = answer.result as {
        daysWithFares: number;
        lowestRecentFare: { amountMinor: number; currency: string };
        typicalFare: { amountMinor: number; currency: string };
        lowestRecentFareDeparts: string;
      } & Record<string, unknown>;
      expect(result).toMatchObject({
        followed: true,
        enoughHistory: true,
        sample: true,
        daysWithFares: 12,
        recentFaresComparedWithEarlier: 'lower',
        basis: FARE_TREND_BASIS,
      });
      // Money in the caller's currency, as the route page prices it; never a float.
      expect(result.lowestRecentFare.currency).toBe('NGN');
      expect(Number.isInteger(result.lowestRecentFare.amountMinor)).toBe(true);
      expect(result.typicalFare.amountMinor).toBeGreaterThanOrEqual(
        result.lowestRecentFare.amountMinor,
      );
      expect(result.lowestRecentFareDeparts).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The page a traveller can check it on is the route's own.
      const page = await ctx.http().get('/v1/deals/routes/lagos-to-london').expect(200);
      expect(
        (page.body as { facts: { cheapest: { price: unknown } } }).facts.cheapest.price,
      ).toEqual(result.lowestRecentFare);

      // Dearer lately reads the other way; the same level reads steady.
      await ctx.prisma.routeFare.deleteMany({
        where: { observedOn: { lt: new Date(Date.now() - 30 * DAY) } },
      });
      await history(
        'lagos-to-london',
        [40, 45, 50, 55, 60].map((ago) => ({ ago, percent: 70 })),
      );
      const dearer = await call('fares.trend', 'flights', { origin: 'LOS', destination: 'LHR' });
      expect(dearer.result).toMatchObject({ recentFaresComparedWithEarlier: 'higher' });
    });

    it('is the flight and planning agents’ only, and refuses the same airport twice', async () => {
      expect(
        await call('fares.trend', 'payments', { origin: 'LOS', destination: 'LHR' }),
      ).toMatchObject({ status: 'denied', reason: 'agent' });
      expect(
        await call('fares.trend', 'flights', { origin: 'LOS', destination: 'LOS' }),
      ).toMatchObject({ status: 'denied', reason: 'invalid' });
    });
  });

  describe('documents.passports', () => {
    const traveller = (surname: string, expiryDate: string | null) =>
      ctx
        .http()
        .post('/v1/me/travellers')
        .set(bearer(ada.accessToken))
        .send({
          title: 'mr',
          gender: 'm',
          givenNames: 'Emeka',
          surname,
          dateOfBirth: '1988-02-11',
          nationality: 'NG',
          document: expiryDate ? { number: 'A7654321', issuingCountry: 'NG', expiryDate } : null,
        })
        .expect(201);

    it('counts the saved passports against the arrival date, and names nobody', async () => {
      const arrival = addDays(60);
      await traveller('Okafor', addDays(60 + 400)); // long enough
      await traveller('Bello', addDays(60 + 90)); // runs out within six months of arrival
      await traveller('Eze', addDays(30)); // run out by arrival
      await traveller('Musa', null); // no passport on file

      const answer = await call('documents.passports', 'flights', { arrivalDate: arrival });
      expect(answer).toMatchObject({
        status: 'ok',
        result: {
          savedTravellers: 4,
          withPassportOnFile: 3,
          passportsValidLongEnough: 1,
          passportsRunningOutTooSoon: 1,
          passportsRunOutByArrival: 1,
          monthsOfValidityAsked: 6,
          reminder: PASSPORT_REMINDER,
        },
      });
      // Nothing of a person reaches the model: no name, no number, no date of a document.
      const text = JSON.stringify(answer.result);
      for (const secret of ['Okafor', 'Bello', 'Eze', 'Musa', 'Emeka', 'A7654321', '321']) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toContain(addDays(30));
      expect(answer.result?.cards).toEqual([
        expect.objectContaining({ kind: 'link', href: '/account/travellers' }),
        { kind: 'note', title: 'passport_reminder', lines: [] },
      ]);
    });

    it('is the account’s own: a guest reaches nothing, and another account’s travellers do not count', async () => {
      await traveller('Okafor', addDays(900));
      expect(
        await call(
          'documents.passports',
          'flights',
          { arrivalDate: addDays(30) },
          await guestGrant(),
        ),
      ).toMatchObject({ status: 'denied', reason: 'scope', result: null });

      const bola = await signUp(ctx, 'plan-bola@example.com');
      const theirs = await call(
        'documents.passports',
        'flights',
        { arrivalDate: addDays(30) },
        await grantFor({ userId: bola.userId }),
      );
      expect(theirs.result).toMatchObject({ savedTravellers: 0, withPassportOnFile: 0 });
    });
  });

  describe('company.policy', () => {
    it('reads the policy of the caller’s own company, and says when there is none', async () => {
      const none = await call('company.policy', 'trip_builder', {});
      expect(none).toMatchObject({
        status: 'ok',
        result: { member: false, companyCanBook: false, highestCabin: null, needsApproval: null },
      });

      await ctx
        .http()
        .post('/v1/me/company')
        .set(bearer(ada.accessToken))
        .send({
          name: 'Acme Logistics',
          countryCode: 'NG',
          registrationNumber: 'RC 123456',
          taxId: '',
          billingEmail: 'accounts@acme.test',
        })
        .expect(201);
      await ctx
        .http()
        .put('/v1/me/company/policy')
        .set(bearer(ada.accessToken))
        .send({
          hotelNightlyCap: { amountMinor: 8_000_000, currency: 'NGN' },
          maxCabin: 'economy',
          minAdvanceDays: 14,
          approvalMode: 'out_of_policy',
        })
        .expect(200);

      const answer = await call('company.policy', 'hotels', {});
      expect(answer).toMatchObject({
        status: 'ok',
        result: {
          member: true,
          companyCanBook: true,
          role: 'admin',
          highestCabin: 'economy',
          hotelNightlyLimit: { amountMinor: 8_000_000, currency: 'NGN' },
          bookAtLeastDaysAhead: 14,
          needsApproval: 'out_of_policy',
        },
      });
      // The company's name, registration and billing address are not the model's to read.
      const text = JSON.stringify(answer.result);
      for (const secret of ['Acme', 'RC 123456', 'accounts@acme.test']) {
        expect(text).not.toContain(secret);
      }

      // Someone outside the company reads nothing of it.
      const bola = await signUp(ctx, 'plan-carol@example.com');
      const other = await call(
        'company.policy',
        'hotels',
        {},
        await grantFor({ userId: bola.userId }),
      );
      expect(other.result).toMatchObject({ member: false, highestCabin: null });
      expect(await call('company.policy', 'hotels', {}, await guestGrant())).toMatchObject({
        status: 'denied',
        reason: 'scope',
      });
    });
  });
});
