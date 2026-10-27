import { preferences } from './cache';
import { discoverHostedServer, parseHostedServer } from './hosted-server';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const URL = 'https://github.com/o/r/releases/download/test-server/test-server.json';
const RUNNING = {
  version: 1,
  status: 'running',
  api: 'https://calm-river.trycloudflare.com',
  web: 'https://calm-river.trycloudflare.com',
  startedAt: '2026-10-27T09:00:00Z',
  expiresAt: '2026-10-27T14:00:00Z',
  commit: 'abc1234',
  run: 1,
};

const answer = (status: number, body: unknown = {}) =>
  jest.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as unknown as typeof fetch;

describe('hosted test server', () => {
  beforeEach(() => preferences.clearAll());

  it('accepts only a running server with https origins that has not ended', () => {
    expect(parseHostedServer(RUNNING, NOW)).toEqual({
      api: 'https://calm-river.trycloudflare.com',
      web: 'https://calm-river.trycloudflare.com',
      expiresAt: '2026-10-27T14:00:00Z',
    });
    for (const bad of [
      { ...RUNNING, status: 'stopped' },
      { ...RUNNING, version: 2 },
      { ...RUNNING, expiresAt: '2026-10-27T09:59:00Z' },
      { ...RUNNING, expiresAt: 'soon' },
      { ...RUNNING, api: 'http://calm-river.trycloudflare.com' },
      { ...RUNNING, web: 'https://calm-river.trycloudflare.com/path' },
      null,
      'running',
    ]) {
      expect(parseHostedServer(bad, NOW)).toBeNull();
    }
  });

  it('remembers the address for a start without a connection, until it ends', async () => {
    const now = () => NOW;
    await expect(
      discoverHostedServer(URL, { fetchImpl: answer(200, RUNNING), now }),
    ).resolves.toMatchObject({ api: RUNNING.api });
    const offline = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    await expect(
      discoverHostedServer(URL, { fetchImpl: offline as unknown as typeof fetch, now }),
    ).resolves.toMatchObject({ api: RUNNING.api });
    // A server error keeps the last address too; an ended one is never used.
    await expect(
      discoverHostedServer(URL, { fetchImpl: answer(503), now }),
    ).resolves.not.toBeNull();
    await expect(
      discoverHostedServer(URL, {
        fetchImpl: offline as unknown as typeof fetch,
        now: () => Date.parse('2026-10-27T15:00:00Z'),
      }),
    ).resolves.toBeNull();
  });

  it('forgets the address once the server says it stopped or the file is gone', async () => {
    const now = () => NOW;
    await discoverHostedServer(URL, { fetchImpl: answer(200, RUNNING), now });
    await expect(
      discoverHostedServer(URL, { fetchImpl: answer(200, { ...RUNNING, status: 'stopped' }), now }),
    ).resolves.toBeNull();
    const offline = jest.fn(() => Promise.reject(new TypeError('offline')));
    await expect(
      discoverHostedServer(URL, { fetchImpl: offline as unknown as typeof fetch, now }),
    ).resolves.toBeNull();

    await discoverHostedServer(URL, { fetchImpl: answer(200, RUNNING), now });
    await expect(discoverHostedServer(URL, { fetchImpl: answer(404), now })).resolves.toBeNull();
    await expect(
      discoverHostedServer(URL, { fetchImpl: offline as unknown as typeof fetch, now }),
    ).resolves.toBeNull();
  });

  it('does nothing without a discovery address', async () => {
    const fetchImpl = answer(200, RUNNING);
    await expect(discoverHostedServer('', { fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
