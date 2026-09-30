import { EXPO_PUSH_TOKEN, ExpoPushProvider, MockPushProvider, type PushMessage } from './push';

interface Call {
  headers: Record<string, string>;
  body: { to: string; data: { path: string }; channelId: string }[];
}

function fakeFetch(...responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = ((_url: string, init: RequestInit) => {
    calls.push({
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Call['body'],
    });
    const next = responses.shift() ?? { status: 500, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const message = (index: number): PushMessage => ({
  to: `ExponentPushToken[device${String(index).padStart(4, '0')}]`,
  title: 'Booking ABC123 is confirmed',
  body: 'Your documents are ready in the app.',
  path: '/trips/0190a1b2-0000-7000-8000-000000000001',
});

const ok = (count: number) => ({
  body: { data: Array.from({ length: count }, (_, id) => ({ status: 'ok', id: `t${id}` })) },
});

describe('ExpoPushProvider', () => {
  it('sends in chunks of 100 with the access token and the in-app path only', async () => {
    const { calls, fetchImpl } = fakeFetch(ok(100), ok(50));
    const provider = new ExpoPushProvider({
      url: 'https://push.test/send',
      accessToken: 'expo-access-token-0123456789',
      fetch: fetchImpl,
    });
    const results = await provider.send(Array.from({ length: 150 }, (_, i) => message(i)));
    expect(results).toHaveLength(150);
    expect(results.every((result) => result === 'ok')).toBe(true);
    expect(calls.map((call) => call.body.length)).toEqual([100, 50]);
    expect(calls[0]?.headers.Authorization).toBe('Bearer expo-access-token-0123456789');
    expect(calls[0]?.body[0]).toMatchObject({
      channelId: 'bookings',
      data: { path: '/trips/0190a1b2-0000-7000-8000-000000000001' },
    });
  });

  it('marks unregistered devices invalid and other ticket errors as errors', async () => {
    const { fetchImpl } = fakeFetch({
      body: {
        data: [
          { status: 'ok', id: 'a' },
          { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } },
        ],
      },
    });
    const provider = new ExpoPushProvider({ url: 'https://push.test/send', fetch: fetchImpl });
    await expect(provider.send([message(1), message(2), message(3)])).resolves.toEqual([
      'ok',
      'invalid-token',
      'error',
    ]);
  });

  it('fails the chunk safely on HTTP errors, odd answers and network failures', async () => {
    const { calls, fetchImpl } = fakeFetch(
      { status: 503, body: {} },
      { body: { data: [] } },
      { body: { unexpected: true } },
    );
    const provider = new ExpoPushProvider({ url: 'https://push.test/send', fetch: fetchImpl });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(provider.send([message(1)])).resolves.toEqual(['error']);
    }
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    const offline = new ExpoPushProvider({
      url: 'https://push.test/send',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(offline.send([message(1)])).resolves.toEqual(['error']);
  });
});

describe('MockPushProvider', () => {
  it('captures messages and answers invalid-token for unregistered devices', async () => {
    const provider = new MockPushProvider();
    provider.unregistered.add(message(2).to);
    await expect(provider.send([message(1), message(2)])).resolves.toEqual(['ok', 'invalid-token']);
    expect(provider.outbox).toEqual([message(1)]);
  });
});

describe('EXPO_PUSH_TOKEN', () => {
  it('accepts Expo push tokens only', () => {
    expect(EXPO_PUSH_TOKEN.test('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(EXPO_PUSH_TOKEN.test('ExpoPushToken[abcdefgh12345678]')).toBe(true);
    expect(EXPO_PUSH_TOKEN.test('fcm-device-token')).toBe(false);
    expect(EXPO_PUSH_TOKEN.test('ExponentPushToken[bad token]')).toBe(false);
  });
});
