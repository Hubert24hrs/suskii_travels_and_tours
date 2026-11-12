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
  vendorCall,
  vendorJson,
  type HttpFetch,
} from './scrape-http';

const API = 'https://api.apify.com/v2';
/** Apify holds a request open for at most this long while a run finishes. */
const WAIT_SECONDS = 60;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}(?:[~/][A-Za-z0-9][A-Za-z0-9._-]{0,62})?$/;
const FINISHED = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
const MAX_ITEMS = 50;

export interface ApifyOptions {
  token: string;
  costs: ScrapeCosts['apify'];
  fetch?: HttpFetch;
  /** The clock the attempt's deadline is kept by; tests fix it, production reads the system's. */
  now?: () => number;
}

/**
 * Apify (bearer token). Shapes follow its official client (`apify-client` 2.26.0 on npm): a run
 * is started with the actor's input (`POST /acts/{actor}/runs`), waited for
 * (`GET /actor-runs/{id}?waitForFinish=`), and its items are read from the run's dataset. What
 * an actor takes as input is the actor's own business, so a site's settings carry it:
 *
 * - `actorId`: `user~actor`.
 * - `input`: the actor's input, with `{{url}}`, `{{country}}`, `{{locale}}` and `{{render}}`
 *   filled in.
 * - `proxyInputs`: per proxy class, what to merge into the input to use that class (the actor's
 *   proxy settings). A class without an entry is not used, except the lowest.
 * - `htmlField`: the item field that holds the page, when the actor returns pages; without it
 *   the items themselves are the result.
 *
 * A run that outlives the attempt is aborted, so nothing keeps running unpaid for.
 */
export class ApifyScrapeProvider extends ScrapeProvider {
  readonly name: ScrapeVendor = 'apify';
  readonly capabilities: ScrapeCapabilities = {
    render: true,
    proxyClasses: ['datacenter', 'residential'],
    geo: true,
    structured: true,
  };
  private readonly fetchImpl: HttpFetch;
  private readonly now: () => number;

  constructor(private readonly options: ApifyOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async run(request: ScrapeRequest, signal: AbortSignal): Promise<ScrapePage> {
    const { settings } = request;
    const actorId = typeof settings.actorId === 'string' ? settings.actorId : '';
    if (!ACTOR_ID.test(actorId) || !isRecord(settings.input)) {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'actor settings missing' });
    }
    const proxyInputs = isRecord(settings.proxyInputs) ? settings.proxyInputs : {};
    const proxyInput = proxyInputs[request.proxyClass];
    if (!isRecord(proxyInput) && request.proxyClass !== 'datacenter') {
      throw new ScrapeError(this.name, 'provider_error', {
        reason: 'no input for the proxy class',
      });
    }
    const input = fillTemplate(
      { ...settings.input, ...(isRecord(proxyInput) ? proxyInput : {}) },
      request,
    );
    const timeoutSeconds = Math.max(5, Math.floor(request.timeoutMs / 1000));
    const started = await vendorCall(
      this.fetchImpl,
      this.name,
      `${API}/acts/${actorId.replace('/', '~')}/runs?waitForFinish=${Math.min(
        WAIT_SECONDS,
        timeoutSeconds,
      )}&timeout=${timeoutSeconds}`,
      { method: 'POST', headers: this.headers(), body: JSON.stringify(input), signal },
    );
    assertVendorOk(this.name, started);
    let run = this.runOf(vendorJson(this.name, started.text));
    try {
      const deadline = this.now() + request.timeoutMs;
      while (!FINISHED.has(run.status)) {
        const left = Math.floor((deadline - this.now()) / 1000);
        if (left <= 0) throw new ScrapeError(this.name, 'timeout', { reason: 'run still going' });
        const polled = await vendorCall(
          this.fetchImpl,
          this.name,
          `${API}/actor-runs/${run.id}?waitForFinish=${Math.min(WAIT_SECONDS, left)}`,
          { method: 'GET', headers: this.headers(), signal },
        );
        assertVendorOk(this.name, polled);
        run = this.runOf(vendorJson(this.name, polled.text));
      }
    } catch (error) {
      await this.abort(run.id);
      throw error;
    }
    if (run.status === 'TIMED-OUT') {
      throw new ScrapeError(this.name, 'timeout', { reason: 'run timed out' });
    }
    if (run.status !== 'SUCCEEDED' || !run.datasetId) {
      throw new ScrapeError(this.name, 'provider_error', { reason: `run ${run.status}` });
    }

    const dataset = await vendorCall(
      this.fetchImpl,
      this.name,
      `${API}/datasets/${run.datasetId}/items?clean=true&limit=${MAX_ITEMS}`,
      { method: 'GET', headers: this.headers(), signal },
    );
    assertVendorOk(this.name, dataset);
    let rows: unknown;
    try {
      // Items can hold prices: numbers stay as their exact text.
      rows = parseExactJson(dataset.text);
    } catch {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'items are not JSON' });
    }
    const items = Array.isArray(rows) ? rows.filter(isRecord) : [];
    const htmlField = typeof settings.htmlField === 'string' ? settings.htmlField : null;
    const html = htmlField ? items[0]?.[htmlField] : undefined;
    return {
      html: typeof html === 'string' ? html : null,
      items: typeof html === 'string' ? null : items,
      httpStatus: null,
      rendered: request.render,
      costMicroUsd: run.usageUsd === null ? null : Math.round(run.usageUsd * 1_000_000),
    };
  }

  /** The token works; what is left of the month's usage limit, in micro-dollars. */
  async health(signal: AbortSignal): Promise<ScrapeHealth> {
    const response = await vendorCall(this.fetchImpl, this.name, `${API}/users/me/limits`, {
      method: 'GET',
      headers: this.headers(),
      signal,
    });
    if (response.status !== 200) return { ok: false, remaining: null };
    const body = vendorJson(this.name, response.text);
    const data = isRecord(body) && isRecord(body.data) ? body.data : {};
    const limit = isRecord(data.limits) ? Number(data.limits.maxMonthlyUsageUsd) : NaN;
    const used = isRecord(data.current) ? Number(data.current.monthlyUsageUsd) : NaN;
    return {
      ok: true,
      remaining:
        Number.isFinite(limit) && Number.isFinite(used)
          ? Math.max(0, Math.round((limit - used) * 1_000_000))
          : null,
    };
  }

  estimateCostMicroUsd(_request: ScrapeRequest, proxyClass: ProxyClass): number {
    return this.options.costs[proxyClass] ?? 0;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.token}`,
      'content-type': 'application/json',
    };
  }

  private runOf(body: unknown): {
    id: string;
    status: string;
    datasetId: string | null;
    usageUsd: number | null;
  } {
    const data = isRecord(body) && isRecord(body.data) ? body.data : null;
    if (!data || typeof data.id !== 'string' || !/^[A-Za-z0-9]{6,40}$/.test(data.id)) {
      throw new ScrapeError(this.name, 'provider_error', { reason: 'no run in the answer' });
    }
    return {
      id: data.id,
      status: typeof data.status === 'string' ? data.status : 'UNKNOWN',
      datasetId:
        typeof data.defaultDatasetId === 'string' &&
        /^[A-Za-z0-9]{6,40}$/.test(data.defaultDatasetId)
          ? data.defaultDatasetId
          : null,
      usageUsd: typeof data.usageTotalUsd === 'number' ? data.usageTotalUsd : null,
    };
  }

  /** Best effort, with a signal of its own: the attempt's signal has usually fired by now. */
  private async abort(runId: string): Promise<void> {
    await vendorCall(this.fetchImpl, this.name, `${API}/actor-runs/${runId}/abort`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }
}
