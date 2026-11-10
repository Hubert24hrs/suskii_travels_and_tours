import type { ScrapeFailureClass, ScrapeVendor } from '@suskii/shared';

import { ScrapeError } from '../scrape-provider';

export type HttpFetch = typeof fetch;

export interface VendorResponse {
  status: number;
  headers: Headers;
  text: string;
}

/** A vendor's answer is a page or a small document; anything larger is not read. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** `Retry-After` as milliseconds from now: seconds or an HTTP date; undefined when absent. */
export function retryAfterMs(headers: Headers, now = Date.now()): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * One call to a vendor's API. Redirects are an error (a vendor's API does not redirect, and a
 * key must never follow one), the body is read up to a limit, and every way the call can fail
 * becomes a `ScrapeError`: an abort or a timeout is `timeout`, anything else `provider_error`.
 * The message never holds the address, a header or the body.
 */
export async function vendorCall(
  fetchImpl: HttpFetch,
  vendor: ScrapeVendor,
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
): Promise<VendorResponse> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
      redirect: 'error',
    });
  } catch (error) {
    throw new ScrapeError(vendor, aborted(error) ? 'timeout' : 'provider_error', {
      reason: 'request failed',
    });
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_RESPONSE_BYTES) {
    throw new ScrapeError(vendor, 'provider_error', { reason: 'response too large' });
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new ScrapeError(vendor, aborted(error) ? 'timeout' : 'provider_error', {
      reason: 'response unreadable',
    });
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ScrapeError(vendor, 'provider_error', { reason: 'response too large' });
  }
  return { status: response.status, headers: response.headers, text };
}

const aborted = (error: unknown): boolean => {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : null;
  return name === 'AbortError' || name === 'TimeoutError';
};

/**
 * What a vendor's own HTTP status means, when its API (not the site) refused the call: out of
 * credits or over its rate is `quota_exhausted`; a late answer `timeout`; a bad key, a bad
 * request or a server fault is the vendor failing.
 */
export function vendorStatusFailure(status: number): ScrapeFailureClass | null {
  if (status >= 200 && status < 300) return null;
  if (status === 402 || status === 429) return 'quota_exhausted';
  if (status === 408 || status === 504) return 'timeout';
  return 'provider_error';
}

/** Throws the `ScrapeError` a vendor's refusal means; returns when the status is a success. */
export function assertVendorOk(vendor: ScrapeVendor, response: VendorResponse): void {
  const failure = vendorStatusFailure(response.status);
  if (failure === null) return;
  throw new ScrapeError(vendor, failure, {
    retryAfterMs: retryAfterMs(response.headers),
    reason:
      response.status === 401 || response.status === 403
        ? 'credentials refused'
        : `vendor status ${response.status}`,
  });
}

/** JSON from a vendor, or `provider_error` when it is not JSON. */
export function vendorJson(vendor: ScrapeVendor, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ScrapeError(vendor, 'provider_error', { reason: 'answer is not JSON' });
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fills `{{url}}`, `{{country}}`, `{{locale}}` and `{{render}}` in a settings template (an
 * actor's input, a robot's parameters). Only whole string values and substrings are replaced:
 * keys and structure stay as the owner wrote them.
 */
export function fillTemplate(
  template: unknown,
  values: { url: string; country: string; locale: string; render: boolean },
): unknown {
  if (typeof template === 'string') {
    if (template === '{{render}}') return values.render;
    return template
      .replaceAll('{{url}}', values.url)
      .replaceAll('{{country}}', values.country)
      .replaceAll('{{locale}}', values.locale);
  }
  if (Array.isArray(template)) return template.map((entry) => fillTemplate(entry, values));
  if (isRecord(template)) {
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [key, fillTemplate(value, values)]),
    );
  }
  return template;
}

/** Waits `ms`, or rejects with a `timeout` when the call is aborted first. */
export function pause(vendor: ScrapeVendor, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (): void => reject(new ScrapeError(vendor, 'timeout', { reason: 'aborted' }));
    if (signal.aborted) {
      fail();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = (): void => {
      clearTimeout(timer);
      fail();
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
