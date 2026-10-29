import { FxProvider, type FxSnapshot } from './fx';

/** A rate the provider refused to give or that could not be read; `code` is safe to log. */
export class FxProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
  ) {
    super(`Exchange rates unavailable: ${provider} ${code}`);
    this.name = 'FxProviderError';
  }
}

const DECIMAL = /^\d{1,12}(\.\d{1,18})?$/;

/**
 * Parses a provider's JSON keeping every number as its exact source text (rates are decimal
 * strings, never floats: ADR-008). Node 24 hands the reviver each value's source; a runtime
 * without it falls back to the shortest round-trip form, which is the same for these values.
 */
export function parseExactJson(text: string): unknown {
  const reviver = (_key: string, value: unknown, context?: { source?: string }): unknown =>
    typeof value === 'number' ? (context?.source ?? String(value)) : value;
  return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]);
}

export interface OpenExchangeRatesOptions {
  /** https://openexchangerates.org/api */
  baseUrl: string;
  appId: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/**
 * Open Exchange Rates: `GET /latest.json` against the US dollar (every plan), hourly or faster
 * depending on the plan. The app id travels as the documented `app_id` query parameter, so the
 * URL is never logged or put in an error; errors keep the provider's short `message` code only.
 */
export class OpenExchangeRatesProvider extends FxProvider {
  readonly name = 'openexchangerates';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenExchangeRatesOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async latest(signal?: AbortSignal): Promise<FxSnapshot> {
    const url = new URL(`${this.options.baseUrl.replace(/\/$/, '')}/latest.json`);
    url.searchParams.set('app_id', this.options.appId);
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw new FxProviderError(
        this.name,
        (error as Error).name === 'TimeoutError' ? 'timeout' : 'network',
      );
    }
    const text = await response.text().catch(() => '');
    let body: unknown = null;
    try {
      body = text ? parseExactJson(text) : null;
    } catch {
      throw new FxProviderError(this.name, `invalid-json-${response.status}`);
    }
    if (!response.ok) {
      const message = (body as { message?: unknown } | null)?.message;
      throw new FxProviderError(
        this.name,
        typeof message === 'string' && /^[a-z_]{1,40}$/.test(message)
          ? message
          : `http-${response.status}`,
      );
    }
    return snapshotFrom(this.name, body);
  }
}

/** The snapshot in an Open Exchange Rates answer; unreadable rates are left out, never guessed. */
export function snapshotFrom(provider: string, body: unknown): FxSnapshot {
  const answer = body as { base?: unknown; timestamp?: unknown; rates?: unknown } | null;
  const base = typeof answer?.base === 'string' ? answer.base : null;
  const timestamp = Number(answer?.timestamp);
  if (!base || !/^[A-Z]{3}$/.test(base) || !Number.isSafeInteger(timestamp) || timestamp <= 0)
    throw new FxProviderError(provider, 'unexpected-answer');
  const rates: Record<string, string> = {};
  if (answer?.rates && typeof answer.rates === 'object') {
    for (const [currency, rate] of Object.entries(answer.rates as Record<string, unknown>)) {
      if (/^[A-Z]{3}$/.test(currency) && typeof rate === 'string' && DECIMAL.test(rate)) {
        if (!/^0+(\.0+)?$/.test(rate)) rates[currency] = rate;
      }
    }
  }
  rates[base] = '1';
  if (Object.keys(rates).length < 2) throw new FxProviderError(provider, 'no-rates');
  return { base, rates, asOf: new Date(timestamp * 1000).toISOString(), provider };
}

/**
 * The provider's rates with some fixed by the owner (`FX_RATE_OVERRIDES`, per US dollar), for
 * example the bank's settlement rate for the naira (ADR-008, ADR-091). Both adapters quote
 * against the dollar; a snapshot on another base is refused rather than mixed.
 */
export class OverriddenFxProvider extends FxProvider {
  readonly name: string;

  constructor(
    private readonly inner: FxProvider,
    private readonly overrides: Readonly<Record<string, string>>,
  ) {
    super();
    this.name = `${inner.name}+fixed`;
  }

  async latest(signal?: AbortSignal): Promise<FxSnapshot> {
    const snapshot = await this.inner.latest(signal);
    if (snapshot.base !== 'USD') throw new FxProviderError(this.name, 'overrides-need-usd-base');
    return {
      ...snapshot,
      rates: { ...snapshot.rates, ...this.overrides, USD: '1' },
      provider: this.name,
    };
  }
}
