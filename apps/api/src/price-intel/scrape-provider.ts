import type { PriceProduct, ProxyClass, ScrapeFailureClass, ScrapeVendor } from '@suskii/shared';

/** What a vendor is asked to fetch. Built by the API from a site's policy, never by a model. */
export interface ScrapeRequest {
  /** An https address on the policy's domain (checked before any vendor is called). */
  url: string;
  product: PriceProduct;
  /** The site's domain, for throttles, breakers and budgets. */
  domain: string;
  /** The market the proxy should exit in (ISO 3166-1 alpha-2) and the page language. */
  country: string;
  locale: string;
  proxyClass: ProxyClass;
  /** Ask for a rendered page (JavaScript run) rather than the first response. */
  render: boolean;
  timeoutMs: number;
  /** What the site's `vendorSettings` hold for this vendor (an actor and its input, a robot). */
  settings: Readonly<Record<string, unknown>>;
}

/** What came back: a page, or the fields a vendor extracted itself. Untrusted either way. */
export interface ScrapePage {
  html: string | null;
  /** Structured items from a vendor that extracts (a robot's captured fields, an actor's items). */
  items: Record<string, unknown>[] | null;
  /** The site's own HTTP status, when the vendor reports it. */
  httpStatus: number | null;
  rendered: boolean;
  /** What the vendor says the call cost, in micro-dollars; null when it does not say. */
  costMicroUsd: number | null;
}

export interface ScrapeCapabilities {
  /** Can run a page's JavaScript. */
  render: boolean;
  /** The proxy classes it offers, in the shared order. */
  proxyClasses: readonly ProxyClass[];
  /** Can exit in a chosen country. */
  geo: boolean;
  /** Returns extracted fields instead of (or beside) a page. */
  structured: boolean;
}

export interface ScrapeHealth {
  ok: boolean;
  /** Credits or budget left, when the vendor has an endpoint that says. */
  remaining: number | null;
}

/**
 * One way to fetch a page (ADR-102). Adapters keep the vendor's types to themselves, honour the
 * abort signal, throw `ScrapeError` with a failure class for everything that goes wrong, and
 * never retry on their own: the router decides what happens next.
 */
export abstract class ScrapeProvider {
  abstract readonly name: ScrapeVendor;
  abstract readonly capabilities: ScrapeCapabilities;
  abstract run(request: ScrapeRequest, signal: AbortSignal): Promise<ScrapePage>;
  /** A call that fetches no page: the key works and the account can spend. */
  abstract health(signal: AbortSignal): Promise<ScrapeHealth>;
  /** The estimated cost of `request` at `proxyClass`, in micro-dollars. */
  abstract estimateCostMicroUsd(request: ScrapeRequest, proxyClass: ProxyClass): number;
}

/** A classified failure. The message never holds a key, a page or a query. */
export class ScrapeError extends Error {
  constructor(
    readonly vendor: ScrapeVendor,
    readonly failure: ScrapeFailureClass,
    readonly detail: { httpStatus?: number; retryAfterMs?: number; reason?: string } = {},
  ) {
    super(`${vendor}: ${failure}${detail.reason ? ` (${detail.reason})` : ''}`);
    this.name = 'ScrapeError';
  }
}

export interface AttemptRecord {
  vendor: ScrapeVendor;
  proxyClass: ProxyClass;
  outcome: 'ok' | ScrapeFailureClass;
  httpStatus: number | null;
  rendered: boolean;
  durationMs: number;
  costMicroUsd: number;
}

/**
 * Every vendor the policy allows was tried, or a limit was reached, and no price came back. The
 * caller serves a cached price labelled stale or hands over to an assisted quote (ADR-104).
 */
export class ScrapeExhausted extends Error {
  constructor(
    readonly failure: ScrapeFailureClass,
    readonly attempts: readonly AttemptRecord[],
    readonly reason: string,
  ) {
    super(`price intelligence exhausted: ${failure} (${reason})`);
    this.name = 'ScrapeExhausted';
  }
}

/** The HTTP statuses that mean the site (not the vendor) refused the request. */
export const BLOCKED_STATUSES: ReadonlySet<number> = new Set([401, 403, 407, 429, 451, 503]);

/** Words on a page that is a challenge or a refusal instead of content. Matched on a small page. */
const CHALLENGE_MARKS = [
  /captcha/i,
  /access denied/i,
  /verify (?:that )?you are (?:a )?human/i,
  /unusual traffic/i,
  /are you a robot/i,
  /request blocked/i,
  /attention required/i,
  /checking your browser/i,
];
/** A real results page is far longer than a challenge page. */
const CHALLENGE_MAX_LENGTH = 20_000;
/** Below this a page has no content worth parsing. */
const EMPTY_PAGE_LENGTH = 512;

/**
 * Says what is wrong with a page before any price is looked for: the site refused, or the page
 * is an empty shell that needs rendering. Null when it looks like content.
 */
export function pageProblem(
  page: ScrapePage,
): Extract<ScrapeFailureClass, 'blocked' | 'empty_or_unrendered'> | null {
  if (page.httpStatus !== null && BLOCKED_STATUSES.has(page.httpStatus)) return 'blocked';
  if (page.items !== null) return page.items.length === 0 ? 'empty_or_unrendered' : null;
  const html = page.html ?? '';
  if (html.length <= CHALLENGE_MAX_LENGTH && CHALLENGE_MARKS.some((mark) => mark.test(html))) {
    return 'blocked';
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Structured data inside scripts counts as content even when the visible text is thin.
  const structured = /<script[^>]+application\/ld\+json/i.test(html);
  if (!structured && (html.length < EMPTY_PAGE_LENGTH || text.length < 80)) {
    return 'empty_or_unrendered';
  }
  return null;
}
