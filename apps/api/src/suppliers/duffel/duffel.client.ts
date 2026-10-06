import { Logger } from '@nestjs/common';

import {
  OfferUnavailableError,
  SupplierRequestError,
  SupplierTimeoutError,
  SupplierUnavailableError,
} from '../supplier.errors';

import { duffelErrorSchema } from './duffel.schemas';

const SUPPLIER = 'duffel';
/** Duffel error codes that mean "this offer is gone": the customer must search again. */
const OFFER_GONE = new Set(['offer_no_longer_available', 'offer_expired', 'not_found']);

export interface DuffelClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

/**
 * Minimal Duffel HTTP client: auth and version headers, JSON, and error mapping to our supplier
 * errors. The token never appears in logs or errors; Duffel's request id is logged for support.
 */
export class DuffelClient {
  private readonly logger = new Logger(DuffelClient.name);
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DuffelClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        signal,
        // The supplier API never redirects; following one could leak the token elsewhere.
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          'Duffel-Version': 'v2',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'AbortError' || name === 'TimeoutError' || signal.aborted) {
        throw new SupplierTimeoutError(SUPPLIER, 'Duffel request was aborted', { cause: error });
      }
      throw new SupplierUnavailableError(SUPPLIER, 'Duffel is unreachable', { cause: error });
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new SupplierUnavailableError(
        SUPPLIER,
        `Duffel returned invalid JSON (HTTP ${response.status})`,
      );
    }
    if (response.ok) return payload;

    const parsed = duffelErrorSchema.safeParse(payload);
    const code = parsed.success ? (parsed.data.errors[0]?.code ?? undefined) : undefined;
    this.logger.warn(
      { status: response.status, code, requestId, path: path.split('?')[0] },
      'Duffel request failed',
    );
    if (code && OFFER_GONE.has(code)) {
      throw new OfferUnavailableError(SUPPLIER, 'The offer is no longer available');
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SupplierUnavailableError(
        SUPPLIER,
        `Duffel responded ${response.status}${code ? ` (${code})` : ''}`,
      );
    }
    throw new SupplierRequestError(
      SUPPLIER,
      `Duffel rejected the request (${response.status}${code ? `, ${code}` : ''})`,
    );
  }
}
