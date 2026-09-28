import { afterEach, describe, expect, it } from 'vitest';

import { createHealthServer, type HealthServer } from './health-server.js';

describe('createHealthServer', () => {
  let server: HealthServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('answers GET /health with 200 ok', async () => {
    server = createHealthServer(0);
    await server.start();

    const response = await fetch(`http://127.0.0.1:${server.port()}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ status: 'ok' });
  });

  it('404s any other route or method', async () => {
    server = createHealthServer(0);
    await server.start();
    const base = `http://127.0.0.1:${server.port()}`;

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(404);
  });

  it('can be stopped before it was started', async () => {
    await expect(createHealthServer(0).stop()).resolves.toBeUndefined();
  });
});
