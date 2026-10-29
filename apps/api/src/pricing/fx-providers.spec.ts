import { createConverter } from './fx.service';
import { MockFxProvider } from './fx';
import {
  FxProviderError,
  OpenExchangeRatesProvider,
  OverriddenFxProvider,
  parseExactJson,
  snapshotFrom,
} from './fx-providers';

/** Exchange-rate adapters (ADR-091) against recorded answers; no test reaches a provider. */

const answer = `{
  "disclaimer": "Usage subject to terms: https://openexchangerates.org/terms",
  "license": "https://openexchangerates.org/license",
  "timestamp": 1761652800,
  "base": "USD",
  "rates": {
    "AED": 3.6725,
    "BTC": 0.000009012345678912,
    "GBP": 0.746612,
    "GHS": 10.950000,
    "KES": 129.2,
    "NGN": 1463.123456789012,
    "USD": 1,
    "XOF": 563.54912,
    "ZZZ": -1
  }
}`;

/** The error a failed read throws (the test fails if it resolves). */
async function failure(promise: Promise<unknown>): Promise<FxProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FxProviderError) return error;
    throw error;
  }
  throw new Error('expected the read to fail');
}

function fake(status: number, body: string, urls: string[] = []): typeof fetch {
  return ((url: string | URL) => {
    urls.push(String(url));
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
}

const provider = (fetchImpl: typeof fetch) =>
  new OpenExchangeRatesProvider({
    baseUrl: 'https://openexchangerates.org/api/',
    appId: 'oxr-app-id-0123456789',
    timeoutMs: 5000,
    fetch: fetchImpl,
  });

describe('OpenExchangeRatesProvider', () => {
  it('keeps every rate as its exact decimal text, never a float', async () => {
    const urls: string[] = [];
    const snapshot = await provider(fake(200, answer, urls)).latest();
    expect(urls[0]).toBe(
      'https://openexchangerates.org/api/latest.json?app_id=oxr-app-id-0123456789',
    );
    expect(snapshot).toMatchObject({
      base: 'USD',
      asOf: '2025-10-28T12:00:00.000Z',
      provider: 'openexchangerates',
    });
    // More digits than a double holds survive untouched; trailing zeros are kept as sent.
    expect(snapshot.rates.NGN).toBe('1463.123456789012');
    expect(snapshot.rates.GHS).toBe('10.950000');
    expect(snapshot.rates.USD).toBe('1');
    // A negative or malformed rate is left out, never guessed.
    expect(snapshot.rates).not.toHaveProperty('ZZZ');
    const converter = createConverter(snapshot);
    expect(converter.convert({ minor: 100_00n, currency: 'USD' }, 'NGN')).toEqual({
      minor: 146_312_35n,
      currency: 'NGN',
    });
  });

  it('reports the provider short code and never the app id', async () => {
    const refused = await failure(
      provider(
        fake(
          401,
          '{"error":true,"status":401,"message":"invalid_app_id","description":"Invalid App ID provided"}',
        ),
      ).latest(),
    );
    expect(refused).toBeInstanceOf(FxProviderError);
    expect(refused.code).toBe('invalid_app_id');
    expect(refused.message).not.toContain('oxr-app-id');
    const html = await failure(provider(fake(502, '<html>bad gateway</html>')).latest());
    expect(html.code).toBe('invalid-json-502');
    const timeout: typeof fetch = () =>
      Promise.reject(Object.assign(new Error('x'), { name: 'TimeoutError' }));
    const dead = await failure(provider(timeout).latest());
    expect(dead.code).toBe('timeout');
  });

  it('refuses answers without a base, a time or any usable rate', () => {
    expect(() => snapshotFrom('oxr', { rates: { NGN: '1500' } })).toThrow(FxProviderError);
    expect(() => snapshotFrom('oxr', { base: 'USD', timestamp: 1, rates: {} })).toThrow(/no-rates/);
    expect(parseExactJson('{"a":1.10,"b":[2.50]}')).toEqual({ a: '1.10', b: ['2.50'] });
  });
});

describe('OverriddenFxProvider', () => {
  it('pins the owner rates over the source and names both in the snapshot', async () => {
    const fixed = new OverriddenFxProvider(new MockFxProvider(), { NGN: '1600.5' });
    const snapshot = await fixed.latest();
    expect(snapshot.provider).toBe('mock+fixed');
    expect(snapshot.rates.NGN).toBe('1600.5');
    expect(snapshot.rates.GBP).toBe('0.79');
    expect(createConverter(snapshot).convert({ minor: 10_00n, currency: 'USD' }, 'NGN').minor).toBe(
      16_005_00n,
    );
  });
});
