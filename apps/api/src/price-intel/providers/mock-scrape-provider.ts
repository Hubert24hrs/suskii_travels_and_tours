import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  PROXY_CLASSES,
  type ProxyClass,
  type ScrapeFailureClass,
  type ScrapeVendor,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../../config/config';
import {
  ScrapeError,
  ScrapeProvider,
  type ScrapeCapabilities,
  type ScrapeHealth,
  type ScrapePage,
  type ScrapeRequest,
} from '../scrape-provider';

/** What the mock answers next for a site: a page, a failure, or silence until the call is aborted. */
export type MockOutcome =
  | { page: Partial<ScrapePage> }
  | { fail: ScrapeFailureClass; httpStatus?: number; retryAfterMs?: number }
  | { hang: true };

const digest = (text: string): number => createHash('sha256').update(text).digest().readUInt32BE(0);

/**
 * A page as a small hotel site might serve it: three hotels as schema.org data, visible prices,
 * and the things a real page has that must never be stored: a guest review with its author's
 * name and a contact line with an email address and a phone number. Prices come from the
 * address alone, so the same question always reads the same.
 */
export function mockPage(url: string, currency = 'NGN'): string {
  const seed = digest(url);
  const hotels = ['Harbour View Hotel', 'Marina Court Suites', 'Lekki Garden Inn'].map(
    (name, index) => ({
      name,
      stars: 3 + ((seed >> index) % 3),
      price: 45_000 + ((seed >> (index * 4)) % 60) * 2_500,
    }),
  );
  const graph = hotels.map((hotel) => ({
    '@type': 'Hotel',
    name: hotel.name,
    starRating: { '@type': 'Rating', ratingValue: hotel.stars },
    review: {
      '@type': 'Review',
      author: { '@type': 'Person', name: 'Adaeze Okafor' },
      reviewBody: 'Lovely stay, call me on +234 803 555 0142.',
    },
    offers: {
      '@type': 'Offer',
      price: hotel.price,
      priceCurrency: currency,
      availability: 'https://schema.org/InStock',
      url: `/hotels/${hotel.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
    },
  }));
  const cards = hotels
    .map(
      (hotel) =>
        `<article class="result"><h2 class="name">${hotel.name}</h2>` +
        `<span class="stars">${hotel.stars} stars</span>` +
        `<span class="price">${currency} ${hotel.price.toLocaleString('en-US')}</span>` +
        `<span class="stock">Available</span>` +
        `<p class="review">"Great place" by Adaeze Okafor</p></article>`,
    )
    .join('');
  return (
    `<!doctype html><html><head><title>Hotels (sample)</title>` +
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>` +
    `</head><body><main>${cards}</main>` +
    `<footer>Reservations: bookings@example.com, +234 803 555 0100. ` +
    `Sample data from the mock vendor; not a real site or a real price.</footer></body></html>`
  );
}

/**
 * The vendor used locally and in tests (ADR-102): it fetches nothing. By default it answers
 * every address with `mockPage`; a test can queue outcomes per site to rehearse a block, a
 * timeout, an empty page or a spent quota. Production refuses it unless `ALLOW_MOCK_PROVIDERS`.
 */
@Injectable()
export class MockScrapeProvider extends ScrapeProvider {
  readonly name: ScrapeVendor = 'mock';
  readonly capabilities: ScrapeCapabilities = {
    render: true,
    proxyClasses: PROXY_CLASSES,
    geo: true,
    structured: false,
  };
  /** Every request it was given, for tests. */
  readonly calls: ScrapeRequest[] = [];
  private readonly queued = new Map<string, MockOutcome[]>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  /** Queues what the next calls for `domain` answer; after the queue, the default page again. */
  script(domain: string, outcomes: readonly MockOutcome[]): void {
    this.queued.set(domain, [...outcomes]);
  }

  reset(): void {
    this.queued.clear();
    this.calls.length = 0;
  }

  async run(request: ScrapeRequest, signal: AbortSignal): Promise<ScrapePage> {
    this.calls.push(request);
    const outcome = this.queued.get(request.domain)?.shift();
    if (outcome && 'fail' in outcome) {
      throw new ScrapeError(this.name, outcome.fail, {
        httpStatus: outcome.httpStatus,
        retryAfterMs: outcome.retryAfterMs,
      });
    }
    if (outcome && 'hang' in outcome) {
      await new Promise<never>((_resolve, reject) => {
        const abort = (): void => reject(new ScrapeError(this.name, 'timeout'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    }
    const page = outcome && 'page' in outcome ? outcome.page : {};
    return {
      html: mockPage(request.url),
      items: null,
      httpStatus: 200,
      rendered: request.render,
      costMicroUsd: null,
      ...page,
    };
  }

  health(): Promise<ScrapeHealth> {
    return Promise.resolve({ ok: true, remaining: null });
  }

  estimateCostMicroUsd(_request: ScrapeRequest, proxyClass: ProxyClass): number {
    return this.config.PRICE_INTEL_COSTS.mock[proxyClass] ?? 0;
  }
}
