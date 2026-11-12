import type { ProxyClass, ScrapeVendor } from '@suskii/shared';

import type { ScrapeCosts } from '../../config/env.schema';
import {
  ScrapeError,
  ScrapeProvider,
  type ScrapeCapabilities,
  type ScrapeHealth,
  type ScrapePage,
  type ScrapeRequest,
} from '../scrape-provider';

import { assertVendorOk, isRecord, vendorCall, vendorJson, type HttpFetch } from './scrape-http';

const API = 'https://api.firecrawl.dev';
/** Firecrawl's two proxy kinds, as our classes: its plain proxies and its stealth ones. */
const PROXY: Partial<Record<ProxyClass, 'basic' | 'stealth'>> = {
  datacenter: 'basic',
  unblocker: 'stealth',
};
/** How long a rendered page is given to settle, in milliseconds. */
const RENDER_WAIT_MS = 2500;

export interface FirecrawlOptions {
  apiKey: string;
  costs: ScrapeCosts['firecrawl'];
  fetch?: HttpFetch;
}

/**
 * Firecrawl (`POST /v2/scrape`, bearer key). Shapes follow its official SDK (`firecrawl` 4.52.0
 * on npm): the page comes back as `data.rawHtml` with the site's status in
 * `data.metadata.statusCode`. A site's settings may carry `jsonSchema` (and `jsonPrompt`) to
 * have Firecrawl return fields as `data.json` as well. Its own cache is switched off
 * (`maxAge: 0`): freshness is ours to decide.
 */
export class FirecrawlScrapeProvider extends ScrapeProvider {
  readonly name: ScrapeVendor = 'firecrawl';
  readonly capabilities: ScrapeCapabilities = {
    render: true,
    proxyClasses: ['datacenter', 'unblocker'],
    geo: true,
    structured: true,
  };
  private readonly fetchImpl: HttpFetch;

  constructor(private readonly options: FirecrawlOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async run(request: ScrapeRequest, signal: AbortSignal): Promise<ScrapePage> {
    const schema = request.settings.jsonSchema;
    const formats: unknown[] = ['rawHtml'];
    if (isRecord(schema)) {
      formats.push({
        type: 'json',
        schema,
        ...(typeof request.settings.jsonPrompt === 'string'
          ? { prompt: request.settings.jsonPrompt }
          : {}),
      });
    }
    const response = await vendorCall(this.fetchImpl, this.name, `${API}/v2/scrape`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        url: request.url,
        formats,
        onlyMainContent: false,
        maxAge: 0,
        storeInCache: false,
        timeout: Math.max(1000, request.timeoutMs - 1000),
        proxy: PROXY[request.proxyClass] ?? 'basic',
        location: { country: request.country.toUpperCase() },
        ...(request.render ? { waitFor: RENDER_WAIT_MS } : {}),
      }),
      signal,
    });
    const body = response.status === 408 ? null : vendorJson(this.name, response.text);
    if (response.status === 408 || (isRecord(body) && body.code === 'SCRAPE_TIMEOUT')) {
      throw new ScrapeError(this.name, 'timeout', { reason: 'vendor timed out' });
    }
    assertVendorOk(this.name, response);
    if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'no data in the answer' });
    }
    const data = body.data;
    const metadata = isRecord(data.metadata) ? data.metadata : {};
    const json = data.json;
    const items = Array.isArray(json)
      ? json.filter(isRecord)
      : isRecord(json)
        ? Array.isArray(json.items)
          ? json.items.filter(isRecord)
          : [json]
        : null;
    return {
      html: typeof data.rawHtml === 'string' ? data.rawHtml : null,
      items,
      httpStatus: typeof metadata.statusCode === 'number' ? metadata.statusCode : null,
      rendered: request.render,
      // Credits are not dollars: the estimate from the owner's price list is used instead.
      costMicroUsd: null,
    };
  }

  async health(signal: AbortSignal): Promise<ScrapeHealth> {
    const response = await vendorCall(this.fetchImpl, this.name, `${API}/v2/team/credit-usage`, {
      method: 'GET',
      headers: this.headers(),
      signal,
    });
    if (response.status !== 200) return { ok: false, remaining: null };
    const body = vendorJson(this.name, response.text);
    const data = isRecord(body) && isRecord(body.data) ? body.data : {};
    const remaining = data.remainingCredits ?? data.remaining_credits;
    return { ok: true, remaining: typeof remaining === 'number' ? remaining : null };
  }

  estimateCostMicroUsd(_request: ScrapeRequest, proxyClass: ProxyClass): number {
    return this.options.costs[proxyClass] ?? 0;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    };
  }
}
