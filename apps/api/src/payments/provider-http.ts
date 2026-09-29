import { Logger } from '@nestjs/common';

import { PaymentProviderRequestError, PaymentProviderUnavailableError } from './payment-provider';

export interface ProviderHttpOptions {
  provider: string;
  baseUrl: string;
  secretKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface ProviderRequest {
  method: 'GET' | 'POST';
  path: string;
  /** JSON body, or a form (Stripe) when `form` is true. */
  body?: Record<string, unknown> | URLSearchParams;
  idempotencyKey?: string;
}

/**
 * Minimal HTTP client for payment providers: bearer auth, JSON or form bodies, timeouts, and
 * errors mapped to `PaymentProviderError`. Bodies and keys never reach logs; the provider's
 * request id and status do, for support.
 */
export class ProviderHttp {
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ProviderHttpOptions) {
    this.logger = new Logger(`${options.provider}-http`);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async request<T = unknown>(request: ProviderRequest): Promise<T> {
    const { provider } = this.options;
    const form = request.body instanceof URLSearchParams;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.secretKey}`,
      Accept: 'application/json',
    };
    if (request.body)
      headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
    if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}${request.path}`, {
        method: request.method,
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs),
        ...(request.body
          ? {
              body:
                request.body instanceof URLSearchParams
                  ? request.body.toString()
                  : JSON.stringify(request.body),
            }
          : {}),
      });
    } catch (error) {
      throw new PaymentProviderUnavailableError(provider, `${provider} could not be reached`, {
        cause: error,
      });
    }

    const requestId =
      response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? undefined;
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok || response.status >= 500)
        throw new PaymentProviderUnavailableError(
          provider,
          `${provider} returned invalid JSON (HTTP ${response.status})`,
        );
    }
    if (response.ok) return payload as T;

    this.logger.warn(
      { status: response.status, requestId, path: request.path.split('?')[0] },
      'payment provider request failed',
    );
    if (response.status === 429 || response.status >= 500) {
      throw new PaymentProviderUnavailableError(
        provider,
        `${provider} responded ${response.status}`,
      );
    }
    throw new PaymentProviderRequestError(
      provider,
      `${provider} rejected the request (${response.status})`,
    );
  }
}
