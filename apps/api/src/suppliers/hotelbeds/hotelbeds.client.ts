import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';

import {
  OfferUnavailableError,
  SupplierRequestError,
  SupplierTimeoutError,
  SupplierUnavailableError,
} from '../supplier.errors';

import { hotelbedsErrorSchema } from './hotelbeds.schemas';

const SUPPLIER = 'hotelbeds';
/** Messages in Hotelbeds errors that mean the rate is gone: the traveller must search again. */
const RATE_GONE = /allotment|no longer available|not available|sold out|rate.*(changed|expired)/i;

export interface HotelbedsClientOptions {
  baseUrl: string;
  apiKey: string;
  secret: string;
  fetch?: typeof fetch;
  /** Seconds since the epoch; tests fix it to check the signature. */
  now?: () => number;
}

/** SHA-256 hex of key, secret and the Unix time in seconds (Hotelbeds `X-Signature`). */
export function hotelbedsSignature(apiKey: string, secret: string, unixSeconds: number): string {
  return createHash('sha256').update(`${apiKey}${secret}${unixSeconds}`).digest('hex');
}

/**
 * Minimal Hotelbeds APItude client (ADR-071): signed headers, JSON, and error mapping to our
 * supplier errors. The key and secret never appear in logs or errors; Hotelbeds' audit token is
 * logged for support.
 */
export class HotelbedsClient {
  private readonly logger = new Logger(HotelbedsClient.name);
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: HotelbedsClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<unknown> {
    const { apiKey, secret } = this.options;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        signal,
        // The API never redirects; following one could send the signed headers elsewhere.
        redirect: 'error',
        headers: {
          'Api-key': apiKey,
          'X-Signature': hotelbedsSignature(apiKey, secret, this.now()),
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'AbortError' || name === 'TimeoutError' || signal.aborted) {
        throw new SupplierTimeoutError(SUPPLIER, 'Hotelbeds request was aborted', { cause: error });
      }
      throw new SupplierUnavailableError(SUPPLIER, 'Hotelbeds is unreachable', { cause: error });
    }

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // A gateway page: mapped by status below.
      if (response.ok) {
        throw new SupplierUnavailableError(
          SUPPLIER,
          `Hotelbeds returned invalid JSON (HTTP ${response.status})`,
        );
      }
    }
    const parsed = hotelbedsErrorSchema.safeParse(payload);
    const error = parsed.success ? parsed.data.error : undefined;
    // Hotelbeds can answer 200 with an error body; treat it as the failure it describes.
    if (response.ok && !error) return payload;

    const code = error?.code;
    const token = parsed.success ? parsed.data.auditData?.token : undefined;
    this.logger.warn(
      { status: response.status, code, token, path: path.split('?')[0] },
      'Hotelbeds request failed',
    );
    if (response.status === 401 || response.status === 403) {
      throw new SupplierRequestError(
        SUPPLIER,
        `Hotelbeds refused the credentials (${response.status})`,
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SupplierUnavailableError(
        SUPPLIER,
        `Hotelbeds responded ${response.status}${code ? ` (${code})` : ''}`,
      );
    }
    if (error?.message && RATE_GONE.test(error.message)) {
      throw new OfferUnavailableError(SUPPLIER, 'The rate is no longer available');
    }
    throw new SupplierRequestError(
      SUPPLIER,
      `Hotelbeds rejected the request (${response.status}${code ? `, ${code}` : ''})`,
    );
  }
}
