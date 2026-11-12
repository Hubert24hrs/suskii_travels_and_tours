import { describe, expect, it } from 'vitest';

import { metadataTokenSource } from './google-identity.js';

/** A metadata server that answers each request with the next of `answers`. */
function metadataServer(answers: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? { body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const token = (value: string, seconds = 3599) => ({
  body: { access_token: value, expires_in: seconds, token_type: 'Bearer' },
});

describe('metadataTokenSource (ADR-112)', () => {
  it("asks the machine's own metadata server, with its header, and refuses a redirect", async () => {
    const { fetch, calls } = metadataServer([token('first')]);
    const source = metadataTokenSource({ fetch });

    expect(await source()).toBe('first');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
    );
    expect(calls[0]?.init.headers).toEqual({ 'Metadata-Flavor': 'Google' });
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps a token until five minutes before it ends, then fetches the next', async () => {
    let clock = 1_000_000;
    const { fetch, calls } = metadataServer([token('first', 3600), token('second', 3600)]);
    const source = metadataTokenSource({ fetch, now: () => clock });

    expect(await source()).toBe('first');
    clock += 54 * 60_000;
    expect(await source()).toBe('first');
    expect(calls).toHaveLength(1);

    clock += 2 * 60_000;
    expect(await source()).toBe('second');
    expect(calls).toHaveLength(2);
  });

  it('shares one request between callers who ask at the same time', async () => {
    const { fetch, calls } = metadataServer([token('shared')]);
    const source = metadataTokenSource({ fetch });

    const tokens = await Promise.all([source(), source(), source()]);
    expect(tokens).toEqual(['shared', 'shared', 'shared']);
    expect(calls).toHaveLength(1);
  });

  it('throws without repeating what the server sent, and asks again on the next call', async () => {
    const { fetch, calls } = metadataServer([
      { status: 404, body: { error: 'no service account named secret-detail' } },
      { body: { access_token: '', expires_in: 3599 } },
      { body: { access_token: 'no-lifetime' } },
      token('recovered'),
    ]);
    const source = metadataTokenSource({ fetch });

    const messages: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await source().catch((error: unknown) => messages.push(String(error)));
    }
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('404');
    for (const message of messages) {
      expect(message).not.toContain('secret-detail');
      expect(message).not.toContain('no-lifetime');
    }
    expect(await source()).toBe('recovered');
    expect(calls).toHaveLength(4);
  });
});
