import { Inject, Injectable } from '@nestjs/common';

import {
  FAILURE_REACTIONS,
  firstProxyClass,
  nextProxyClass,
  type ProxyClass,
  type ScrapeFailureClass,
  type ScrapeVendor,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { priceIntelAttempts, priceIntelCost } from '../telemetry/metrics';

import { DomainThrottle, type ThrottleLease } from './domain-throttle';
import { PriceIntelBudget } from './price-intel-budget';
import { PriceIntelSwitches } from './price-intel-switches';
import { ScrapeBreakers } from './scrape-breakers';
import { ScrapeHealthBoard, healthOrder } from './scrape-health';
import {
  pageProblem,
  ScrapeError,
  ScrapeExhausted,
  type AttemptRecord,
  type ScrapePage,
  type ScrapeProvider,
  type ScrapeRequest,
} from './scrape-provider';
import { SCRAPE_PROVIDERS, type ScrapeProviders } from './scrape-providers';
import { FetchRefused } from './ssrf-guard';

/** What the router needs of a site's policy. */
export interface RouterPolicy {
  domain: string;
  /** The vendors that may read the site, in the approver's order. */
  vendors: readonly ScrapeVendor[];
  maxProxyClass: ProxyClass;
  requestsPerMinute: number;
  maxConcurrency: number;
}

export type RouterRequest = Omit<ScrapeRequest, 'proxyClass' | 'timeoutMs' | 'settings'> & {
  /** Per vendor, what only that vendor needs. */
  vendorSettings: Readonly<Partial<Record<ScrapeVendor, Record<string, unknown>>>>;
};

export interface RouterResult<T> {
  value: T;
  vendor: ScrapeVendor;
  proxyClass: ProxyClass;
  page: ScrapePage;
  attempts: AttemptRecord[];
}

const BACKOFF_MIN_MS = 300;
const BACKOFF_SPREAD_MS = 700;

/** What went wrong, as one of the seven classes. Anything unknown is the vendor's failure. */
export function classifyFailure(error: unknown): ScrapeFailureClass {
  if (error instanceof ScrapeError) return error.failure;
  if (error instanceof FetchRefused) return 'policy_denied';
  // An abort is a DOMException, which is not always an `Error` of this realm: go by its name.
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : null;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  return 'provider_error';
}

/** A page that came back was fetched, so it was paid for whatever we could read from it. */
const CHARGED_WITHOUT_PAGE: ReadonlySet<ScrapeFailureClass> = new Set(['timeout']);

/**
 * Failover across web-data vendors (ADR-102). It walks the vendors a site's policy allows,
 * best record first, and reacts to each failure in exactly one way (`FAILURE_REACTIONS`):
 *
 * - `blocked`: once more on the same vendor one proxy class higher, never above the class the
 *   approver allowed, then the next vendor; the site is slowed down either way.
 * - `timeout`, `provider_error`: one retry after a backoff with jitter, then the next vendor.
 * - `quota_exhausted`: the vendor's breaker opens until its reset; the next vendor.
 * - `empty_or_unrendered`, `parse_failed`: once more with rendering if this vendor renders,
 *   then only vendors that render.
 * - `policy_denied`: stop.
 *
 * A read has hard limits on attempts, time and cost, so nothing loops. When the chain is spent
 * it throws `ScrapeExhausted` with every attempt it made.
 */
@Injectable()
export class ProviderRouter {
  constructor(
    @Inject(SCRAPE_PROVIDERS) private readonly providers: ScrapeProviders,
    private readonly switches: PriceIntelSwitches,
    private readonly breakers: ScrapeBreakers,
    private readonly throttle: DomainThrottle,
    private readonly budget: PriceIntelBudget,
    private readonly health: ScrapeHealthBoard,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Fetches `request` under `policy` and passes each page to `read`, which returns what it
   * found or throws `ScrapeError` (`parse_failed`, `empty_or_unrendered`) to try elsewhere.
   */
  async read<T>(
    policy: RouterPolicy,
    request: RouterRequest,
    read: (page: ScrapePage, vendor: ScrapeVendor) => T,
    signal: AbortSignal,
    random: () => number = Math.random,
  ): Promise<RouterResult<T>> {
    const { domain } = policy;
    const attempts: AttemptRecord[] = [];
    const deadline = Date.now() + this.config.PRICE_INTEL_JOB_TIMEOUT_MS;
    let spent = 0;
    let lastFailure: ScrapeFailureClass = 'policy_denied';
    let reason = 'no_vendor';
    const exhausted = (failure: ScrapeFailureClass, why: string): ScrapeExhausted =>
      new ScrapeExhausted(failure, attempts, why);

    if (await this.switches.stopped(null, domain)) throw exhausted('policy_denied', 'switched_off');
    const chain = policy.vendors.filter((vendor) => this.providers.has(vendor));
    if (chain.length === 0) throw exhausted('policy_denied', 'no_vendor');
    const order = healthOrder(chain, await this.health.of(chain, domain));

    let needRender = request.render;
    for (const vendor of order) {
      const provider = this.providers.get(vendor);
      if (!provider) continue;
      if (needRender && !provider.capabilities.render) {
        reason = 'no_rendering_vendor';
        continue;
      }
      if (await this.switches.stopped(vendor, domain)) {
        reason = 'switched_off';
        continue;
      }
      if (await this.breakers.isOpen(vendor, domain)) {
        reason = 'breaker_open';
        continue;
      }
      const offered = this.offered(provider);
      let proxy = firstProxyClass(policy.maxProxyClass, offered);
      if (proxy === null) {
        reason = 'proxy_limit';
        continue;
      }

      let escalated = false;
      let retried = false;
      let render = needRender;
      let renderRetried = false;
      vendorLoop: for (;;) {
        if (attempts.length >= this.config.PRICE_INTEL_MAX_ATTEMPTS) {
          throw exhausted(lastFailure, 'attempt_limit');
        }
        if (Date.now() >= deadline || signal.aborted) throw exhausted('timeout', 'time_limit');

        const attemptRequest: ScrapeRequest = {
          url: request.url,
          product: request.product,
          domain,
          country: request.country,
          locale: request.locale,
          proxyClass: proxy,
          render,
          timeoutMs: Math.max(
            500,
            Math.min(this.config.PRICE_INTEL_ATTEMPT_TIMEOUT_MS, deadline - Date.now()),
          ),
          settings: request.vendorSettings[vendor] ?? {},
        };
        const estimate = provider.estimateCostMicroUsd(attemptRequest, proxy);
        if (spent + estimate > this.config.PRICE_INTEL_JOB_MAX_MICROUSD) {
          throw exhausted('policy_denied', 'job_cost_limit');
        }
        const reservation = await this.budget.reserve(vendor, domain, estimate);
        if (typeof reservation === 'string') {
          lastFailure = 'policy_denied';
          reason = `budget_${reservation}`;
          // The site's own budget is spent: no vendor may read it. A vendor's: try the next.
          if (reservation.startsWith('domain')) throw exhausted('policy_denied', reason);
          break;
        }

        let lease: ThrottleLease;
        try {
          lease = await this.throttle.acquire(vendor, domain, policy, deadline, signal, random);
        } catch {
          await this.budget.settle(reservation, 0);
          throw exhausted('timeout', 'throttle');
        }

        const started = Date.now();
        let page: ScrapePage | null = null;
        try {
          page = await provider.run(
            attemptRequest,
            AbortSignal.any([signal, AbortSignal.timeout(attemptRequest.timeoutMs)]),
          );
          const problem = pageProblem(page);
          if (problem) {
            throw new ScrapeError(vendor, problem, { httpStatus: page.httpStatus ?? undefined });
          }
          const value = read(page, vendor);
          const cost = page.costMicroUsd ?? estimate;
          spent += cost;
          attempts.push(this.attempt(vendor, proxy, 'ok', page, render, started, cost));
          await this.budget.settle(reservation, cost);
          await this.health.record(vendor, domain, {
            ok: true,
            durationMs: Date.now() - started,
            costMicroUsd: cost,
          });
          await this.breakers.success(vendor, domain);
          return { value, vendor, proxyClass: proxy, page, attempts };
        } catch (error) {
          const failure = classifyFailure(error);
          const detail = error instanceof ScrapeError ? error.detail : {};
          // A page that came back was fetched and paid for; a timeout may have been too.
          const cost =
            page !== null
              ? (page.costMicroUsd ?? estimate)
              : CHARGED_WITHOUT_PAGE.has(failure)
                ? estimate
                : 0;
          spent += cost;
          attempts.push(
            this.attempt(vendor, proxy, failure, page, render, started, cost, detail.httpStatus),
          );
          await this.budget.settle(reservation, cost);
          await this.health.record(vendor, domain, {
            ok: false,
            durationMs: Date.now() - started,
            costMicroUsd: cost,
          });
          await this.breakers.failure(vendor, domain, failure);
          lastFailure = failure;
          reason = 'chain_spent';

          switch (FAILURE_REACTIONS[failure]) {
            case 'stop':
              throw exhausted(failure, 'policy');
            case 'escalate_proxy': {
              await this.throttle.penalise(domain, detail.retryAfterMs);
              const next: ProxyClass | null = escalated
                ? null
                : nextProxyClass(proxy, policy.maxProxyClass, offered);
              if (next === null) break vendorLoop;
              escalated = true;
              proxy = next;
              continue vendorLoop;
            }
            case 'retry_once': {
              if (retried) break vendorLoop;
              retried = true;
              const wait = BACKOFF_MIN_MS + Math.floor(random() * BACKOFF_SPREAD_MS);
              if (Date.now() + wait >= deadline) throw exhausted(failure, 'time_limit');
              await new Promise((resolve) => setTimeout(resolve, wait));
              continue vendorLoop;
            }
            case 'open_breaker':
              await this.breakers.openVendor(vendor, detail.retryAfterMs);
              break vendorLoop;
            case 'need_rendering': {
              needRender = true;
              if (render || renderRetried || !provider.capabilities.render) break vendorLoop;
              renderRetried = true;
              render = true;
              continue vendorLoop;
            }
          }
        } finally {
          await lease.release();
        }
      }
    }
    throw exhausted(lastFailure, reason);
  }

  /** The classes a vendor offers that the owner's price list has a price for. */
  private offered(provider: ScrapeProvider): ProxyClass[] {
    const priced = this.config.PRICE_INTEL_COSTS[provider.name];
    return provider.capabilities.proxyClasses.filter((proxy) => priced[proxy] !== undefined);
  }

  private attempt(
    vendor: ScrapeVendor,
    proxyClass: ProxyClass,
    outcome: AttemptRecord['outcome'],
    page: ScrapePage | null,
    render: boolean,
    started: number,
    costMicroUsd: number,
    httpStatus?: number,
  ): AttemptRecord {
    priceIntelAttempts.add(1, { vendor, proxy: proxyClass, outcome });
    if (costMicroUsd > 0) priceIntelCost.add(costMicroUsd, { vendor });
    return {
      vendor,
      proxyClass,
      outcome,
      httpStatus: page?.httpStatus ?? httpStatus ?? null,
      rendered: page?.rendered ?? render,
      durationMs: Date.now() - started,
      costMicroUsd,
    };
  }
}
