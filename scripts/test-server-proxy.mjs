#!/usr/bin/env node
/**
 * Single-origin front for the hosted test server (test-server.yml, ADR-066): the tunnel reaches
 * one local port, and this proxy sends API paths to the API and everything else to the website,
 * WebSocket upgrades (live rides, ADR-052) included. One origin keeps the API's session cookies
 * first-party for the website, as they are in production (api.* and www.* share a site).
 *
 *   node scripts/test-server-proxy.mjs [--port 8080] [--api http://127.0.0.1:4000] \
 *     [--web http://127.0.0.1:3000] [--pins http://127.0.0.1:4200]
 *
 * With --pins, `/demo-drivers` reaches the demo drivers' PIN page (ADR-056), so a tester can give
 * a waiting sample driver the rider's PIN.
 *
 * It listens on 127.0.0.1 only: nothing but the tunnel on the same machine reaches it.
 */
import { request as httpRequest, createServer } from 'node:http';
import { connect } from 'node:net';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Paths the API serves; everything else is the website. */
const API_PATHS = [/^\/v1(\/|$)/, /^\/health$/, /^\/ready$/, /^\/\.well-known\/jwks\.json$/];
const PIN_PATH = /^\/demo-drivers$/;

/** Hop-by-hop headers (RFC 9110 7.6.1) never travel past a proxy. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
]);

/** Which upstream answers `url` (path and query): 'api', 'pins' (when enabled) or 'web'. */
export function routeFor(url, { pins = false } = {}) {
  const path = (url ?? '/').split('?')[0] ?? '/';
  if (pins && PIN_PATH.test(path)) return 'pins';
  return API_PATHS.some((pattern) => pattern.test(path)) ? 'api' : 'web';
}

/** The request's headers without hop-by-hop ones, for the upstream. */
export function forwardHeaders(headers) {
  const listed = String(headers.connection ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !HOP_BY_HOP.has(name.toLowerCase()) && !listed.includes(name.toLowerCase()),
    ),
  );
}

export function createProxy({ api, web, pins }) {
  const upstreams = {
    api: new URL(api),
    web: new URL(web),
    ...(pins ? { pins: new URL(pins) } : {}),
  };
  const route = (url) => upstreams[routeFor(url, { pins: Boolean(pins) })];

  const server = createServer((req, res) => {
    const target = route(req.url);
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: forwardHeaders(req.headers),
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, forwardHeaders(response.headers));
        response.pipe(res);
      },
    );
    upstream.setTimeout(120_000, () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad gateway');
    });
    req.pipe(upstream);
  });

  // WebSockets: replay the upgrade request to the upstream, then splice the two sockets.
  server.on('upgrade', (req, socket, head) => {
    const target = route(req.url);
    const upstream = connect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        lines.push(`${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
    upstream.on('close', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });

  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '8080' },
      api: { type: 'string', default: 'http://127.0.0.1:4000' },
      web: { type: 'string', default: 'http://127.0.0.1:3000' },
      pins: { type: 'string' },
    },
  });
  const server = createProxy({ api: values.api, web: values.web, pins: values.pins });
  server.listen(Number(values.port), '127.0.0.1', () => {
    process.stdout.write(
      `Test server proxy on http://127.0.0.1:${values.port} (API ${values.api}, web ${values.web})\n`,
    );
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
