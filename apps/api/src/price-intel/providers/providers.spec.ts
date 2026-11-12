import { ScrapeError, type ScrapeRequest } from '../scrape-provider';
import { FetchRefused } from '../ssrf-guard';

import { ApifyScrapeProvider } from './apify-scrape-provider';
import { BrightDataScrapeProvider } from './bright-data-scrape-provider';
import { BrowseAiScrapeProvider } from './browse-ai-scrape-provider';
import {
  BOT_TOKEN,
  DirectScrapeProvider,
  pinnedLookup,
  type DirectResponse,
} from './direct-scrape-provider';
import { FirecrawlScrapeProvider } from './firecrawl-scrape-provider';
import { OxylabsScrapeProvider } from './oxylabs-scrape-provider';
import { parseRobots, robotsAllow } from './robots';
import { fillTemplate, retryAfterMs, vendorStatusFailure } from './scrape-http';

/**
 * Contract tests of the vendor adapters (ADR-102). No test calls a vendor: `fetch` is a fake
 * that records each request and answers from a fixture. The fixtures are constructed from the
 * shapes in each vendor's published client (firecrawl 4.52.0, apify-client 2.26.0 and
 * @brightdata/sdk 1.2.0 on npm, oxylabs 3.0.0 on PyPI, and for Browse AI the open-source
 * Pipedream and Activepieces integrations); they are not recordings of live answers. The owner's
 * `sandbox:scrapers` run checks the live shapes before a vendor is enabled.
 */

const KEY = 'test-key-never-a-real-one';
const PAGE = '<html><body><h1>Rooms</h1></body></html>';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(
  answers: (
    { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | Error
  )[],
) {
  const calls: Call[] = [];
  const fetchImpl = ((input: string, init: RequestInit) => {
    calls.push({
      url: input,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    expect(init.redirect).toBe('error');
    const answer = answers.shift();
    if (!answer) return Promise.reject(new Error('no more answers'));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(
      new Response(answer.text ?? JSON.stringify(answer.json ?? {}), {
        status: answer.status ?? 200,
        headers: answer.headers,
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const request = (over: Partial<ScrapeRequest> = {}): ScrapeRequest => ({
  url: 'https://hotels.example.com/search?city=lagos',
  product: 'hotel',
  domain: 'hotels.example.com',
  country: 'NG',
  locale: 'en-NG',
  proxyClass: 'datacenter',
  render: false,
  timeoutMs: 20_000,
  settings: {},
  ...over,
});
const signal = () => new AbortController().signal;
const failure = async (run: Promise<unknown>): Promise<ScrapeError> => {
  try {
    await run;
  } catch (error) {
    if (error instanceof ScrapeError) return error;
    throw error;
  }
  throw new Error('expected a ScrapeError');
};

describe('shared vendor HTTP rules', () => {
  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '30' }))).toBe(30_000);
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(retryAfterMs(new Headers({ 'retry-after': 'Tue, 10 Nov 2026 12:01:00 GMT' }), now)).toBe(
      60_000,
    );
    expect(retryAfterMs(new Headers())).toBeUndefined();
    expect(retryAfterMs(new Headers({ 'retry-after': 'soon' }))).toBeUndefined();
  });

  it('classifies a vendor status once', () => {
    expect([200, 204].map(vendorStatusFailure)).toEqual([null, null]);
    expect([402, 429].map(vendorStatusFailure)).toEqual(['quota_exhausted', 'quota_exhausted']);
    expect([408, 504].map(vendorStatusFailure)).toEqual(['timeout', 'timeout']);
    expect([400, 401, 403, 404, 500, 502].map(vendorStatusFailure)).toEqual(
      Array.from({ length: 6 }, () => 'provider_error'),
    );
  });

  it('fills a settings template without touching its keys', () => {
    expect(
      fillTemplate(
        {
          startUrls: [{ url: '{{url}}' }],
          '{{url}}': 'kept as a key',
          country: '{{country}}',
          render: '{{render}}',
          note: 'for {{locale}} on {{url}}',
          depth: 1,
        },
        { url: 'https://x.example.com/a', country: 'NG', locale: 'en-NG', render: true },
      ),
    ).toEqual({
      startUrls: [{ url: 'https://x.example.com/a' }],
      '{{url}}': 'kept as a key',
      country: 'NG',
      render: true,
      note: 'for en-NG on https://x.example.com/a',
      depth: 1,
    });
  });
});

describe('Firecrawl adapter', () => {
  const provider = (answers: Parameters<typeof fakeFetch>[0]) => {
    const fake = fakeFetch(answers);
    return {
      ...fake,
      provider: new FirecrawlScrapeProvider({
        apiKey: KEY,
        costs: { datacenter: 1000, unblocker: 5000 },
        fetch: fake.fetchImpl,
      }),
    };
  };

  it('asks for the raw page in the market, with its own cache off', async () => {
    const { provider: firecrawl, calls } = provider([
      {
        json: {
          success: true,
          data: {
            rawHtml: PAGE,
            metadata: { statusCode: 200, creditsUsed: 1, proxyUsed: 'basic' },
          },
        },
      },
    ]);
    const page = await firecrawl.run(request(), signal());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: 'https://api.firecrawl.dev/v2/scrape',
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}` },
      body: {
        url: 'https://hotels.example.com/search?city=lagos',
        formats: ['rawHtml'],
        maxAge: 0,
        proxy: 'basic',
        location: { country: 'NG' },
      },
    });
    expect((calls[0]?.body as Record<string, unknown>).waitFor).toBeUndefined();
    expect(page).toEqual({
      html: PAGE,
      items: null,
      httpStatus: 200,
      rendered: false,
      costMicroUsd: null,
    });
  });

  it('uses stealth proxies for the unblocker class, waits when rendering, and returns fields for a schema', async () => {
    const { provider: firecrawl, calls } = provider([
      {
        json: {
          success: true,
          data: {
            rawHtml: PAGE,
            json: { items: [{ name: 'A', price: 1 }] },
            metadata: { statusCode: 200 },
          },
        },
      },
    ]);
    const page = await firecrawl.run(
      request({
        proxyClass: 'unblocker',
        render: true,
        settings: { jsonSchema: { type: 'object' }, jsonPrompt: 'List the rooms' },
      }),
      signal(),
    );
    expect(calls[0]?.body).toMatchObject({
      proxy: 'stealth',
      waitFor: 2500,
      formats: ['rawHtml', { type: 'json', schema: { type: 'object' }, prompt: 'List the rooms' }],
    });
    expect(page.items).toEqual([{ name: 'A', price: 1 }]);
    expect(page.rendered).toBe(true);
  });

  it('reports the site status so a block is seen, and classifies its own refusals', async () => {
    const blocked = provider([
      { json: { success: true, data: { rawHtml: 'Forbidden', metadata: { statusCode: 403 } } } },
    ]);
    expect((await blocked.provider.run(request(), signal())).httpStatus).toBe(403);

    const cases: [Parameters<typeof fakeFetch>[0][number], string][] = [
      [{ status: 402, json: { success: false, error: 'Payment required' } }, 'quota_exhausted'],
      [
        { status: 429, json: { error: 'Rate limit' }, headers: { 'retry-after': '12' } },
        'quota_exhausted',
      ],
      [{ status: 408, json: { code: 'SCRAPE_TIMEOUT' } }, 'timeout'],
      [{ status: 401, json: { error: 'Unauthorized' } }, 'provider_error'],
      [{ status: 500, text: 'oops' }, 'provider_error'],
      [{ status: 200, json: { success: false } }, 'provider_error'],
      [Object.assign(new Error('late'), { name: 'TimeoutError' }), 'timeout'],
      [new TypeError('fetch failed'), 'provider_error'],
    ];
    for (const [answer, expected] of cases) {
      const error = await failure(provider([answer]).provider.run(request(), signal()));
      expect(error.failure).toBe(expected);
      // Nothing of the key, the address or the body is in the message.
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain('hotels.example.com');
    }
    const limited = await failure(
      provider([{ status: 429, json: {}, headers: { 'retry-after': '12' } }]).provider.run(
        request(),
        signal(),
      ),
    );
    expect(limited.detail.retryAfterMs).toBe(12_000);
  });

  it('checks the key and the credits without fetching a page', async () => {
    const { provider: firecrawl, calls } = provider([
      { json: { success: true, data: { remainingCredits: 420, planCredits: 500 } } },
      { status: 401, json: {} },
    ]);
    expect(await firecrawl.health(signal())).toEqual({ ok: true, remaining: 420 });
    expect(calls[0]).toMatchObject({
      url: 'https://api.firecrawl.dev/v2/team/credit-usage',
      method: 'GET',
    });
    expect(await firecrawl.health(signal())).toEqual({ ok: false, remaining: null });
    expect(firecrawl.estimateCostMicroUsd(request(), 'unblocker')).toBe(5000);
    expect(firecrawl.estimateCostMicroUsd(request(), 'residential')).toBe(0);
  });
});

describe('Bright Data adapter', () => {
  const make = (answers: Parameters<typeof fakeFetch>[0]) => {
    const fake = fakeFetch(answers);
    return {
      ...fake,
      provider: new BrightDataScrapeProvider({
        apiKey: KEY,
        zone: 'unlocker_ng',
        costs: { unblocker: 1500 },
        fetch: fake.fetchImpl,
      }),
    };
  };

  it('sends the address through its zone and takes the body as the page', async () => {
    const { provider, calls } = make([{ text: PAGE }]);
    const page = await provider.run(request({ proxyClass: 'unblocker' }), signal());
    expect(calls[0]).toMatchObject({
      url: 'https://api.brightdata.com/request',
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}` },
      body: {
        method: 'GET',
        url: 'https://hotels.example.com/search?city=lagos',
        zone: 'unlocker_ng',
        country: 'ng',
        format: 'raw',
      },
    });
    expect(page).toEqual({
      html: PAGE,
      items: null,
      httpStatus: null,
      rendered: false,
      costMicroUsd: null,
    });
    expect(provider.capabilities.proxyClasses).toEqual(['unblocker']);
  });

  it('classifies refusals and checks that its zone is active', async () => {
    expect(
      (await failure(make([{ status: 429, text: '' }]).provider.run(request(), signal()))).failure,
    ).toBe('quota_exhausted');
    expect(
      (await failure(make([{ status: 401, text: '' }]).provider.run(request(), signal()))).failure,
    ).toBe('provider_error');
    const active = make([
      { json: [{ name: 'unlocker_ng', type: 'unblocker' }, { zone: 'other' }] },
    ]);
    expect(await active.provider.health(signal())).toEqual({ ok: true, remaining: null });
    expect(active.calls[0]?.url).toBe('https://api.brightdata.com/zone/get_active_zones');
    const missing = make([{ json: [{ name: 'other' }] }]);
    expect((await missing.provider.health(signal())).ok).toBe(false);
  });
});

describe('Oxylabs adapter', () => {
  const make = (answers: Parameters<typeof fakeFetch>[0]) => {
    const fake = fakeFetch(answers);
    return {
      ...fake,
      provider: new OxylabsScrapeProvider({
        username: 'customer',
        password: 'secret-password',
        costs: { unblocker: 2500 },
        fetch: fake.fetchImpl,
      }),
    };
  };

  it('posts a universal query with basic auth and reads the first result', async () => {
    const { provider, calls } = make([
      { json: { results: [{ content: PAGE, status_code: 200, url: 'x' }], job: { id: '1' } } },
    ]);
    const page = await provider.run(
      request({ proxyClass: 'unblocker', render: true, settings: { geoLocation: 'Nigeria' } }),
      signal(),
    );
    expect(calls[0]).toMatchObject({
      url: 'https://realtime.oxylabs.io/v1/queries',
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from('customer:secret-password').toString('base64')}`,
      },
      body: {
        source: 'universal',
        url: 'https://hotels.example.com/search?city=lagos',
        render: 'html',
        geo_location: 'Nigeria',
        user_agent_type: 'desktop',
      },
    });
    expect((calls[0]?.body as Record<string, unknown>).parse).toBeUndefined();
    expect(page).toEqual({
      html: PAGE,
      items: null,
      httpStatus: 200,
      rendered: true,
      costMicroUsd: null,
    });
  });

  it('returns parsed fields with exact numbers when the site has parsing instructions', async () => {
    const { provider, calls } = make([
      {
        text: '{"results":[{"content":{"items":[{"name":"A","price":125000.50}]},"status_code":200}]}',
      },
    ]);
    const page = await provider.run(
      request({ settings: { source: 'universal_ecommerce', parsingInstructions: { items: {} } } }),
      signal(),
    );
    expect(calls[0]?.body).toMatchObject({
      source: 'universal_ecommerce',
      parse: true,
      parsing_instructions: { items: {} },
    });
    // The price is its source text, not a float.
    expect(page.items).toEqual([{ name: 'A', price: '125000.50' }]);
    expect(page.html).toBeNull();
  });

  it('passes on the site status and classifies its own', async () => {
    const blocked = make([{ json: { results: [{ content: 'denied', status_code: 403 }] } }]);
    expect((await blocked.provider.run(request(), signal())).httpStatus).toBe(403);
    expect(
      (await failure(make([{ status: 429, json: {} }]).provider.run(request(), signal()))).failure,
    ).toBe('quota_exhausted');
    expect(
      (await failure(make([{ json: { results: [] } }]).provider.run(request(), signal()))).failure,
    ).toBe('provider_error');
    expect(
      (await failure(make([{ text: 'not json' }]).provider.run(request(), signal()))).failure,
    ).toBe('provider_error');
  });
});

describe('Apify adapter', () => {
  const settings = {
    actorId: 'someone/page-reader',
    input: { startUrls: [{ url: '{{url}}' }], renderJs: '{{render}}' },
    proxyInputs: {
      residential: {
        proxyConfiguration: {
          useApifyProxy: true,
          groups: ['RESIDENTIAL'],
          country: '{{country}}',
        },
      },
    },
  };
  // A clock that stands still unless a test moves it: how long a poll may wait is read from it,
  // and two readings of the system clock a millisecond apart once turned 20 seconds into 19.
  const make = (answers: Parameters<typeof fakeFetch>[0], now: () => number = () => 1_000_000) => {
    const fake = fakeFetch(answers);
    return {
      ...fake,
      provider: new ApifyScrapeProvider({
        token: KEY,
        costs: { datacenter: 2000, residential: 8000 },
        fetch: fake.fetchImpl,
        now,
      }),
    };
  };
  const run = (status: string, over: Record<string, unknown> = {}) => ({
    json: { data: { id: 'RUNid12345', status, defaultDatasetId: 'DATAset123', ...over } },
  });

  it('starts the actor with the filled input, waits for it and reads its items', async () => {
    const { provider, calls } = make([
      run('RUNNING'),
      run('SUCCEEDED', { usageTotalUsd: 0.0042 }),
      { text: '[{"title":"A","price":98000.00},{"title":"B","price":101500}]' },
    ]);
    const page = await provider.run(
      request({ proxyClass: 'residential', render: true, settings }),
      signal(),
    );
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      [
        'POST',
        'https://api.apify.com/v2/acts/someone~page-reader/runs?waitForFinish=20&timeout=20',
      ],
      ['GET', 'https://api.apify.com/v2/actor-runs/RUNid12345?waitForFinish=20'],
      ['GET', 'https://api.apify.com/v2/datasets/DATAset123/items?clean=true&limit=50'],
    ]);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]?.body).toEqual({
      startUrls: [{ url: 'https://hotels.example.com/search?city=lagos' }],
      renderJs: true,
      proxyConfiguration: { useApifyProxy: true, groups: ['RESIDENTIAL'], country: 'NG' },
    });
    expect(page).toEqual({
      html: null,
      items: [
        { title: 'A', price: '98000.00' },
        { title: 'B', price: '101500' },
      ],
      httpStatus: null,
      rendered: true,
      costMicroUsd: 4200,
    });
  });

  it('asks a running actor to wait no longer than the attempt has left', async () => {
    // The deadline is set at 1,000,000; each later reading is 1.5 seconds on.
    const readings = [1_000_000, 1_001_500, 1_003_000];
    const { provider, calls } = make(
      [run('RUNNING'), run('RUNNING'), run('SUCCEEDED'), { text: '[{"title":"A","price":98000}]' }],
      () => readings.shift() ?? 1_003_000,
    );
    await provider.run(request({ settings }), signal());
    expect(calls.slice(1, 3).map((call) => call.url)).toEqual([
      'https://api.apify.com/v2/actor-runs/RUNid12345?waitForFinish=18',
      'https://api.apify.com/v2/actor-runs/RUNid12345?waitForFinish=17',
    ]);
  });

  it('takes the page from an item field when the actor returns pages', async () => {
    const { provider } = make([run('SUCCEEDED'), { json: [{ url: 'x', html: PAGE }] }]);
    const page = await provider.run(
      request({ settings: { ...settings, htmlField: 'html' } }),
      signal(),
    );
    expect(page).toMatchObject({ html: PAGE, items: null, costMicroUsd: null });
  });

  it('fails without calling when settings are missing or the class has no input', async () => {
    const empty = make([]);
    expect((await failure(empty.provider.run(request(), signal()))).failure).toBe('provider_error');
    expect(
      (
        await failure(
          empty.provider.run(request({ settings: { actorId: '../../x', input: {} } }), signal()),
        )
      ).failure,
    ).toBe('provider_error');
    expect(
      (
        await failure(
          empty.provider.run(
            request({ proxyClass: 'residential', settings: { actorId: 'a~b', input: {} } }),
            signal(),
          ),
        )
      ).failure,
    ).toBe('provider_error');
    expect(empty.calls).toHaveLength(0);
  });

  it('classifies a failed, a timed-out and a refused run, and aborts one it gives up on', async () => {
    expect(
      (await failure(make([run('FAILED')]).provider.run(request({ settings }), signal()))).failure,
    ).toBe('provider_error');
    expect(
      (await failure(make([run('TIMED-OUT')]).provider.run(request({ settings }), signal())))
        .failure,
    ).toBe('timeout');
    expect(
      (
        await failure(
          make([{ status: 402, json: { error: { type: 'x' } } }]).provider.run(
            request({ settings }),
            signal(),
          ),
        )
      ).failure,
    ).toBe('quota_exhausted');
    // The poll fails: the run is aborted so it does not keep running.
    const gaveUp = make([run('RUNNING'), new TypeError('fetch failed'), { json: {} }]);
    expect((await failure(gaveUp.provider.run(request({ settings }), signal()))).failure).toBe(
      'provider_error',
    );
    expect(gaveUp.calls.at(-1)).toMatchObject({
      method: 'POST',
      url: 'https://api.apify.com/v2/actor-runs/RUNid12345/abort',
    });
  });

  it('says what is left of the month without starting a run', async () => {
    const { provider, calls } = make([
      {
        json: { data: { limits: { maxMonthlyUsageUsd: 49 }, current: { monthlyUsageUsd: 12.5 } } },
      },
    ]);
    expect(await provider.health(signal())).toEqual({ ok: true, remaining: 36_500_000 });
    expect(calls[0]?.url).toBe('https://api.apify.com/v2/users/me/limits');
  });
});

describe('Browse AI adapter', () => {
  const settings = { robotId: 'robot-1234-abcd', inputParameters: { originUrl: '{{url}}' } };
  const make = (answers: Parameters<typeof fakeFetch>[0]) => {
    const fake = fakeFetch(answers);
    return {
      ...fake,
      provider: new BrowseAiScrapeProvider({
        apiKey: KEY,
        costs: { unblocker: 10_000 },
        fetch: fake.fetchImpl,
        pollMs: 1,
      }),
    };
  };
  const task = (status: string, over: Record<string, unknown> = {}) => ({
    json: { result: { id: 'task-5678-efgh', status, ...over } },
  });

  it('runs the robot on the address, polls its task and returns what it captured', async () => {
    const { provider, calls } = make([
      task('in-progress'),
      task('in-progress'),
      {
        text: '{"result":{"id":"task-5678-efgh","status":"successful","capturedLists":{"rooms":[{"name":"A","price":"NGN 98,000"},{"name":"B","price":101500.00}]},"capturedTexts":{"title":"Rooms"}}}',
      },
    ]);
    const page = await provider.run(request({ proxyClass: 'unblocker', settings }), signal());
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'https://api.browse.ai/v2/robots/robot-1234-abcd/tasks'],
      ['GET', 'https://api.browse.ai/v2/robots/robot-1234-abcd/tasks/task-5678-efgh'],
      ['GET', 'https://api.browse.ai/v2/robots/robot-1234-abcd/tasks/task-5678-efgh'],
    ]);
    expect(calls[0]).toMatchObject({
      headers: { authorization: `Bearer ${KEY}` },
      body: { inputParameters: { originUrl: 'https://hotels.example.com/search?city=lagos' } },
    });
    expect(page).toEqual({
      html: null,
      items: [
        { name: 'A', price: 'NGN 98,000' },
        { name: 'B', price: '101500.00' },
      ],
      httpStatus: null,
      rendered: true,
      costMicroUsd: null,
    });
  });

  it('returns its texts as one item when the robot captured no list', async () => {
    const { provider } = make([
      task('successful', { capturedTexts: { name: 'A', price: '₦98,000' } }),
    ]);
    expect((await provider.run(request({ settings }), signal())).items).toEqual([
      { name: 'A', price: '₦98,000' },
    ]);
  });

  it('classifies a failed task, a slow one, a bad key and missing settings', async () => {
    expect(
      (await failure(make([task('failed')]).provider.run(request({ settings }), signal()))).failure,
    ).toBe('blocked');
    const slow = make(Array.from({ length: 50 }, () => task('in-progress')));
    expect(
      (await failure(slow.provider.run(request({ settings, timeoutMs: 20 }), signal()))).failure,
    ).toBe('timeout');
    expect(
      (
        await failure(
          make([{ status: 401, json: {} }]).provider.run(request({ settings }), signal()),
        )
      ).failure,
    ).toBe('provider_error');
    const none = make([]);
    expect((await failure(none.provider.run(request(), signal()))).failure).toBe('provider_error');
    expect(none.calls).toHaveLength(0);
    const health = make([{ json: { robots: { items: [] } } }]);
    expect(await health.provider.health(signal())).toEqual({ ok: true, remaining: null });
    expect(health.calls[0]?.url).toBe('https://api.browse.ai/v2/robots');
  });
});

describe('robots rules for the direct fetcher (RFC 9309)', () => {
  const file = [
    '# comment',
    'User-agent: *',
    'Disallow: /private/',
    'Disallow: /search',
    'Allow: /search/hotels',
    '',
    'User-agent: SuskiiPriceBot',
    'User-agent: OtherBot',
    'Disallow: /checkout',
    'Disallow: /*.json$',
    'Allow: /',
    '',
    'User-agent: BadBot',
    'Disallow: /',
  ].join('\n');

  it('uses its own group when there is one, else the group for everyone', () => {
    const own = parseRobots(file, BOT_TOKEN);
    expect(own).toEqual({ allow: ['/'], disallow: ['/checkout', '/*.json$'] });
    expect(robotsAllow(own, '/search?city=lagos')).toBe(true);
    expect(robotsAllow(own, '/checkout/step-1')).toBe(false);
    expect(robotsAllow(own, '/data/rooms.json')).toBe(false);
    expect(robotsAllow(own, '/data/rooms.json?x=1')).toBe(true);

    const everyone = parseRobots(file, 'SomeoneElse');
    expect(robotsAllow(everyone, '/private/x')).toBe(false);
    expect(robotsAllow(everyone, '/search?city=lagos')).toBe(false);
    // The longer rule wins.
    expect(robotsAllow(everyone, '/search/hotels?city=lagos')).toBe(true);
    expect(robotsAllow(everyone, '/rooms')).toBe(true);
  });

  it('treats an empty file and an empty Disallow as no rule, and a full Disallow as closed', () => {
    expect(robotsAllow(parseRobots('', BOT_TOKEN), '/anything')).toBe(true);
    expect(robotsAllow(parseRobots('User-agent: *\nDisallow:', BOT_TOKEN), '/anything')).toBe(true);
    expect(robotsAllow(parseRobots('User-agent: *\nDisallow: /', BOT_TOKEN), '/anything')).toBe(
      false,
    );
  });
});

describe('direct fetcher', () => {
  function direct(
    pages: Record<string, Partial<DirectResponse> | Error>,
    now: () => number = () => 0,
  ) {
    const fetched: { url: string; userAgent: string }[] = [];
    const provider = new DirectScrapeProvider({
      botUrl: 'https://www.suskii.example/bot',
      now,
      transport: (url, options) => {
        fetched.push({ url: url.toString(), userAgent: options.userAgent });
        const page = pages[url.toString()] ?? pages[url.pathname];
        if (page instanceof Error) return Promise.reject(page);
        if (!page) return Promise.resolve({ status: 404, headers: {}, body: '' });
        return Promise.resolve({ status: 200, headers: {}, body: '', ...page });
      },
    });
    return { provider, fetched };
  }
  const plain = (over: Partial<ScrapeRequest> = {}) => request({ proxyClass: 'none', ...over });

  it('says who it is, reads the robots file first and fetches the page', async () => {
    const { provider, fetched } = direct({ '/search': { body: PAGE } });
    const page = await provider.run(plain(), signal());
    expect(page).toEqual({
      html: PAGE,
      items: null,
      httpStatus: 200,
      rendered: false,
      costMicroUsd: 0,
    });
    expect(fetched.map((entry) => entry.url)).toEqual([
      'https://hotels.example.com/robots.txt',
      'https://hotels.example.com/search?city=lagos',
    ]);
    expect(fetched[0]?.userAgent).toBe(`${BOT_TOKEN}/1.0 (+https://www.suskii.example/bot)`);
    expect(provider.capabilities).toMatchObject({ proxyClasses: ['none'], render: false });
    // The robots file is kept for an hour: the next read fetches the page only.
    await provider.run(plain(), signal());
    expect(fetched).toHaveLength(3);
  });

  it('obeys a robots file that closes the path, and a robots file it cannot read', async () => {
    const closed = direct({
      '/robots.txt': { body: 'User-agent: *\nDisallow: /search' },
      '/search': { body: PAGE },
    });
    const refused = await failure(closed.provider.run(plain(), signal()));
    expect(refused).toMatchObject({ failure: 'policy_denied', detail: { reason: 'robots' } });
    expect(closed.fetched.map((entry) => entry.url)).toEqual([
      'https://hotels.example.com/robots.txt',
    ]);

    const broken = direct({ '/robots.txt': { status: 503 }, '/search': { body: PAGE } });
    expect((await failure(broken.provider.run(plain(), signal()))).failure).toBe('policy_denied');
    const unreachable = direct({
      '/robots.txt': new TypeError('reset'),
      '/search': { body: PAGE },
    });
    expect((await failure(unreachable.provider.run(plain(), signal()))).failure).toBe(
      'policy_denied',
    );
  });

  it('follows a redirect only on the same site, and only a few', async () => {
    const same = direct({
      '/search': { status: 302, headers: { location: '/en/search?city=lagos' } },
      '/en/search': { body: PAGE },
    });
    expect((await same.provider.run(plain(), signal())).html).toBe(PAGE);

    for (const location of [
      'https://evil.example.net/steal',
      'http://hotels.example.com/plain',
      'https://169.254.169.254/latest/meta-data/',
      'https://hotels.example.com:8443/x',
    ]) {
      const away = direct({ '/search': { status: 301, headers: { location } } });
      await expect(away.provider.run(plain(), signal())).rejects.toBeInstanceOf(FetchRefused);
      // Nothing was fetched from where the redirect pointed.
      expect(away.fetched.map((entry) => entry.url)).toEqual([
        'https://hotels.example.com/robots.txt',
        'https://hotels.example.com/search?city=lagos',
      ]);
    }

    const loop = direct({
      '/search': { status: 302, headers: { location: '/search?city=lagos' } },
    });
    expect((await failure(loop.provider.run(plain(), signal()))).failure).toBe('provider_error');
  });

  it('refuses an address off the policy domain before fetching anything', async () => {
    const { provider, fetched } = direct({});
    await expect(
      provider.run(plain({ url: 'https://internal.example.net/admin' }), signal()),
    ).rejects.toBeInstanceOf(FetchRefused);
    await expect(
      provider.run(plain({ url: 'http://hotels.example.com/search' }), signal()),
    ).rejects.toBeInstanceOf(FetchRefused);
    expect(fetched).toHaveLength(0);
  });

  it('reports a refusal by the site with its Retry-After, and never escalates by itself', async () => {
    const { provider } = direct({ '/search': { status: 429, headers: { 'retry-after': '45' } } });
    const blocked = await failure(provider.run(plain(), signal()));
    expect(blocked).toMatchObject({
      failure: 'blocked',
      detail: { httpStatus: 429, retryAfterMs: 45_000 },
    });
    const errored = direct({ '/search': new TypeError('reset') });
    expect((await failure(errored.provider.run(plain(), signal()))).failure).toBe('provider_error');
    const late = direct({ '/search': Object.assign(new Error('late'), { name: 'TimeoutError' }) });
    expect((await failure(late.provider.run(plain(), signal()))).failure).toBe('timeout');
  });

  it('connects only to the address it checked', async () => {
    const lookup = (answers: string[]) =>
      pinnedLookup(() => Promise.resolve(answers.map((address) => ({ address, family: 4 }))));
    const call = (answers: string[], all: boolean) =>
      new Promise<[unknown, unknown]>((resolve) => {
        lookup(answers)('hotels.example.com', { all }, (error: unknown, address: unknown) =>
          resolve([error, address]),
        );
      });
    expect(await call(['93.184.216.34'], false)).toEqual([null, '93.184.216.34']);
    expect(await call(['93.184.216.34'], true)).toEqual([
      null,
      [{ address: '93.184.216.34', family: 4 }],
    ]);
    const [refused] = await call(['10.0.0.8'], false);
    expect(refused).toBeInstanceOf(FetchRefused);
    const [mixed] = await call(['93.184.216.34', '127.0.0.1'], true);
    expect(mixed).toMatchObject({ code: 'private_address' });
  });
});
