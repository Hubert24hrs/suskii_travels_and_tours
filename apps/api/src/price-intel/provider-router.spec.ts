import {
  SCRAPE_FAILURE_CLASSES,
  type ProxyClass,
  type ScrapeFailureClass,
  type ScrapeVendor,
} from '@suskii/shared';

import { parseEnv } from '../config/env.schema';

import {
  classifyFailure,
  ProviderRouter,
  type RouterPolicy,
  type RouterRequest,
} from './provider-router';
import { mockPage } from './providers/mock-scrape-provider';
import { healthOrder, type VendorHealth } from './scrape-health';
import {
  ScrapeError,
  ScrapeExhausted,
  ScrapeProvider,
  type ScrapeCapabilities,
  type ScrapePage,
  type ScrapeRequest,
} from './scrape-provider';
import { FetchRefused } from './ssrf-guard';

type Step = ScrapeFailureClass | 'ok' | 'unparsed' | 'boom';

/** A vendor that answers from a script and remembers what it was asked. */
class Scripted extends ScrapeProvider {
  readonly calls: { proxyClass: ProxyClass; render: boolean }[] = [];
  constructor(
    readonly name: ScrapeVendor,
    readonly capabilities: ScrapeCapabilities,
    private readonly steps: Step[],
    private readonly detail: { retryAfterMs?: number } = {},
  ) {
    super();
  }
  run(request: ScrapeRequest): Promise<ScrapePage> {
    this.calls.push({ proxyClass: request.proxyClass, render: request.render });
    const step = this.steps.shift() ?? 'ok';
    const page: ScrapePage = {
      html:
        step === 'unparsed'
          ? '<html><body>' + '<p>words</p>'.repeat(200) + '</body></html>'
          : mockPage(request.url),
      items: null,
      httpStatus: 200,
      rendered: request.render,
      costMicroUsd: null,
    };
    if (step === 'ok' || step === 'unparsed') return Promise.resolve(page);
    if (step === 'boom') return Promise.reject(new TypeError('socket hang up'));
    return Promise.reject(new ScrapeError(this.name, step, { ...this.detail, httpStatus: 403 }));
  }
  health() {
    return Promise.resolve({ ok: true, remaining: null });
  }
  estimateCostMicroUsd(_request: ScrapeRequest, proxyClass: ProxyClass): number {
    return { none: 100, datacenter: 200, residential: 800, unblocker: 1500 }[proxyClass];
  }
}

const caps = (over: Partial<ScrapeCapabilities> = {}): ScrapeCapabilities => ({
  render: false,
  proxyClasses: ['datacenter', 'residential', 'unblocker'],
  geo: true,
  structured: false,
  ...over,
});

function harness(
  providers: Scripted[],
  options: {
    stopped?: (vendor: ScrapeVendor | null) => boolean;
    open?: ScrapeVendor[];
    refuse?: (vendor: ScrapeVendor) => string | null;
    board?: VendorHealth[];
    env?: Record<string, string>;
  } = {},
) {
  const config = parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    PRICE_INTEL_VENDORS: 'firecrawl,apify,oxylabs,bright_data,direct,mock',
    FIRECRAWL_API_KEY: 'k'.repeat(12),
    APIFY_TOKEN: 'k'.repeat(12),
    OXYLABS_USERNAME: 'u',
    OXYLABS_PASSWORD: 'p'.repeat(12),
    BRIGHT_DATA_API_KEY: 'k'.repeat(12),
    BRIGHT_DATA_ZONE: 'zone',
    // Every vendor priced at every class, so the ladder is the policy's alone.
    PRICE_INTEL_COSTS: ['firecrawl', 'apify', 'oxylabs', 'bright_data', 'direct']
      .flatMap((vendor) =>
        ['none', 'datacenter', 'residential', 'unblocker'].map((proxy) => `${vendor}:${proxy}=100`),
      )
      .join(','),
    ...options.env,
  });
  const log = {
    penalised: [] as (number | undefined)[],
    opened: [] as [ScrapeVendor, number | undefined][],
    failures: [] as [ScrapeVendor, ScrapeFailureClass][],
    successes: [] as ScrapeVendor[],
    reserved: [] as [ScrapeVendor, number][],
    settled: [] as number[],
    released: 0,
  };
  const router = new ProviderRouter(
    new Map(providers.map((provider) => [provider.name, provider])),
    {
      stopped: (vendor: ScrapeVendor | null) => Promise.resolve(options.stopped?.(vendor) ?? false),
    } as never,
    {
      isOpen: (vendor: ScrapeVendor) => Promise.resolve(options.open?.includes(vendor) ?? false),
      failure: (vendor: ScrapeVendor, _domain: string, failure: ScrapeFailureClass) => {
        log.failures.push([vendor, failure]);
        return Promise.resolve();
      },
      success: (vendor: ScrapeVendor) => {
        log.successes.push(vendor);
        return Promise.resolve();
      },
      openVendor: (vendor: ScrapeVendor, ms?: number) => {
        log.opened.push([vendor, ms]);
        return Promise.resolve();
      },
    } as never,
    {
      acquire: () =>
        Promise.resolve({
          release: () => {
            log.released += 1;
            return Promise.resolve();
          },
        }),
      penalise: (_domain: string, retryAfterMs?: number) => {
        log.penalised.push(retryAfterMs);
        return Promise.resolve();
      },
    } as never,
    {
      reserve: (vendor: ScrapeVendor, _domain: string, amount: number) => {
        const refusal = options.refuse?.(vendor) ?? null;
        if (refusal) return Promise.resolve(refusal);
        log.reserved.push([vendor, amount]);
        return Promise.resolve({ keys: ['a', 'b', 'c', 'd'], reserved: amount });
      },
      settle: (_reservation: unknown, actual: number) => {
        log.settled.push(actual);
        return Promise.resolve();
      },
    } as never,
    { of: () => Promise.resolve(options.board ?? []), record: () => Promise.resolve() } as never,
    config,
  );
  return { router, log };
}

const policy = (over: Partial<RouterPolicy> = {}): RouterPolicy => ({
  domain: 'hotels.example.com',
  vendors: ['firecrawl', 'apify', 'oxylabs'],
  maxProxyClass: 'residential',
  requestsPerMinute: 600,
  maxConcurrency: 5,
  ...over,
});
const request: RouterRequest = {
  url: 'https://hotels.example.com/search?city=lagos',
  product: 'hotel',
  domain: 'hotels.example.com',
  country: 'NG',
  locale: 'en-NG',
  render: false,
  vendorSettings: {},
};
/** Stands in for extraction: a page without structured data cannot be read. */
const read = (page: ScrapePage, vendor: ScrapeVendor): string => {
  if (!page.html?.includes('application/ld+json')) throw new ScrapeError(vendor, 'parse_failed');
  return `read by ${vendor}`;
};
const signal = () => new AbortController().signal;
const instant = () => 0;

async function exhausted(run: Promise<unknown>): Promise<ScrapeExhausted> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ScrapeExhausted) return error;
    throw error;
  }
  throw new Error('expected ScrapeExhausted');
}

describe('provider router: one reaction per failure class (ADR-102)', () => {
  it('reads with the first vendor at the lowest class the policy allows', async () => {
    const firecrawl = new Scripted('firecrawl', caps(), ['ok']);
    const { router, log } = harness([firecrawl, new Scripted('apify', caps(), [])]);
    const result = await router.read(policy(), request, read, signal(), instant);
    expect(result).toMatchObject({
      value: 'read by firecrawl',
      vendor: 'firecrawl',
      proxyClass: 'datacenter',
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ outcome: 'ok', costMicroUsd: 200 });
    expect(log).toMatchObject({ successes: ['firecrawl'], settled: [200], released: 1 });
  });

  it('blocked: once more one class higher, never above the limit, then the next vendor', async () => {
    const firecrawl = new Scripted('firecrawl', caps(), ['blocked', 'blocked', 'blocked'], {
      retryAfterMs: 30_000,
    });
    const apify = new Scripted('apify', caps(), ['ok']);
    const { router, log } = harness([firecrawl, apify]);
    const result = await router.read(policy(), request, read, signal(), instant);
    // One escalation (datacenter to residential), not two: unblocker is above the policy.
    expect(firecrawl.calls.map((call) => call.proxyClass)).toEqual(['datacenter', 'residential']);
    expect(result.vendor).toBe('apify');
    expect(
      result.attempts.map((attempt) => [attempt.vendor, attempt.proxyClass, attempt.outcome]),
    ).toEqual([
      ['firecrawl', 'datacenter', 'blocked'],
      ['firecrawl', 'residential', 'blocked'],
      ['apify', 'datacenter', 'ok'],
    ]);
    // The site is slowed down on every block, with its Retry-After when it gave one.
    expect(log.penalised).toEqual([30_000, 30_000]);
    // A block before any page came back costs nothing.
    expect(log.settled).toEqual([0, 0, 200]);
  });

  it('blocked: no escalation at all when the policy allows only the lowest class', async () => {
    const direct = new Scripted('direct', caps({ proxyClasses: ['none'] }), ['blocked']);
    const oxylabs = new Scripted('oxylabs', caps({ proxyClasses: ['unblocker'] }), ['ok']);
    const { router } = harness([direct, oxylabs]);
    const error = await exhausted(
      router.read(
        policy({ vendors: ['direct', 'oxylabs'], maxProxyClass: 'none' }),
        request,
        read,
        signal(),
        instant,
      ),
    );
    expect(direct.calls).toHaveLength(1);
    // The unblocker vendor is above what the approver allowed: it is never called.
    expect(oxylabs.calls).toHaveLength(0);
    expect(error.failure).toBe('blocked');
  });

  it('timeout and provider_error: one retry, then the next vendor', async () => {
    for (const failure of ['timeout', 'provider_error'] as const) {
      const firecrawl = new Scripted('firecrawl', caps(), [failure, failure, failure]);
      const apify = new Scripted('apify', caps(), ['ok']);
      const { router, log } = harness([firecrawl, apify]);
      const result = await router.read(policy(), request, read, signal(), instant);
      expect([failure, firecrawl.calls.length]).toEqual([failure, 2]);
      expect(result.vendor).toBe('apify');
      expect(log.penalised).toEqual([]);
    }
  });

  it('an error nobody classified counts as the vendor failing', async () => {
    const firecrawl = new Scripted('firecrawl', caps(), ['boom', 'ok']);
    const { router } = harness([firecrawl]);
    const result = await router.read(policy(), request, read, signal(), instant);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['provider_error', 'ok']);
    expect(classifyFailure(new TypeError('x'))).toBe('provider_error');
    expect(classifyFailure(new DOMException('late', 'TimeoutError'))).toBe('timeout');
    expect(classifyFailure(new FetchRefused('private_address'))).toBe('policy_denied');
  });

  it('quota_exhausted: the breaker opens until the reset and the next vendor reads', async () => {
    const firecrawl = new Scripted('firecrawl', caps(), ['quota_exhausted', 'ok'], {
      retryAfterMs: 120_000,
    });
    const apify = new Scripted('apify', caps(), ['ok']);
    const { router, log } = harness([firecrawl, apify]);
    const result = await router.read(policy(), request, read, signal(), instant);
    expect(firecrawl.calls).toHaveLength(1);
    expect(log.opened).toEqual([['firecrawl', 120_000]]);
    expect(result.vendor).toBe('apify');
  });

  it('empty or unparsed: once more with rendering, then only vendors that render', async () => {
    const firecrawl = new Scripted('firecrawl', caps({ render: true }), [
      'empty_or_unrendered',
      'unparsed',
    ]);
    const apify = new Scripted('apify', caps({ render: false }), ['ok']);
    const oxylabs = new Scripted('oxylabs', caps({ render: true }), ['ok']);
    const { router } = harness([firecrawl, apify, oxylabs]);
    const result = await router.read(
      policy({ maxProxyClass: 'unblocker' }),
      request,
      read,
      signal(),
      instant,
    );
    expect(firecrawl.calls.map((call) => call.render)).toEqual([false, true]);
    // The vendor that cannot render is skipped once rendering is needed.
    expect(apify.calls).toHaveLength(0);
    expect(oxylabs.calls.map((call) => call.render)).toEqual([true]);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      'empty_or_unrendered',
      'parse_failed',
      'ok',
    ]);
    // A page that came back and could not be read was still fetched: it is paid for.
    expect(result.attempts[1]?.costMicroUsd).toBe(200);
  });

  it('policy_denied: stops at once, whoever is next', async () => {
    const firecrawl = new Scripted('firecrawl', caps(), ['policy_denied']);
    const apify = new Scripted('apify', caps(), ['ok']);
    const { router } = harness([firecrawl, apify]);
    const error = await exhausted(router.read(policy(), request, read, signal(), instant));
    expect(error).toMatchObject({ failure: 'policy_denied', reason: 'policy' });
    expect(apify.calls).toHaveLength(0);
  });

  it('covers every failure class', () => {
    expect([...SCRAPE_FAILURE_CLASSES].sort()).toEqual(
      [
        'blocked',
        'timeout',
        'provider_error',
        'quota_exhausted',
        'empty_or_unrendered',
        'parse_failed',
        'policy_denied',
      ].sort(),
    );
  });
});

describe('provider router: limits and switches (ADR-102)', () => {
  it('gives up with every attempt listed when the chain is spent, and never loops', async () => {
    const vendors = (['firecrawl', 'apify', 'oxylabs'] as const).map(
      (name) =>
        new Scripted(
          name,
          caps(),
          Array.from({ length: 20 }, () => 'timeout' as const),
        ),
    );
    const { router, log } = harness(vendors);
    const error = await exhausted(router.read(policy(), request, read, signal(), instant));
    expect(error).toMatchObject({ failure: 'timeout', reason: 'chain_spent' });
    // Two tries per vendor (one retry), three vendors.
    expect(error.attempts).toHaveLength(6);
    expect(log.released).toBe(6);
  });

  it('stops at the attempt limit even when vendors remain', async () => {
    const vendors = (['firecrawl', 'apify', 'oxylabs'] as const).map(
      (name) =>
        new Scripted(
          name,
          caps(),
          Array.from({ length: 20 }, () => 'timeout' as const),
        ),
    );
    const { router } = harness(vendors, { env: { PRICE_INTEL_MAX_ATTEMPTS: '3' } });
    const error = await exhausted(router.read(policy(), request, read, signal(), instant));
    expect(error.reason).toBe('attempt_limit');
    expect(error.attempts).toHaveLength(3);
  });

  it('stops before a call that would pass the cost limit of one read', async () => {
    const firecrawl = new Scripted('firecrawl', caps({ render: true }), ['unparsed', 'unparsed']);
    const apify = new Scripted('apify', caps({ render: true }), ['ok']);
    const { router } = harness([firecrawl, apify], {
      env: { PRICE_INTEL_JOB_MAX_MICROUSD: '450' },
    });
    const error = await exhausted(router.read(policy(), request, read, signal(), instant));
    // Two paid pages at 200 each; a third would make 600.
    expect(error).toMatchObject({ failure: 'policy_denied', reason: 'job_cost_limit' });
    expect(apify.calls).toHaveLength(0);
  });

  it('reads nothing while everything or the site is switched off, and skips a switched-off vendor', async () => {
    const firecrawl = new Scripted('firecrawl', caps(), ['ok']);
    const apify = new Scripted('apify', caps(), ['ok']);
    const all = harness([firecrawl, apify], { stopped: () => true });
    const error = await exhausted(all.router.read(policy(), request, read, signal(), instant));
    expect(error).toMatchObject({ failure: 'policy_denied', reason: 'switched_off' });
    expect(firecrawl.calls).toHaveLength(0);

    const one = harness([firecrawl, apify], { stopped: (vendor) => vendor === 'firecrawl' });
    const result = await one.router.read(policy(), request, read, signal(), instant);
    expect(result.vendor).toBe('apify');
    expect(firecrawl.calls).toHaveLength(0);
  });

  it('skips a vendor whose breaker is open or whose budget is spent, and stops when the site budget is', async () => {
    const firecrawl = new Scripted('firecrawl', caps(), ['ok']);
    const apify = new Scripted('apify', caps(), ['ok']);
    const oxylabs = new Scripted('oxylabs', caps(), ['ok']);
    const skipped = harness([firecrawl, apify, oxylabs], {
      open: ['firecrawl'],
      refuse: (vendor) => (vendor === 'apify' ? 'vendor_day' : null),
    });
    const result = await skipped.router.read(policy(), request, read, signal(), instant);
    expect(result.vendor).toBe('oxylabs');
    expect(firecrawl.calls.length + apify.calls.length).toBe(0);

    const site = harness([firecrawl, apify], { refuse: () => 'domain_month' });
    const error = await exhausted(site.router.read(policy(), request, read, signal(), instant));
    expect(error).toMatchObject({ failure: 'policy_denied', reason: 'budget_domain_month' });
    expect(apify.calls).toHaveLength(0);
  });

  it('calls only vendors the policy names and the environment enables', async () => {
    const bright = new Scripted('bright_data', caps(), ['ok']);
    const firecrawl = new Scripted('firecrawl', caps(), ['ok']);
    const { router } = harness([bright, firecrawl]);
    const result = await router.read(
      policy({ vendors: ['apify', 'firecrawl'] }),
      request,
      read,
      signal(),
      instant,
    );
    // apify is named but not enabled; bright_data is enabled but not named.
    expect(result.vendor).toBe('firecrawl');
    expect(bright.calls).toHaveLength(0);
    const none = await exhausted(
      router.read(policy({ vendors: ['apify'] }), request, read, signal(), instant),
    );
    expect(none).toMatchObject({ failure: 'policy_denied', reason: 'no_vendor', attempts: [] });
  });

  it('gives up when the caller has gone away', async () => {
    const firecrawl = new Scripted('firecrawl', caps(), ['ok']);
    const { router } = harness([firecrawl]);
    const gone = new AbortController();
    gone.abort();
    const error = await exhausted(router.read(policy(), request, read, gone.signal, instant));
    expect(error).toMatchObject({ failure: 'timeout', reason: 'time_limit' });
    expect(firecrawl.calls).toHaveLength(0);
  });
});

describe('health order (ADR-102)', () => {
  const entry = (
    vendor: ScrapeVendor,
    attempts: number,
    successes: number,
    cost: number | null = null,
  ): VendorHealth => ({
    vendor,
    attempts,
    successes,
    meanMs: 1000,
    costPerSuccessMicroUsd: cost,
  });

  it('keeps the policy order until a vendor has a record', () => {
    expect(healthOrder(['firecrawl', 'apify', 'oxylabs'], [])).toEqual([
      'firecrawl',
      'apify',
      'oxylabs',
    ]);
    expect(healthOrder(['firecrawl', 'apify'], [entry('apify', 4, 4)])).toEqual([
      'firecrawl',
      'apify',
    ]);
  });

  it('tries the vendor that works first, the cheaper of two that work, and adds nobody', () => {
    expect(
      healthOrder(
        ['firecrawl', 'apify', 'oxylabs'],
        [entry('firecrawl', 20, 2), entry('oxylabs', 20, 19)],
      ),
    ).toEqual(['oxylabs', 'apify', 'firecrawl']);
    expect(
      healthOrder(
        ['firecrawl', 'apify'],
        [entry('firecrawl', 10, 9, 5000), entry('apify', 10, 9, 1200)],
      ),
    ).toEqual(['apify', 'firecrawl']);
    expect(
      healthOrder(['firecrawl'], [entry('bright_data', 50, 50), entry('firecrawl', 10, 5)]),
    ).toEqual(['firecrawl']);
  });
});
