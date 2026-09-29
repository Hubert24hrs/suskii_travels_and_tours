import { CloudflareTurnstileVerifier, MockTurnstileVerifier } from './turnstile';

const respond = (body: unknown, status = 200): typeof fetch =>
  jest.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

const check = { action: 'newsletter', remoteIp: '203.0.113.9' };

describe('CloudflareTurnstileVerifier', () => {
  const verifier = (fetchImpl: typeof fetch) =>
    new CloudflareTurnstileVerifier('secret', ['www.suskii.example'], fetchImpl);

  it('accepts a successful token for the expected action and hostname', async () => {
    const fetchImpl = respond({
      success: true,
      action: 'newsletter',
      hostname: 'www.suskii.example',
    });
    await expect(verifier(fetchImpl).verify('token', check)).resolves.toBe(true);
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(JSON.parse(init.body as string)).toEqual({
      secret: 'secret',
      response: 'token',
      remoteip: '203.0.113.9',
    });
  });

  it('rejects failures, other actions, other hostnames and outages (fails closed)', async () => {
    const cases: (typeof fetch)[] = [
      respond({ success: false, 'error-codes': ['invalid-input-response'] }),
      respond({ success: true, action: 'signup', hostname: 'www.suskii.example' }),
      respond({ success: true, action: 'newsletter', hostname: 'evil.example' }),
      respond({ success: true, action: 'newsletter' }),
      respond({ error: 'bad gateway' }, 502),
      jest.fn(() => Promise.reject(new TypeError('fetch failed'))),
    ];
    for (const fetchImpl of cases) {
      await expect(verifier(fetchImpl).verify('token', check)).resolves.toBe(false);
    }
  });
});

describe('MockTurnstileVerifier', () => {
  it('accepts anything except the "fail" token', async () => {
    const verifier = new MockTurnstileVerifier();
    await expect(verifier.verify('anything', check)).resolves.toBe(true);
    await expect(verifier.verify('fail', check)).resolves.toBe(false);
  });
});
