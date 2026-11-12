import { addDays, localDate, type NaturalSearchResult } from '@suskii/shared';

import { MOCK_LLM_UNAVAILABLE, MockLlmProvider } from '../src/ai-search/mock-llm-provider';
import { NaturalSearchService } from '../src/ai-search/natural-search.service';
import { ProblemDetailsException } from '../src/common/problem-details';

import {
  actualStruct,
  expectedStruct,
  loadEvalSuite,
  mismatches,
  recordedAnswer,
} from './helpers/natural-search-eval';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const ROUTE = '/v1/flights/natural-search';
const problem = (slug: string) => `urn:suskii:problem:${slug}`;

/** AI trip search (ADR-061) against the seeded catalog and a real Redis. */
describe('natural-language flight search (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, AI_SEARCH_ENABLED: true });
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('turns all 50 eval cases into exactly the expected form (recorded model answers)', async () => {
    const suite = loadEvalSuite();
    expect(suite.cases).toHaveLength(50);
    expect(new Set(suite.cases.map((evalCase) => evalCase.id)).size).toBe(50);
    const mock = ctx.app.get(MockLlmProvider);
    const search = ctx.app.get(NaturalSearchService);
    const failures: string[] = [];
    for (const evalCase of suite.cases) {
      mock.record(evalCase.query, recordedAnswer(suite, evalCase));
      let result: NaturalSearchResult | null;
      try {
        result = await search.parse(
          { text: evalCase.query, timeZone: suite.timeZone },
          { userId: `eval:${evalCase.id}`, ip: '127.0.0.1' },
          new Date(suite.now),
        );
      } catch (error) {
        if (
          !(error instanceof ProblemDetailsException) ||
          error.slug !== 'ai-search-not-understood'
        )
          throw error;
        result = null;
      }
      const expected = expectedStruct(evalCase);
      const actual = actualStruct(result);
      const fields = mismatches(expected, actual);
      if (fields.length > 0) {
        failures.push(
          `${evalCase.id}: ${fields
            .map(
              (field) =>
                `${field} expected ${JSON.stringify((expected as Record<string, unknown>)[field])} got ${JSON.stringify((actual as Record<string, unknown>)[field])}`,
            )
            .join('; ')}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it('answers the status route and parses a message into a draft over HTTP', async () => {
    const status = await ctx.http().get(ROUTE).expect(200);
    expect(status.body).toEqual({ enabled: true, maxLength: 280 });

    const date = addDays(localDate(new Date(), 'Africa/Lagos'), 10);
    const response = await ctx
      .http()
      .post(ROUTE)
      .send({ text: `Lagos to Abuja on ${date}, 2 adults, business` })
      .expect(200);
    expect(response.body).toMatchObject({
      draft: {
        tripType: 'one_way',
        origin: 'LOS',
        destination: 'ABV',
        departureDate: date,
        travellers: { adults: 2, children: 0, infants: 0 },
        cabinClass: 'business',
      },
      departureMonth: null,
      missing: [],
    });
    expect((response.body as NaturalSearchResult).places.map((place) => place.code)).toEqual([
      'LOS',
      'ABV',
    ]);
  });

  it('falls back with problem details the clients treat as "use the form"', async () => {
    await ctx.http().post(ROUTE).send({ text: 'a' }).expect(400);
    const notUnderstood = await ctx.http().post(ROUTE).send({ text: 'tell me a joke' }).expect(422);
    expect(notUnderstood.body.type).toBe(problem('ai-search-not-understood'));
    const unavailable = await ctx
      .http()
      .post(ROUTE)
      .send({ text: `Lagos to Abuja ${MOCK_LLM_UNAVAILABLE}` })
      .expect(503);
    expect(unavailable.body.type).toBe(problem('ai-search-unavailable'));
  });

  it('settles each request to its actual cost in the daily spend counters', async () => {
    await ctx.http().post(ROUTE).send({ text: 'Lagos to Abuja' }).expect(200);
    const day = new Date().toISOString().slice(0, 10);
    const total = Number(await ctx.redis.get(`ai-search:spend:${day}:all`));
    const keys = await ctx.redis.keys(`ai-search:spend:${day}:guest:*`);
    expect(keys).toHaveLength(1);
    expect(Number(await ctx.redis.get(keys[0] ?? ''))).toBe(total);
    // The mock bills about 80 micro-dollars; the reservation was several times that.
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(200);
  });
});

describe('natural-language flight search caps and flag (e2e)', () => {
  it('refuses a request over the daily cap without calling the model', async () => {
    const ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AI_SEARCH_ENABLED: true,
      AI_SEARCH_USER_DAILY_MICROUSD: 100,
    });
    try {
      await resetState(ctx);
      const refused = await ctx
        .http()
        .post('/v1/flights/natural-search')
        .send({ text: 'Lagos to Abuja' })
        .expect(429);
      expect(refused.body.type).toBe(problem('ai-search-budget-exceeded'));
      expect(await ctx.redis.keys('ai-search:spend:*')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it('hides the box and answers 404 while the feature is off', async () => {
    const ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, AI_SEARCH_ENABLED: false });
    try {
      const status = await ctx.http().get('/v1/flights/natural-search').expect(200);
      expect(status.body).toEqual({ enabled: false, maxLength: 280 });
      await ctx
        .http()
        .post('/v1/flights/natural-search')
        .send({ text: 'Lagos to Abuja' })
        .expect(404);
    } finally {
      await ctx.close();
    }
  });
});
