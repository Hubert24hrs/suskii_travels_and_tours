import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

import type { ProxyClass, ScrapeVendor } from '@suskii/shared';

import {
  ScrapeError,
  ScrapeProvider,
  type ScrapeCapabilities,
  type ScrapeHealth,
  type ScrapePage,
  type ScrapeRequest,
} from '../scrape-provider';
import { assertFetchable, FetchRefused, resolvePublic, type Resolver } from '../ssrf-guard';

import { parseRobots, robotsAllow, type RobotsRules } from './robots';

/** The name sites see and can address rules to in their robots file. */
export const BOT_TOKEN = 'SuskiiPriceBot';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ROBOTS_TTL_MS = 60 * 60 * 1000;
const ROBOTS_TIMEOUT_MS = 8000;

export interface DirectResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  body: string;
}

/** Fetches one https address without following redirects. */
export type DirectTransport = (
  url: URL,
  options: { userAgent: string; locale: string; timeoutMs: number; signal: AbortSignal },
) => Promise<DirectResponse>;

export interface DirectOptions {
  /** A public page saying who the fetcher is; part of its User-Agent. */
  botUrl: string | undefined;
  transport?: DirectTransport;
  now?: () => number;
}

/**
 * A lookup for the connection itself: the name is resolved once, refused when any answer is a
 * private address, and the socket connects to the address that was checked. Checking a name and
 * then letting the connection resolve it again would let the answer change in between.
 */
export function pinnedLookup(resolver?: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    resolvePublic(hostname, resolver).then(
      (answers) => {
        const first = answers[0];
        if (typeof options === 'object' && options.all) callback(null, answers);
        else if (first) callback(null, first.address, first.family);
        else callback(new FetchRefused('unresolvable'), '', 4);
      },
      (error: unknown) =>
        callback(error instanceof Error ? error : new FetchRefused('unresolvable'), '', 4),
    );
  };
}

/** The transport used outside tests: `node:https` with the pinned lookup and a body limit. */
export const httpsTransport: DirectTransport = (url, options) =>
  new Promise<DirectResponse>((resolve, reject) => {
    const request = httpsRequest(
      {
        host: url.hostname,
        servername: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        lookup: pinnedLookup(),
        signal: options.signal,
        timeout: options.timeoutMs,
        headers: {
          'user-agent': options.userAgent,
          accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5',
          'accept-language': options.locale,
          'accept-encoding': 'gzip, br, deflate',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('body too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') headers[name.toLowerCase()] = value;
          }
          try {
            const raw = Buffer.concat(chunks);
            const encoding = headers['content-encoding'];
            const limit = { maxOutputLength: MAX_BODY_BYTES };
            const decoded =
              encoding === 'gzip'
                ? gunzipSync(raw, limit)
                : encoding === 'br'
                  ? brotliDecompressSync(raw, limit)
                  : encoding === 'deflate'
                    ? inflateSync(raw, limit)
                    : raw;
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: decoded.toString('utf8'),
            });
          } catch (error) {
            reject(error instanceof Error ? error : new Error('body unreadable'));
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new DOMException('timed out', 'TimeoutError')));
    request.on('error', reject);
    request.end();
  });

/**
 * Our own plain request (ADR-102), for sites whose policy allows it. It says who it is in its
 * User-Agent, reads and obeys the site's robots file, passes the SSRF guard on the first address
 * and on every redirect, runs no script and sends no cookie. It has no proxy: a site that
 * refuses it is not approached another way by this fetcher.
 */
export class DirectScrapeProvider extends ScrapeProvider {
  readonly name: ScrapeVendor = 'direct';
  readonly capabilities: ScrapeCapabilities = {
    render: false,
    proxyClasses: ['none'],
    geo: false,
    structured: false,
  };
  private readonly transport: DirectTransport;
  private readonly now: () => number;
  private readonly robots = new Map<string, { at: number; rules: RobotsRules | 'closed' }>();

  constructor(private readonly options: DirectOptions) {
    super();
    this.transport = options.transport ?? httpsTransport;
    this.now = options.now ?? Date.now;
  }

  get userAgent(): string {
    return `${BOT_TOKEN}/1.0${this.options.botUrl ? ` (+${this.options.botUrl})` : ''}`;
  }

  async run(request: ScrapeRequest, signal: AbortSignal): Promise<ScrapePage> {
    let url = assertFetchable(request.url, request.domain);
    for (let hop = 0; ; hop += 1) {
      if (!(await this.allowedByRobots(url, request, signal))) {
        throw new ScrapeError(this.name, 'policy_denied', { reason: 'robots' });
      }
      const response = await this.get(url, request, request.timeoutMs, signal);
      const location = response.headers.location;
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) {
          throw new ScrapeError(this.name, 'provider_error', { reason: 'too many redirects' });
        }
        // A redirect is followed only to an address the guard would have accepted first.
        url = assertFetchable(new URL(location, url).toString(), request.domain);
        continue;
      }
      if (response.status === 429 || response.status === 403 || response.status === 503) {
        const retryAfter = Number(response.headers['retry-after']);
        throw new ScrapeError(this.name, 'blocked', {
          httpStatus: response.status,
          retryAfterMs:
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        });
      }
      return {
        html: response.body,
        items: null,
        httpStatus: response.status,
        rendered: false,
        costMicroUsd: 0,
      };
    }
  }

  health(): Promise<ScrapeHealth> {
    return Promise.resolve({ ok: true, remaining: null });
  }

  estimateCostMicroUsd(_request: ScrapeRequest, _proxyClass: ProxyClass): number {
    return 0;
  }

  private async get(
    url: URL,
    request: Pick<ScrapeRequest, 'locale'>,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<DirectResponse> {
    try {
      return await this.transport(url, {
        userAgent: this.userAgent,
        locale: request.locale,
        timeoutMs,
        signal,
      });
    } catch (error) {
      if (error instanceof FetchRefused || error instanceof ScrapeError) throw error;
      const name =
        typeof error === 'object' && error !== null && 'name' in error ? error.name : null;
      throw new ScrapeError(
        this.name,
        name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'provider_error',
        { reason: 'request failed' },
      );
    }
  }

  /**
   * The site's robots file, kept for an hour per host. No file (404) means no rule; a file that
   * cannot be fetched (5xx, an error) means the site is closed to us until it can be read.
   */
  private async allowedByRobots(
    url: URL,
    request: Pick<ScrapeRequest, 'locale'>,
    signal: AbortSignal,
  ): Promise<boolean> {
    const cached = this.robots.get(url.hostname);
    let rules = cached && this.now() - cached.at < ROBOTS_TTL_MS ? cached.rules : null;
    if (rules === null) {
      rules = 'closed';
      try {
        const response = await this.get(
          new URL('/robots.txt', url),
          request,
          ROBOTS_TIMEOUT_MS,
          signal,
        );
        if (response.status >= 200 && response.status < 300) {
          rules = parseRobots(response.body, BOT_TOKEN);
        } else if (response.status >= 400 && response.status < 500) {
          rules = { allow: [], disallow: [] };
        }
      } catch (error) {
        if (error instanceof FetchRefused) throw error;
      }
      this.robots.set(url.hostname, { at: this.now(), rules });
    }
    return rules !== 'closed' && robotsAllow(rules, `${url.pathname}${url.search}`);
  }
}
