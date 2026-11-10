import type { ProxyClass, ScrapeVendor } from '@suskii/shared';

import type { ScrapeCosts } from '../../config/env.schema';
import {
  ScrapeProvider,
  type ScrapeCapabilities,
  type ScrapeHealth,
  type ScrapePage,
  type ScrapeRequest,
} from '../scrape-provider';

import { assertVendorOk, isRecord, vendorCall, vendorJson, type HttpFetch } from './scrape-http';

const API = 'https://api.brightdata.com';

export interface BrightDataOptions {
  apiKey: string;
  /** The Web Unlocker zone requests go through. */
  zone: string;
  costs: ScrapeCosts['bright_data'];
  fetch?: HttpFetch;
}

/**
 * Bright Data Web Unlocker (`POST /request`, bearer key, a zone). Shapes follow its official
 * SDK (`@brightdata/sdk` 1.2.0 on npm): with `format: "raw"` the answer's body is the page
 * itself, so the site's own status is not reported; a refusal shows as the vendor's status or
 * as a challenge page, which the page checks catch. Getting past a site's defences is this
 * product's job, so it counts as the highest proxy class and runs only where a policy's
 * approver allowed that class.
 */
export class BrightDataScrapeProvider extends ScrapeProvider {
  readonly name: ScrapeVendor = 'bright_data';
  readonly capabilities: ScrapeCapabilities = {
    render: false,
    proxyClasses: ['unblocker'],
    geo: true,
    structured: false,
  };
  private readonly fetchImpl: HttpFetch;

  constructor(private readonly options: BrightDataOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async run(request: ScrapeRequest, signal: AbortSignal): Promise<ScrapePage> {
    const response = await vendorCall(this.fetchImpl, this.name, `${API}/request`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        method: 'GET',
        url: request.url,
        zone: this.options.zone,
        country: request.country.toLowerCase(),
        format: 'raw',
      }),
      signal,
    });
    assertVendorOk(this.name, response);
    return {
      html: response.text,
      items: null,
      httpStatus: null,
      rendered: false,
      costMicroUsd: null,
    };
  }

  /** The key works and the configured zone is active. */
  async health(signal: AbortSignal): Promise<ScrapeHealth> {
    const response = await vendorCall(this.fetchImpl, this.name, `${API}/zone/get_active_zones`, {
      method: 'GET',
      headers: this.headers(),
      signal,
    });
    if (response.status !== 200) return { ok: false, remaining: null };
    const zones = vendorJson(this.name, response.text);
    const active =
      Array.isArray(zones) &&
      zones.some((zone) => isRecord(zone) && (zone.zone ?? zone.name) === this.options.zone);
    return { ok: active, remaining: null };
  }

  estimateCostMicroUsd(_request: ScrapeRequest, proxyClass: ProxyClass): number {
    return this.options.costs[proxyClass] ?? 0;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.apiKey}`,
      'content-type': 'application/json',
    };
  }
}
