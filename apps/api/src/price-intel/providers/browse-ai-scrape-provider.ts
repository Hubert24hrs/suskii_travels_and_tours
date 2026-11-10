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

import {
  assertVendorOk,
  fillTemplate,
  isRecord,
  pause,
  vendorCall,
  type HttpFetch,
} from './scrape-http';

const API = 'https://api.browse.ai/v2';
const ROBOT_ID = /^[A-Za-z0-9-]{8,64}$/;
const POLL_MS = 3000;
const MAX_ITEMS = 50;

export interface BrowseAiOptions {
  apiKey: string;
  costs: ScrapeCosts['browse_ai'];
  fetch?: HttpFetch;
  /** Time between polls; tests shorten it. */
  pollMs?: number;
}

/**
 * Browse AI (bearer key): a robot the owner trained on a site is run on demand
 * (`POST /robots/{robot}/tasks`) and its task polled (`GET /robots/{robot}/tasks/{task}`) until
 * it is `successful` or `failed`. Browse AI publishes no SDK; these calls follow the open-source
 * Pipedream and Activepieces integrations and must be confirmed with `sandbox:scrapers` before
 * the vendor is enabled. A site's settings carry `robotId` and `inputParameters` (the robot's
 * own parameter names, with `{{url}}` filled in). What comes back is what the robot captured:
 * each row of its lists, or its texts as one item. A trained robot is managed access to a site,
 * so it counts as the highest proxy class.
 */
export class BrowseAiScrapeProvider extends ScrapeProvider {
  readonly name: ScrapeVendor = 'browse_ai';
  readonly capabilities: ScrapeCapabilities = {
    render: true,
    proxyClasses: ['unblocker'],
    geo: false,
    structured: true,
  };
  private readonly fetchImpl: HttpFetch;

  constructor(private readonly options: BrowseAiOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async run(request: ScrapeRequest, signal: AbortSignal): Promise<ScrapePage> {
    const { settings } = request;
    const robotId = typeof settings.robotId === 'string' ? settings.robotId : '';
    if (!ROBOT_ID.test(robotId) || !isRecord(settings.inputParameters)) {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'robot settings missing' });
    }
    const created = await vendorCall(this.fetchImpl, this.name, `${API}/robots/${robotId}/tasks`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        inputParameters: fillTemplate(settings.inputParameters, request),
      }),
      signal,
    });
    assertVendorOk(this.name, created);
    let task = this.taskOf(created.text);
    const deadline = Date.now() + request.timeoutMs;
    while (task.status !== 'successful' && task.status !== 'failed') {
      if (Date.now() + (this.options.pollMs ?? POLL_MS) >= deadline) {
        throw new ScrapeError(this.name, 'timeout', { reason: 'task still running' });
      }
      await pause(this.name, this.options.pollMs ?? POLL_MS, signal);
      const polled = await vendorCall(
        this.fetchImpl,
        this.name,
        `${API}/robots/${robotId}/tasks/${task.id}`,
        { method: 'GET', headers: this.headers(), signal },
      );
      assertVendorOk(this.name, polled);
      task = this.taskOf(polled.text);
    }
    if (task.status === 'failed') {
      // A robot fails when the site did not let it through or the page changed under it.
      throw new ScrapeError(this.name, 'blocked', { reason: 'task failed' });
    }
    const rows = Object.values(task.lists)
      .flatMap((list) => (Array.isArray(list) ? list.filter(isRecord) : []))
      .slice(0, MAX_ITEMS);
    const items = rows.length > 0 ? rows : Object.keys(task.texts).length > 0 ? [task.texts] : [];
    return { html: null, items, httpStatus: null, rendered: true, costMicroUsd: null };
  }

  /** The key works: the account's robots can be listed. */
  async health(signal: AbortSignal): Promise<ScrapeHealth> {
    const response = await vendorCall(this.fetchImpl, this.name, `${API}/robots`, {
      method: 'GET',
      headers: this.headers(),
      signal,
    });
    return { ok: response.status === 200, remaining: null };
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

  private taskOf(text: string): {
    id: string;
    status: string;
    lists: Record<string, unknown>;
    texts: Record<string, unknown>;
  } {
    let body: unknown;
    try {
      // Captured fields can hold prices: numbers stay as their exact text.
      body = parseExactJson(text);
    } catch {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'answer is not JSON' });
    }
    const result = isRecord(body) && isRecord(body.result) ? body.result : null;
    if (!result || typeof result.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(result.id)) {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'no task in the answer' });
    }
    return {
      id: result.id,
      status: typeof result.status === 'string' ? result.status : 'in-progress',
      lists: isRecord(result.capturedLists) ? result.capturedLists : {},
      texts: isRecord(result.capturedTexts) ? result.capturedTexts : {},
    };
  }
}
