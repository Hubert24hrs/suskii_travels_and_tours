import type { ProxyClass, ScrapeVendor } from '@suskii/shared';

import type { ScrapeCosts } from '../../config/env.schema';
import { parseExactJson } from '../../pricing/fx-providers';
import {
  ScrapeError,
  ScrapeProvider,
  type ScrapeCapabilities,
  type ScrapeHealth,
  type ScrapePage,
  type ScrapeRequest,
} from '../scrape-provider';

import { assertVendorOk, isRecord, vendorCall, type HttpFetch } from './scrape-http';

const API = 'https://realtime.oxylabs.io/v1/queries';

export interface OxylabsOptions {
  username: string;
  password: string;
  costs: ScrapeCosts['oxylabs'];
  fetch?: HttpFetch;
}

/**
 * Oxylabs Web Scraper API, realtime (`POST /v1/queries`, basic auth). Shapes follow its official
 * Python SDK (`oxylabs` 3.0.0 on PyPI): the page is `results[0].content` with the site's status
 * in `results[0].status_code`. A site's settings may carry `source` (default `universal`),
 * `geoLocation` (in the form Oxylabs expects for that source) and `parsingInstructions`, with
 * which Oxylabs returns fields instead of a page. Managed access to sites is this product's
 * job, so it counts as the highest proxy class.
 */
export class OxylabsScrapeProvider extends ScrapeProvider {
  readonly name: ScrapeVendor = 'oxylabs';
  readonly capabilities: ScrapeCapabilities = {
    render: true,
    proxyClasses: ['unblocker'],
    geo: true,
    structured: true,
  };
  private readonly fetchImpl: HttpFetch;

  constructor(private readonly options: OxylabsOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async run(request: ScrapeRequest, signal: AbortSignal): Promise<ScrapePage> {
    const { settings } = request;
    const instructions = isRecord(settings.parsingInstructions)
      ? settings.parsingInstructions
      : null;
    const response = await vendorCall(this.fetchImpl, this.name, API, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(
          `${this.options.username}:${this.options.password}`,
        ).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source: typeof settings.source === 'string' ? settings.source : 'universal',
        url: request.url,
        user_agent_type: 'desktop',
        ...(request.render ? { render: 'html' } : {}),
        ...(typeof settings.geoLocation === 'string' ? { geo_location: settings.geoLocation } : {}),
        ...(instructions ? { parse: true, parsing_instructions: instructions } : {}),
      }),
      signal,
    });
    assertVendorOk(this.name, response);
    let body: unknown;
    try {
      // Parsed fields can hold prices: numbers stay as their exact text.
      body = parseExactJson(response.text);
    } catch {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'answer is not JSON' });
    }
    const results: unknown[] = isRecord(body) && Array.isArray(body.results) ? body.results : [];
    const result = results[0];
    if (!isRecord(result)) {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'no result in the answer' });
    }
    const status = Number(result.status_code);
    const content = result.content;
    const items = isRecord(content)
      ? Array.isArray(content.items)
        ? content.items.filter(isRecord)
        : [content]
      : Array.isArray(content)
        ? content.filter(isRecord)
        : null;
    return {
      html: typeof content === 'string' ? content : null,
      items,
      httpStatus: Number.isInteger(status) ? status : null,
      rendered: request.render,
      costMicroUsd: null,
    };
  }

  /**
   * The SDK names no call that checks credentials without fetching a page, so this says only
   * that the adapter is configured; `sandbox:scrapers` checks the account with a real request.
   */
  health(): Promise<ScrapeHealth> {
    return Promise.resolve({ ok: true, remaining: null });
  }

  estimateCostMicroUsd(_request: ScrapeRequest, proxyClass: ProxyClass): number {
    return this.options.costs[proxyClass] ?? 0;
  }
}
