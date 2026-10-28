import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';

import {
  OfferUnavailableError,
  SupplierRequestError,
  SupplierTimeoutError,
  SupplierUnavailableError,
} from '../supplier.errors';

import { expediaErrorSchema } from './expedia.schemas';

const SUPPLIER = 'expedia';

export interface ExpediaClientOptions {
  /** `https://test.ean.com` (sandbox) or `https://api.ean.com`. */
  baseUrl: string;
  apiKey: string;
  sharedSecret: string;
  fetch?: typeof fetch;
  /** Seconds since the epoch; tests fix it to check the signature. */
  now?: () => number;
}

export interface ExpediaRequest {
  method: 'GET' | 'POST';
  /** A path with its query (`/v3/properties/availability?...`) or a link's `href`. */
  path: string;
  signal: AbortSignal;
  body?: unknown;
  /** Ties a shopping session or a booking together in Expedia's logs: an id, never personal data. */
  sessionId: string;
  /** The traveller's IP: required by Rapid on booking calls, optional elsewhere. */
  customerIp?: string | null;
  /** Rapid's canned test answers (`standard`, `sold_out`, ...), for the sandbox script only. */
  test?: string;
}

/** SHA-512 hex of key, shared secret and the Unix time in seconds (Rapid's signature). */
export function expediaSignature(apiKey: string, secret: string, unixSeconds: number): string {
  return createHash('sha512').update(`${apiKey}${secret}${unixSeconds}`).digest('hex');
}

/** The Authorization header value Rapid expects. */
export function expediaAuthorization(apiKey: string, secret: string, unixSeconds: number): string {
  return `EAN APIKey=${apiKey},Signature=${expediaSignature(apiKey, secret, unixSeconds)},timestamp=${unixSeconds}`;
}

/**
 * Minimal Expedia Rapid client (ADR-086): signed requests, JSON, Rapid's session and customer
 * headers, and errors mapped to our supplier errors. Links from Rapid answers (price check,
 * book) carry a token and are followed only on the configured host. The key, secret and link
 * tokens never appear in logs or errors.
 */
export class ExpediaClient {
  private readonly logger = new Logger(ExpediaClient.name);
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly origin: string;

  constructor(private readonly options: ExpediaClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.origin = new URL(options.baseUrl).origin;
  }

  /** The absolute URL for a path or a link, refusing links to any other host. */
  url(path: string): string {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith('/v3/')) {
      throw new SupplierRequestError(SUPPLIER, 'Expedia returned a link outside its API');
    }
    return url.toString();
  }

  async request(request: ExpediaRequest): Promise<unknown> {
    const { apiKey, sharedSecret } = this.options;
    const url = this.url(request.path);
    const pathOnly = new URL(url).pathname;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: request.method,
        signal: request.signal,
        // The API never redirects; following one could send the signed header elsewhere.
        redirect: 'error',
        headers: {
          Authorization: expediaAuthorization(apiKey, sharedSecret, this.now()),
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'Customer-Session-Id': request.sessionId,
          ...(request.customerIp ? { 'Customer-Ip': request.customerIp } : {}),
          ...(request.test ? { Test: request.test } : {}),
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'AbortError' || name === 'TimeoutError' || request.signal.aborted) {
        throw new SupplierTimeoutError(SUPPLIER, 'Expedia request was aborted', { cause: error });
      }
      throw new SupplierUnavailableError(SUPPLIER, 'Expedia is unreachable', { cause: error });
    }

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok) {
        throw new SupplierUnavailableError(
          SUPPLIER,
          `Expedia returned invalid JSON (HTTP ${response.status})`,
        );
      }
    }
    if (response.ok) return payload;

    const parsed = expediaErrorSchema.safeParse(payload);
    const type = parsed.success ? parsed.data.type : undefined;
    this.logger.warn({ status: response.status, type, path: pathOnly }, 'Expedia request failed');
    if (response.status === 401 || response.status === 403) {
      throw new SupplierRequestError(
        SUPPLIER,
        `Expedia refused the credentials (${response.status})`,
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SupplierUnavailableError(
        SUPPLIER,
        `Expedia responded ${response.status}${type ? ` (${type})` : ''}`,
      );
    }
    // A link that expired, a rate that sold or moved: the traveller must choose again.
    if (response.status === 404 || response.status === 409 || response.status === 410) {
      throw new OfferUnavailableError(SUPPLIER, 'The rate is no longer available');
    }
    throw new SupplierRequestError(
      SUPPLIER,
      `Expedia rejected the request (${response.status}${type ? `, ${type}` : ''})`,
    );
  }
}
