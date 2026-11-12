import { NotFoundException } from '@nestjs/common';

import type { NaturalSearchPlace } from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';
import type { AppConfig } from '../config/config';
import { parseEnv } from '../config/env.schema';
import { HmacService } from '../crypto/hmac.service';

import { AiSearchBudget, type BudgetReservation } from './ai-search-budget';
import { AnthropicLlmProvider } from './anthropic-llm-provider';
import { LlmError, LlmProvider, type LlmExtraction, type LlmResult } from './llm-provider';
import { MOCK_LLM_UNAVAILABLE, MockLlmProvider } from './mock-llm-provider';
import { NaturalSearchService } from './natural-search.service';
import type { PlaceResolver } from './place-resolver';
import { scrubQuery } from './scrub';
import {
  TRIP_QUERY_JSON_SCHEMA,
  TRIP_QUERY_SYSTEM_PROMPT,
  type TripQueryOutput,
} from './trip-query';

const config = (extra: Record<string, string> = {}): AppConfig =>
  parseEnv({
    DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
    REDIS_URL: 'redis://localhost:6379',
    HMAC_SECRET: 'test-hmac-secret-that-is-long-enough-1234',
    ...extra,
  });

/** Monday 2 November 2026, 10:00 in Lagos. */
const NOW = new Date('2026-11-02T09:00:00Z');
const TODAY = '2026-11-02';

const PLACES: Record<string, NaturalSearchPlace> = {
  lagos: { code: 'LOS', name: 'Murtala Muhammed International', city: 'Lagos', countryCode: 'NG' },
  abuja: { code: 'ABV', name: 'Nnamdi Azikiwe International', city: 'Abuja', countryCode: 'NG' },
  dubai: { code: 'DXB', name: 'Dubai International', city: 'Dubai', countryCode: 'AE' },
  accra: { code: 'ACC', name: 'Kotoka International', city: 'Accra', countryCode: 'GH' },
  nairobi: { code: 'NBO', name: 'Jomo Kenyatta International', city: 'Nairobi', countryCode: 'KE' },
};

const resolver = {
  resolve: (place: { name: string }) => Promise.resolve(PLACES[place.name.toLowerCase()] ?? null),
} as unknown as PlaceResolver;

const place = (name: string) => ({ name, iata: null });

const output = (overrides: Partial<TripQueryOutput> = {}): TripQueryOutput => ({
  understood: true,
  tripType: 'one_way',
  legs: [{ from: place('Lagos'), to: place('Abuja'), date: '2026-11-20' }],
  returnDate: null,
  departureMonth: null,
  adults: null,
  children: null,
  infants: null,
  cabinClass: null,
  directOnly: false,
  flexibleDates: false,
  ...overrides,
});

class StubProvider extends LlmProvider {
  readonly name = 'stub';
  calls: LlmExtraction[] = [];
  constructor(private readonly answer: () => Promise<LlmResult>) {
    super();
  }
  extract(request: LlmExtraction): Promise<LlmResult> {
    this.calls.push(request);
    return this.answer();
  }
}

const USAGE = { inputTokens: 100, outputTokens: 200, cacheReadTokens: 2000, cacheWriteTokens: 0 };

/** A budget whose reservations always pass (or never do), recording what it is asked. */
function stubBudget(cfg: AppConfig, refuse: false | 'caller' | 'global' = false) {
  const real = new AiSearchBudget({} as never, cfg);
  const reserved: { caller: string; amount: number }[] = [];
  const settled: number[] = [];
  const budget = {
    cost: real.cost.bind(real),
    worstCase: real.worstCase.bind(real),
    reserve: (caller: string, amount: number): Promise<BudgetReservation | 'caller' | 'global'> => {
      reserved.push({ caller, amount });
      return Promise.resolve(refuse || { keys: ['a', 'b'], reserved: amount });
    },
    settle: (_: BudgetReservation, actual: number) => {
      settled.push(actual);
      return Promise.resolve();
    },
  };
  return { budget: budget as unknown as AiSearchBudget, reserved, settled };
}

function service(
  answer: () => Promise<LlmResult>,
  options: { env?: Record<string, string>; refuse?: false | 'caller' | 'global' } = {},
) {
  const cfg = config(options.env);
  const provider = new StubProvider(answer);
  const { budget, reserved, settled } = stubBudget(cfg, options.refuse ?? false);
  const search = new NaturalSearchService(cfg, provider, budget, resolver, new HmacService(cfg));
  return { search, provider, reserved, settled };
}

const ok = (value: unknown) => () =>
  Promise.resolve({ output: value, usage: USAGE, model: 'stub' } satisfies LlmResult);
const guest = { userId: null, ip: '203.0.113.7' };
const request = (text: string) => ({ text, timeZone: 'Africa/Lagos' });

describe('scrubQuery', () => {
  it('removes e-mail addresses, phone numbers, cards and document numbers', () => {
    expect(scrubQuery('mail me at ada.obi+trips@example.com about Lagos to Accra')).toBe(
      'mail me at [removed] about Lagos to Accra',
    );
    expect(scrubQuery('call +234 803 123 4567 or 0803 123 4567')).toBe(
      'call [removed] or [removed]',
    );
    expect(scrubQuery('card 4111 1111 1111 1111, passport A12345678')).toBe(
      'card [removed], passport [removed]',
    );
    expect(scrubQuery('ref 12345678')).toBe('ref [removed]');
  });

  it('keeps dates, times, counts and prices', () => {
    const text = 'Lagos to Dubai 2026-12-20 2026-12-27 at 10:30, 2 adults, under 450000 naira';
    expect(scrubQuery(text)).toBe(text);
    expect(scrubQuery('on 20/12/2026 for   3 people')).toBe('on 20/12/2026 for 3 people');
  });
});

describe('AiSearchBudget arithmetic', () => {
  const budget = new AiSearchBudget({} as never, config());

  it('prices usage in whole micro-dollars, rounding up', () => {
    // Haiku defaults: 100 input * 0.1 + 200 output * 0.5 + 2000 cache reads * 0.01 = 130.
    expect(budget.cost(USAGE)).toBe(130);
    expect(budget.cost({ ...USAGE, outputTokens: 1 })).toBe(31);
  });

  it('reserves the dearer input rate and the whole output allowance', () => {
    // 4000 prompt tokens at the cache-write rate (0.125) + 1024 output (0.5) = 500 + 512.
    expect(budget.worstCase(4000, 1024)).toBe(1012);
  });
});

describe('NaturalSearchService.draft', () => {
  const { search } = service(ok({}));

  it('fills a one-way trip and defaults the rest of the form', async () => {
    const result = await search.draft(output({ adults: 2, cabinClass: 'business' }), TODAY);
    expect(result).toEqual({
      draft: {
        tripType: 'one_way',
        origin: 'LOS',
        destination: 'ABV',
        departureDate: '2026-11-20',
        returnDate: '',
        legs: [],
        travellers: { adults: 2, children: 0, infants: 0 },
        cabinClass: 'business',
        directOnly: false,
        flexibleDates: false,
      },
      places: [PLACES.lagos, PLACES.abuja],
      departureMonth: null,
      missing: [],
    });
  });

  it('drops dates in the past, past the advance limit, or a return before departure', async () => {
    const past = await search.draft(
      output({ legs: [{ ...output().legs[0]!, date: '2026-11-01' }] }),
      TODAY,
    );
    expect(past?.draft.departureDate).toBe('');
    expect(past?.missing).toEqual(['departureDate']);

    const tooFar = await search.draft(
      output({ legs: [{ ...output().legs[0]!, date: '2027-11-01' }] }),
      TODAY,
    );
    expect(tooFar?.draft.departureDate).toBe('');

    const backwards = await search.draft(
      output({ tripType: 'round_trip', returnDate: '2026-11-10' }),
      TODAY,
    );
    expect(backwards?.draft.returnDate).toBe('');
    expect(backwards?.missing).toEqual(['returnDate']);
  });

  it('keeps a month when no day was given, and infers a return from a return date', async () => {
    const month = await search.draft(
      output({ legs: [{ from: null, to: place('Dubai'), date: null }], departureMonth: '2026-12' }),
      TODAY,
    );
    expect(month).toMatchObject({
      draft: { origin: '', destination: 'DXB', departureDate: '' },
      departureMonth: '2026-12',
      missing: ['origin', 'departureDate'],
    });
    const inferred = await search.draft(
      output({ tripType: null, returnDate: '2026-11-27' }),
      TODAY,
    );
    expect(inferred?.draft).toMatchObject({ tripType: 'round_trip', returnDate: '2026-11-27' });
  });

  it('keeps traveller counts within the shared rules', async () => {
    const many = await search.draft(output({ adults: 12, children: 3, infants: 4 }), TODAY);
    expect(many?.draft.travellers).toEqual({ adults: 9, children: 0, infants: 0 });
    const laps = await search.draft(output({ adults: 2, children: 1, infants: 3 }), TODAY);
    expect(laps?.draft.travellers).toEqual({ adults: 2, children: 1, infants: 2 });
  });

  it('marks incomplete multi-city legs and unknown places as missing', async () => {
    const multi = await search.draft(
      output({
        tripType: 'multi_city',
        legs: [
          { from: place('Abuja'), to: place('Nairobi'), date: '2026-11-06' },
          { from: place('Nairobi'), to: place('Atlantis'), date: '2026-11-12' },
        ],
      }),
      TODAY,
    );
    expect(multi?.draft.legs).toEqual([
      { origin: 'ABV', destination: 'NBO', departureDate: '2026-11-06' },
      { origin: 'NBO', destination: '', departureDate: '2026-11-12' },
    ]);
    expect(multi?.missing).toEqual(['legs']);
  });

  it('returns nothing when no place could be resolved', async () => {
    const none = await search.draft(
      output({ legs: [{ from: place('Atlantis'), to: place('Lemuria'), date: '2026-11-20' }] }),
      TODAY,
    );
    expect(none).toBeNull();
  });
});

describe('NaturalSearchService.parse', () => {
  it('answers 404 while the feature is off', async () => {
    const { search, provider } = service(ok(output()), { env: { AI_SEARCH_ENABLED: 'false' } });
    await expect(search.parse(request('Lagos to Abuja'), guest, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(provider.calls).toHaveLength(0);
    expect(search.status()).toEqual({ enabled: false, maxLength: 280 });
  });

  it('refuses over the cost cap without calling the model', async () => {
    const { search, provider } = service(ok(output()), { refuse: 'caller' });
    const failure = search.parse(request('Lagos to Abuja'), guest, NOW);
    await expect(failure).rejects.toBeInstanceOf(ProblemDetailsException);
    await expect(failure).rejects.toMatchObject({ slug: 'ai-search-budget-exceeded' });
    expect(provider.calls).toHaveLength(0);
  });

  it("sends scrubbed text with the visitor's today, and budgets guests by an HMAC", async () => {
    const { search, provider, reserved, settled } = service(ok(output()));
    const result = await search.parse(
      request('Lagos to Abuja on 20 November, mail ada@example.com'),
      guest,
      NOW,
    );
    expect(result.draft).toMatchObject({ origin: 'LOS', destination: 'ABV' });
    const sent = provider.calls[0]!;
    expect(sent.system).toBe(TRIP_QUERY_SYSTEM_PROMPT);
    expect(sent.schema).toBe(TRIP_QUERY_JSON_SCHEMA);
    expect(sent.input).toBe(
      'Today is Monday 2026-11-02 (Africa/Lagos).\n\nMessage: Lagos to Abuja on 20 November, mail [removed]',
    );
    expect(reserved[0]?.caller).toMatch(/^guest:[\w-]{43}$/);
    expect(reserved[0]?.caller).not.toContain('203.0.113.7');
    expect(settled).toEqual([130]);

    const signedIn = service(ok(output()));
    await signedIn.search.parse(
      request('Lagos to Abuja'),
      { userId: 'user-1', ip: '203.0.113.7' },
      NOW,
    );
    expect(signedIn.reserved[0]?.caller).toBe('user-1');
  });

  it('keeps the reservation when the model may have billed a lost call', async () => {
    const { search, settled } = service(() => Promise.reject(new LlmError('timeout')));
    await expect(search.parse(request('Lagos to Abuja'), guest, NOW)).rejects.toMatchObject({
      slug: 'ai-search-unavailable',
    });
    expect(settled).toEqual([]);
  });

  it('settles refusals and invalid answers once, then falls back', async () => {
    const refused = service(() => Promise.reject(new LlmError('refused', USAGE)));
    await expect(refused.search.parse(request('Lagos to Abuja'), guest, NOW)).rejects.toMatchObject(
      {
        slug: 'ai-search-unavailable',
      },
    );
    expect(refused.settled).toEqual([130]);

    const invalid = service(ok({ destination: 'Dubai' }));
    await expect(invalid.search.parse(request('Lagos to Abuja'), guest, NOW)).rejects.toMatchObject(
      {
        slug: 'ai-search-unavailable',
      },
    );
    expect(invalid.settled).toEqual([130]);
  });

  it('answers 422 when the text is not a flight search', async () => {
    const { search } = service(ok(output({ understood: false, legs: [], tripType: null })));
    await expect(search.parse(request('write me a poem'), guest, NOW)).rejects.toMatchObject({
      slug: 'ai-search-not-understood',
    });
  });
});

describe('MockLlmProvider', () => {
  const extraction = (message: string): LlmExtraction => ({
    system: TRIP_QUERY_SYSTEM_PROMPT,
    input: `Today is Monday ${TODAY} (Africa/Lagos).\n\nMessage: ${message}`,
    schema: TRIP_QUERY_JSON_SCHEMA,
    maxOutputTokens: 1024,
  });

  it('answers recorded messages and reads simple ones', async () => {
    const mock = new MockLlmProvider();
    mock.record('Somewhere Nice', output({ adults: 3 }));
    expect((await mock.extract(extraction('  somewhere   nice '))).output).toMatchObject({
      adults: 3,
    });
    expect(
      (await mock.extract(extraction('Lagos to Accra on 2026-12-01, 2 adults, business'))).output,
    ).toMatchObject({
      understood: true,
      tripType: 'one_way',
      legs: [{ from: { name: 'Lagos' }, to: { name: 'Accra' }, date: '2026-12-01' }],
      adults: 2,
      cabinClass: 'business',
    });
    await expect(mock.extract(extraction(`please ${MOCK_LLM_UNAVAILABLE}`))).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });
});

describe('AnthropicLlmProvider', () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: JSON.stringify(output()) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 40,
      output_tokens: 150,
      cache_read_input_tokens: 1800,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function provider(answer: () => Response) {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: url instanceof Request ? url.url : url.toString(), init });
      return Promise.resolve(answer());
    }) as typeof globalThis.fetch;
    const adapter = new AnthropicLlmProvider({
      apiKey: 'test-key',
      model: 'claude-haiku-5-5',
      timeoutMs: 5000,
      fetch,
    });
    return { adapter, requests };
  }
  const extraction: LlmExtraction = {
    system: TRIP_QUERY_SYSTEM_PROMPT,
    input: 'Today is Monday 2026-11-02 (Africa/Lagos).\n\nMessage: Lagos to Abuja',
    schema: TRIP_QUERY_JSON_SCHEMA,
    maxOutputTokens: 1024,
  };

  it('asks for structured output with a cached prompt and no sampling parameters', async () => {
    const { adapter, requests } = provider(() => json(message()));
    const result = await adapter.extract(extraction);
    expect(result).toEqual({
      output: output(),
      usage: { inputTokens: 40, outputTokens: 150, cacheReadTokens: 1800, cacheWriteTokens: 0 },
      model: 'claude-haiku-5-5',
    });
    const [sent] = requests;
    expect(sent?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent?.init?.redirect).toBe('error');
    // The SDK's own Headers instance (another realm under Jest): read it through its methods.
    const headers = sent?.init?.headers as Headers;
    // SDK 1.x sends the API key as a bearer token: ours, never an environment credential.
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(headers.get('traceparent')).toBeNull();
    // The SDK sends the JSON body as a string.
    const body = JSON.parse(sent?.init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      system: [
        { type: 'text', text: TRIP_QUERY_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: extraction.input }],
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: TRIP_QUERY_JSON_SCHEMA },
      },
    });
    for (const removed of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(body).not.toHaveProperty(removed);
    }
  });

  it('turns refusals, truncation, bad JSON and API errors into LlmErrors', async () => {
    await expect(
      provider(() => json(message({ stop_reason: 'refusal' }))).adapter.extract(extraction),
    ).rejects.toMatchObject({
      reason: 'refused',
      usage: { outputTokens: 150 },
    });
    await expect(
      provider(() => json(message({ stop_reason: 'max_tokens' }))).adapter.extract(extraction),
    ).rejects.toMatchObject({
      reason: 'truncated',
    });
    await expect(
      provider(() =>
        json(message({ content: [{ type: 'text', text: '{"understood":' }] })),
      ).adapter.extract(extraction),
    ).rejects.toMatchObject({ reason: 'invalid_output' });
    await expect(
      provider(() =>
        json({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 400),
      ).adapter.extract(extraction),
    ).rejects.toMatchObject({ reason: 'rejected' });
  });
});

describe('AI search settings', () => {
  it('needs a key for the real model, and a real model in production when switched on', () => {
    expect(config().LLM_PROVIDER).toBe('mock');
    expect(config().LLM_MODEL).toBe('claude-haiku-5-5');
    expect(() => config({ LLM_PROVIDER: 'anthropic' })).toThrow(/LLM_API_KEY/);
    expect(config({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' }).LLM_PROVIDER).toBe('anthropic');
  });
});
