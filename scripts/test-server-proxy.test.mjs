import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { test } from 'node:test';

import { createProxy, forwardHeaders, routeFor } from './test-server-proxy.mjs';

test('sends API paths to the API and everything else to the website', () => {
  for (const path of [
    '/v1/catalog/places?q=lag',
    '/v1',
    '/health',
    '/ready',
    '/.well-known/jwks.json',
  ]) {
    assert.equal(routeFor(path), 'api', path);
  }
  for (const path of [
    '/',
    '/flights',
    '/v12',
    '/v1x/thing',
    '/healthz',
    '/.well-known/assetlinks.json',
    '/.well-known/apple-app-site-association',
  ]) {
    assert.equal(routeFor(path), 'web', path);
  }
  // The demo drivers' PIN page only when the stack runs it.
  assert.equal(routeFor('/demo-drivers', { pins: true }), 'pins');
  assert.equal(routeFor('/demo-drivers?sent=1', { pins: true }), 'pins');
  assert.equal(routeFor('/demo-drivers'), 'web');
  assert.equal(routeFor('/demo-drivers/x', { pins: true }), 'web');
});

test('drops hop-by-hop headers, including those named by Connection', () => {
  assert.deepEqual(
    forwardHeaders({
      host: 'x.trycloudflare.com',
      connection: 'keep-alive, x-secret-hop',
      'keep-alive': 'timeout=5',
      'x-secret-hop': '1',
      'transfer-encoding': 'chunked',
      'cf-connecting-ip': '203.0.113.9',
      cookie: 'a=b',
    }),
    { host: 'x.trycloudflare.com', 'cf-connecting-ip': '203.0.113.9', cookie: 'a=b' },
  );
});

/** A fake upstream that answers with its name, the path and one request header. */
function upstream(name) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': `${name}=1` });
      res.end(JSON.stringify({ name, path: req.url, ip: req.headers['cf-connecting-ip'], body }));
    });
  });
  server.on('upgrade', (req, socket) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Upstream: ${name}\r\n\r\n`,
    );
    socket.on('data', (chunk) => socket.write(`${name}:${chunk.toString()}`));
    socket.on('end', () => socket.end());
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const portOf = (server) => server.address().port;

function send(port, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('proxies requests, bodies, cookies and WebSocket upgrades to the right upstream', async (t) => {
  const api = await upstream('api');
  const web = await upstream('web');
  const proxy = createProxy({
    api: `http://127.0.0.1:${portOf(api)}`,
    web: `http://127.0.0.1:${portOf(web)}`,
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const server of [proxy, api, web]) {
      server.closeAllConnections();
      server.close();
    }
  });

  const posted = await send(portOf(proxy), {
    method: 'POST',
    path: '/v1/auth/login',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: '{"email":"a@b.c"}',
  });
  assert.equal(posted.status, 201);
  assert.deepEqual(JSON.parse(posted.text), {
    name: 'api',
    path: '/v1/auth/login',
    ip: '203.0.113.9',
    body: '{"email":"a@b.c"}',
  });
  assert.deepEqual(posted.headers['set-cookie'], ['api=1']);

  const page = await send(portOf(proxy), { path: '/flights?from=LOS' });
  assert.equal(JSON.parse(page.text).name, 'web');
  assert.equal(JSON.parse(page.text).path, '/flights?from=LOS');

  // A live ride's socket reaches the API and stays open both ways.
  const echoed = await new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: portOf(proxy),
      path: '/v1/ws/rides',
      headers: { connection: 'Upgrade', upgrade: 'websocket' },
    });
    req.on('upgrade', (res, socket) => {
      assert.equal(res.headers['x-upstream'], 'api');
      socket.once('data', (chunk) => {
        socket.destroy();
        resolve(chunk.toString());
      });
      socket.write('ping');
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(echoed, 'api:ping');
});

test('answers 502 when the upstream is down', async (t) => {
  const proxy = createProxy({ api: 'http://127.0.0.1:1', web: 'http://127.0.0.1:1' });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  const response = await send(portOf(proxy), { path: '/' });
  assert.equal(response.status, 502);
});
