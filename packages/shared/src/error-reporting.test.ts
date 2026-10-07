import { describe, expect, it, vi } from 'vitest';

import {
  buildErrorEvent,
  createSentryReporter,
  parseDsn,
  parseStack,
  scrubText,
} from './error-reporting';

const DSN = 'https://abc123public@o1.ingest.sentry.io/4504';
const OPTIONS = { platform: 'node', service: 'api' } as const;

describe('parseDsn', () => {
  it('finds the envelope endpoint and public key', () => {
    expect(parseDsn(DSN)).toEqual({
      url: 'https://o1.ingest.sentry.io/api/4504/envelope/',
      publicKey: 'abc123public',
    });
    expect(parseDsn('https://key@sentry.example.com/relay/12')?.url).toBe(
      'https://sentry.example.com/relay/api/12/envelope/',
    );
  });

  it('refuses malformed or plaintext DSNs', () => {
    for (const bad of ['', 'not a url', 'https://o1.ingest.sentry.io/4504', 'http://k@sentry.io/1'])
      expect(parseDsn(bad)).toBeNull();
    expect(parseDsn('http://key@localhost:9000/3')).not.toBeNull();
  });
});

describe('scrubText', () => {
  it('removes contact details, tokens, numbers and URL queries', () => {
    const scrubbed = scrubText(
      'chioma@example.com +234 801 234 5678 Bearer abc.def eyJhbGc.eyJzdWIi.sig ' +
        'https://suskii.ng/bookings/1?x=1#access=secret card 4111 1111 1111 1111 ' +
        'token 9f8e7d6c5b4a39281706f5e4d3c2b1a0QwErTyUiOp',
    );
    expect(scrubbed).not.toMatch(/chioma|801|abc\.def|eyJ|access=|4111|9f8e7d6c/);
    expect(scrubbed).toContain('https://suskii.ng/bookings/1');
  });

  it('keeps record ids and ordinary words', () => {
    const text = 'Booking 01a115b6-a055-75e1-8bba-d44e5aa54399 failed: supplier timeout';
    expect(scrubText(text)).toBe(text);
  });
});

describe('parseStack', () => {
  it('reads V8 stacks, oldest frame first, without query strings', () => {
    const frames = parseStack(
      [
        'Error: boom',
        '    at handler (/app/dist/bookings/service.js:10:5)',
        '    at async run (/app/node_modules/x/index.js:2:3)',
        '    at https://suskii.ng/_next/static/chunks/a.js?v=1:1:200',
      ].join('\n'),
    );
    expect(frames).toEqual([
      {
        filename: 'https://suskii.ng/_next/static/chunks/a.js',
        lineno: 1,
        colno: 200,
        in_app: true,
      },
      {
        function: 'async run',
        filename: '/app/node_modules/x/index.js',
        lineno: 2,
        colno: 3,
        in_app: false,
      },
      {
        function: 'handler',
        filename: '/app/dist/bookings/service.js',
        lineno: 10,
        colno: 5,
        in_app: true,
      },
    ]);
  });

  it('reads JavaScriptCore and Hermes stacks', () => {
    expect(parseStack('pay@index.bundle:3:44\n@index.bundle:9:1')).toEqual([
      { filename: 'index.bundle', lineno: 9, colno: 1, in_app: true },
      { function: 'pay', filename: 'index.bundle', lineno: 3, colno: 44, in_app: true },
    ]);
  });
});

describe('buildErrorEvent', () => {
  it('sends the error chain and allowlisted tags only', () => {
    const cause = new Error('connect ECONNREFUSED 10.0.0.7:5432');
    const error = new Error('payment for ada@example.com failed', { cause });
    const tags = { requestId: 'req-12345678', route: '/v1/bookings/:id', cookie: 'secret' };
    const event = buildErrorEvent(
      error,
      { ...OPTIONS, release: 'abc', environment: 'staging' },
      tags,
    );
    expect(event).toMatchObject({
      platform: 'node',
      level: 'error',
      release: 'abc',
      environment: 'staging',
      tags: { service: 'api', requestId: 'req-12345678', route: '/v1/bookings/:id' },
    });
    expect(JSON.stringify(event)).not.toMatch(/secret|ada@example|10\.0\.0\.7/);
    const values = (event.exception as { values: { value: string }[] }).values;
    expect(values.map((value) => value.value)).toEqual([
      'connect ECONNREFUSED [ip]:5432',
      'payment for [email] failed',
    ]);
    expect(event).not.toHaveProperty('request');
    expect(event).not.toHaveProperty('user');
  });

  it('reports values that are not errors', () => {
    const event = buildErrorEvent('plain failure', OPTIONS);
    expect(event.exception).toEqual({ values: [{ type: 'NonError', value: 'plain failure' }] });
  });
});

describe('createSentryReporter', () => {
  const ok = (): Promise<Response> => Promise.resolve(new Response(null, { status: 200 }));

  it('posts an envelope with query authentication and a text body', async () => {
    const fetch = vi.fn(ok);
    await createSentryReporter({ ...OPTIONS, dsn: DSN, fetch }).capture(new Error('boom'));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://o1.ingest.sentry.io/api/4504/envelope/?sentry_version=7&sentry_key=abc123public&sentry_client=suskii%2F1',
    );
    expect(init.headers).toBeUndefined();
    const [header, item, event] = (init.body as string)
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(item).toEqual({ type: 'event' });
    expect(header?.event_id).toBe(event?.event_id);
  });

  it('sends the same error once a minute, caps the rate and pauses after a 429', async () => {
    let time = 0;
    const fetch = vi.fn(ok);
    const reporter = createSentryReporter({
      ...OPTIONS,
      dsn: DSN,
      fetch,
      maxPerMinute: 3,
      now: () => time,
    });
    const same = new Error('same');
    await reporter.capture(same);
    await reporter.capture(same);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const n of [1, 2, 3]) await reporter.capture(new Error(`other ${n}`));
    expect(fetch).toHaveBeenCalledTimes(3);
    time = 61_000;
    await reporter.capture(same);
    expect(fetch).toHaveBeenCalledTimes(4);

    fetch.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 429 })));
    time = 130_000;
    await reporter.capture(new Error('limited'));
    await reporter.capture(new Error('dropped'));
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('never throws, and does nothing with a malformed DSN', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(
      createSentryReporter({ ...OPTIONS, dsn: DSN, fetch: failing }).capture(new Error('x')),
    ).resolves.toBeUndefined();
    const unused = vi.fn(ok);
    await createSentryReporter({ ...OPTIONS, dsn: 'nope', fetch: unused }).capture(new Error('x'));
    expect(unused).not.toHaveBeenCalled();
  });
});
