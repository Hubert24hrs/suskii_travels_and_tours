import { afterEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';

import { scripted } from './model/mock-model.js';
import { createAgentServer, type AgentServer } from './server.js';
import { harness, request } from './test/harness.js';

const TOKEN = 'run-token-'.padEnd(40, 'x');
let server: AgentServer | undefined;

async function start(runToken: string | undefined = TOKEN, ready = true) {
  const h = harness();
  server = createAgentServer({
    port: 0,
    runToken,
    runs: h.service,
    ready: () => Promise.resolve(ready),
    logger: pino({ level: 'silent' }),
  });
  await server.start();
  const base = `http://127.0.0.1:${server.port()}`;
  const post = (body: unknown, token: string | null = TOKEN, path = '/runs') =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { h, base, post };
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe('the agent service door (ADR-101)', () => {
  it('answers a run as newline-delimited JSON that ends with `end`', async () => {
    const { h, post } = await start();
    h.model.use(scripted({ specialist: [{ text: 'We sell trips.' }] }));
    const response = await post(
      request({
        context: { ...request().context, agents: ['concierge'] },
        input: { kind: 'message', text: 'What does Suskii do?' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const lines = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string });
    expect(lines.map((line) => line.type)).toEqual(['status', 'status', 'end']);
    expect(lines.at(-1)).toMatchObject({ outcome: 'answered', answer: { text: 'We sell trips.' } });
  });

  it('tells a caller without the token nothing, whatever it asks for', async () => {
    const { post, base } = await start();
    for (const response of [
      await post(request(), null),
      await post(request(), 'wrong-token-'.padEnd(40, 'y')),
      await post(request(), TOKEN, '/threads'),
      await fetch(`${base}/runs`, { headers: { authorization: `Bearer ${TOKEN}` } }),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
  });

  it('accepts no run at all while no token is configured', async () => {
    const { post } = await start(undefined);
    expect((await post(request(), '')).status).toBe(404);
    expect((await post(request(), 'undefined')).status).toBe(404);
  });

  it('refuses a body that is not a run request, without running anything', async () => {
    const { h, post } = await start();
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ ...request(), grant: '' })).status).toBe(400);
    expect(
      (await post({ ...request(), userId: 'x', input: { kind: 'message', text: '' } })).status,
    ).toBe(400);
    expect((await post('x'.repeat(70_000))).status).toBe(400);
    expect(h.model.requests).toHaveLength(0);
  });

  it('says whether it can keep threads', async () => {
    const up = await start();
    const health = await fetch(`${up.base}/health`);
    expect([health.status, await health.json()]).toEqual([200, { status: 'ok', running: 0 }]);
    await server?.stop();
    const down = await start(TOKEN, false);
    expect((await fetch(`${down.base}/health`)).status).toBe(503);
  });
});
