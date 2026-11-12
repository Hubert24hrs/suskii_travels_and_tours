import { parseEnv } from '../config/env.schema';

import { smsProviderFor } from './notifications.module';
import { MockSmsProvider, SmsSendError } from './sms';
import { AfricasTalkingSmsProvider, RoutingSmsProvider, TermiiSmsProvider } from './sms-providers';

/** Text adapters (ADR-091) against recorded answers; no test reaches a provider. */

const message = {
  to: '+2348012345678',
  body: 'Your Suskii code is 123456',
  template: 'otp:sign-in',
};

interface Call {
  url: string;
  init: RequestInit;
}

function fake(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return ((url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );
  }) as typeof fetch;
}

const failing =
  (name: string): typeof fetch =>
  () =>
    Promise.reject(Object.assign(new Error('down'), { name }));

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SmsSendError) return error.code;
    throw error;
  }
  return 'resolved';
}

describe('TermiiSmsProvider', () => {
  const termii = (fetchImpl: typeof fetch) =>
    new TermiiSmsProvider({
      baseUrl: 'https://api.ng.termii.com/',
      apiKey: 'TL-test-key-0123456789',
      senderId: 'SuskiiTT',
      channel: 'dnd',
      timeoutMs: 5000,
      fetch: fetchImpl,
    });

  it('posts JSON with the key in the body, the number without the plus, on the DND route', async () => {
    const calls: Call[] = [];
    await termii(
      fake(
        200,
        {
          message_id: '9122821270554876574',
          message: 'Successfully Sent',
          balance: 9,
          user: 'Suskii',
        },
        calls,
      ),
    ).send(message);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.ng.termii.com/api/sms/send');
    expect(calls[0]?.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      to: '2348012345678',
      from: 'SuskiiTT',
      sms: 'Your Suskii code is 123456',
      type: 'plain',
      channel: 'dnd',
      api_key: 'TL-test-key-0123456789',
    });
    // The key never goes in the URL.
    expect(calls[0]?.url).not.toContain('TL-test-key');
  });

  it('turns refusals, odd answers and dead connections into codes without the number or text', async () => {
    expect(await codeOf(termii(fake(400, { message: 'Insufficient balance' })).send(message))).toBe(
      'http-400',
    );
    expect(await codeOf(termii(fake(200, { message: 'ok' })).send(message))).toBe(
      'unexpected-answer',
    );
    expect(await codeOf(termii(fake(502, '<html>')).send(message))).toBe('http-502');
    expect(await codeOf(termii(failing('TimeoutError')).send(message))).toBe('timeout');
    expect(await codeOf(termii(failing('TypeError')).send(message))).toBe('network');
    const error = await termii(fake(400, {}))
      .send(message)
      .catch((caught: unknown) => caught as Error);
    expect(String(error)).not.toMatch(/2348012345678|123456/);
  });
});

describe('AfricasTalkingSmsProvider', () => {
  const at = (fetchImpl: typeof fetch, senderId: string | null = 'SUSKII') =>
    new AfricasTalkingSmsProvider({
      baseUrl: 'https://api.africastalking.com',
      username: 'suskii',
      apiKey: 'atsk_test_0123456789',
      senderId,
      timeoutMs: 5000,
      fetch: fetchImpl,
    });
  const answer = (statusCode: number, status = 'Success') => ({
    SMSMessageData: {
      Message: 'Sent to 1/1 Total Cost: KES 0.8000',
      Recipients: [
        { statusCode, number: '+254711000000', status, cost: 'KES 0.8000', messageId: 'ATXid_1' },
      ],
    },
  });

  it('posts a form with the key in the apiKey header and accepts 101 Sent', async () => {
    const calls: Call[] = [];
    await at(fake(201, answer(101), calls)).send({ ...message, to: '+254711000000' });
    expect(calls[0]?.url).toBe('https://api.africastalking.com/version1/messaging');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.apiKey).toBe('atsk_test_0123456789');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(calls[0]?.init.body as string))).toEqual({
      username: 'suskii',
      to: '+254711000000',
      message: 'Your Suskii code is 123456',
      bulkSMSMode: '1',
      from: 'SUSKII',
    });
    // Without a sender ID the account default is used: no `from` at all.
    const bare: Call[] = [];
    await at(fake(201, answer(100), bare), null).send(message);
    expect(new URLSearchParams(bare[0]?.init.body as string).has('from')).toBe(false);
    await at(fake(201, answer(102))).send(message);
  });

  it('refuses a recipient the gateway did not take, and other failures, by code', async () => {
    expect(await codeOf(at(fake(201, answer(403, 'InvalidPhoneNumber'))).send(message))).toBe(
      'status-403',
    );
    expect(await codeOf(at(fake(201, answer(405, 'InsufficientBalance'))).send(message))).toBe(
      'status-405',
    );
    expect(
      await codeOf(at(fake(401, 'The supplied authentication is invalid')).send(message)),
    ).toBe('http-401');
    expect(await codeOf(at(fake(201, { SMSMessageData: { Recipients: [] } })).send(message))).toBe(
      'unexpected-answer',
    );
    expect(await codeOf(at(failing('TimeoutError')).send(message))).toBe('timeout');
  });
});

describe('RoutingSmsProvider and the settings', () => {
  it('routes by the longest calling-code prefix and falls back to SMS_PROVIDER', async () => {
    const nigeria = new MockSmsProvider();
    const kenya = new MockSmsProvider();
    const rest = new MockSmsProvider();
    const router = new RoutingSmsProvider(
      { name: 'rest', provider: rest },
      new Map([
        ['234', { name: 'nigeria', provider: nigeria }],
        ['254', { name: 'kenya', provider: kenya }],
        ['2547', { name: 'kenya-mobile', provider: kenya }],
      ]),
    );
    expect(router.route('+2348012345678')).toBe('nigeria');
    expect(router.route('+254711000000')).toBe('kenya-mobile');
    expect(router.route('+254201234567')).toBe('kenya');
    expect(router.route('+447700900000')).toBe('rest');
    await router.send(message);
    expect(nigeria.outbox).toHaveLength(1);
    rest.failWith = 'http-500';
    await expect(router.send({ ...message, to: '+447700900000' })).rejects.toBeInstanceOf(
      SmsSendError,
    );
  });

  it('builds what the settings name, each adapter once, and keeps the bare mock for tests', () => {
    const base = {
      DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
      REDIS_URL: 'redis://localhost:6379',
    };
    expect(smsProviderFor(parseEnv(base))).toBeInstanceOf(MockSmsProvider);
    const routed = smsProviderFor(
      parseEnv({
        ...base,
        SMS_PROVIDER: 'africastalking',
        SMS_ROUTES: '234=termii',
        TERMII_API_KEY: 'TL-test-key-0123456789',
        TERMII_SENDER_ID: 'SuskiiTT',
        AFRICASTALKING_USERNAME: 'suskii',
        AFRICASTALKING_API_KEY: 'atsk_test_0123456789',
      }),
    ) as RoutingSmsProvider;
    expect(routed).toBeInstanceOf(RoutingSmsProvider);
    expect(routed.route('+2348012345678')).toBe('termii');
    expect(routed.route('+254711000000')).toBe('africastalking');
  });
});
