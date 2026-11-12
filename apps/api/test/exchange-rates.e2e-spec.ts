import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { addDays } from '@suskii/shared';

import { FxProvider } from '../src/pricing/fx';
import { FxProviderError } from '../src/pricing/fx-providers';

import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Exchange rates from Open Exchange Rates with owner-fixed rates on top (ADR-091), through the
 * adapter the settings choose, against a fake rates server on this machine (no provider is ever
 * called). Prices converted by a search carry the provider's exact decimal text, the fixed naira
 * rate wins, and every way the provider can fail becomes a short, loggable code.
 */
type Answer = (request: IncomingMessage, response: ServerResponse) => void;

const today = new Date().toISOString().slice(0, 10);
const inDays = (days: number): string => addDays(today, days);
const json =
  (status: number, body: string): Answer =>
  (_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(body);
  };

/** Raw JSON, so the exact decimal text reaches the adapter as a provider would send it. */
const LATEST = `{
  "disclaimer": "Usage subject to terms",
  "timestamp": 1793232000,
  "base": "USD",
  "rates": {
    "GBP": 0.781234567890123456,
    "EUR": 0.92,
    "NGN": 1532.25,
    "KES": 129.5,
    "XAU": -1,
    "ZZZ": 0,
    "bad": 3
  }
}`;

describe('exchange rates from Open Exchange Rates (e2e)', () => {
  let ctx: TestContext;
  let server: Server;
  let answer: Answer = json(200, LATEST);
  const requests: URL[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(new URL(request.url ?? '/', 'http://127.0.0.1'));
      answer(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    ctx = await createTestApp({
      FX_PROVIDER: 'openexchangerates',
      OPENEXCHANGERATES_API_URL: `http://127.0.0.1:${port}/api/`,
      OPENEXCHANGERATES_APP_ID: 'e2e-app-id-0001',
      FX_TIMEOUT_MS: 1000,
      FX_RATE_OVERRIDES: { NGN: '1600.5' },
    });
  });
  beforeEach(async () => {
    await resetState(ctx);
    answer = json(200, LATEST);
    requests.length = 0;
  });
  afterAll(async () => {
    await ctx.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const latest = () => ctx.app.get(FxProvider).latest();
  const failure = async (): Promise<FxProviderError> => {
    const error = await latest().then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(FxProviderError);
    return error as FxProviderError;
  };

  it('prices a search with the exact provider rate and the fixed naira rate', async () => {
    const search = (currency: string) =>
      ctx
        .http()
        .post('/v1/flights/searches')
        .query({ currency })
        .send({
          slices: [
            { origin: 'LOS', destination: 'LHR', departureDate: inDays(40) },
            { origin: 'LHR', destination: 'LOS', departureDate: inDays(50) },
          ],
          passengers: { adults: 1, children: 0, infants: 0 },
          cabinClass: 'economy',
        })
        .expect(200);

    const pounds = (await search('GBP')).body.offers[0];
    expect(pounds.price.total.currency).toBe('GBP');
    expect(pounds.price.fx).toMatchObject({
      from: 'USD',
      to: 'GBP',
      // Shown to ten places; the conversion itself used the exact rate.
      rate: '0.7812345679',
      asOf: '2026-10-29T00:00:00.000Z',
      provider: 'openexchangerates+fixed',
    });

    const naira = (await search('NGN')).body.offers[0];
    expect(naira.price.total.currency).toBe('NGN');
    expect(naira.price.fx).toMatchObject({ from: 'USD', to: 'NGN', rate: '1600.5' });

    // One call to the provider, with the app id as the documented query parameter; the snapshot
    // is then shared through Redis.
    expect(requests.map((url) => [url.pathname, url.searchParams.get('app_id')])).toEqual([
      ['/api/latest.json', 'e2e-app-id-0001'],
    ]);
  });

  it('leaves out rates it cannot read instead of guessing them', async () => {
    const snapshot = await latest();
    expect(snapshot.rates).toEqual({
      USD: '1',
      GBP: '0.781234567890123456',
      EUR: '0.92',
      NGN: '1600.5',
      KES: '129.5',
    });
  });

  it("keeps the provider's short error code and nothing else", async () => {
    answer = json(401, '{"error":true,"status":401,"message":"invalid_app_id"}');
    const refused = await failure();
    expect(refused).toMatchObject({ provider: 'openexchangerates', code: 'invalid_app_id' });
    expect(refused.message).not.toContain('e2e-app-id-0001');

    answer = json(500, '{"message":"Something <b>long</b> and unexpected"}');
    expect((await failure()).code).toBe('http-500');

    answer = json(502, '');
    expect((await failure()).code).toBe('http-502');

    answer = json(200, '<html>maintenance</html>');
    expect((await failure()).code).toBe('invalid-json-200');
  });

  it('refuses answers without a base, a timestamp or any rate', async () => {
    answer = json(200, '{"base":"USD","rates":{"NGN":1532.25}}');
    expect((await failure()).code).toBe('unexpected-answer');

    answer = json(200, '{"timestamp":1793232000,"base":"USD","rates":{"NGN":-5}}');
    expect((await failure()).code).toBe('no-rates');
  });

  it('refuses to mix fixed dollar rates into a snapshot on another base', async () => {
    answer = json(200, '{"timestamp":1793232000,"base":"EUR","rates":{"NGN":1665.5}}');
    expect(await failure()).toMatchObject({
      provider: 'openexchangerates+fixed',
      code: 'overrides-need-usd-base',
    });
  });

  it('names a dropped connection and a slow provider', async () => {
    answer = (request) => {
      request.socket.destroy();
    };
    expect((await failure()).code).toBe('network');

    answer = (_request, response) => {
      setTimeout(() => {
        if (!response.destroyed) json(200, LATEST)(_request, response);
      }, 1500).unref();
    };
    expect((await failure()).code).toBe('timeout');
  });
});
