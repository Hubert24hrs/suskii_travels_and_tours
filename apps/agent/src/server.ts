import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

import { agentRunRequestSchema, type AgentRunEvent } from '@suskii/shared';

import { type Logger } from './logger.js';
import { type RunService } from './runs.js';

/** A run request is a message and a grant: anything far larger is not one. */
const MAX_BODY_BYTES = 64 * 1024;

export interface AgentServerOptions {
  port: number;
  /** What the API must present; without it no run is accepted at all. */
  runToken: string | undefined;
  runs: RunService;
  ready: () => Promise<boolean>;
  logger: Logger;
}

export interface AgentServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  port(): number;
}

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/**
 * The agent service's only door (ADR-101): `POST /runs` for the API, with the run token, and
 * `GET /health` (the process is up) and `GET /ready` (it can keep threads) for the platform.
 * It is never reachable from the internet (internal ingress),
 * and a request without the token learns nothing: not which routes exist, not whether a thread
 * does. A run answers as newline-delimited JSON, one event a line, ending with `end`.
 */
export function createAgentServer(options: AgentServerOptions): AgentServer {
  const { logger, runs } = options;

  const authorised = (req: IncomingMessage): boolean => {
    const expected = options.runToken;
    const header = req.headers.authorization;
    const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    return Boolean(expected) && presented !== '' && safeEqual(presented, expected ?? '');
  };

  const handleRun = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let parsed;
    try {
      parsed = agentRunRequestSchema.safeParse(await readBody(req));
    } catch {
      json(res, 400, { error: 'invalid_request' });
      return;
    }
    if (!parsed.success) {
      json(res, 400, { error: 'invalid_request' });
      return;
    }
    const controller = new AbortController();
    // The API went away: stop paying for model turns nobody will read.
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });
    const emit = (event: AgentRunEvent): void => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    await runs.run(parsed.data, emit, controller.signal);
    res.end();
  };

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    // Liveness: the process answers. It says nothing of the store, so a database blip never
    // has the platform restart a service that is otherwise well.
    if (req.method === 'GET' && path === '/health') {
      json(res, 200, { status: 'ok', running: runs.running });
      return;
    }
    // Readiness: it can keep a conversation's working state, so it may be sent runs.
    if (req.method === 'GET' && path === '/ready') {
      void options.ready().then(
        (ok) => json(res, ok ? 200 : 503, { status: ok ? 'ready' : 'unavailable' }),
        () => json(res, 503, { status: 'unavailable' }),
      );
      return;
    }
    if (!authorised(req) || req.method !== 'POST' || path !== '/runs') {
      json(res, 404, { error: 'not_found' });
      return;
    }
    handleRun(req, res).catch((error: unknown) => {
      logger.error(
        { error: error instanceof Error ? error.name : 'unknown' },
        'run request failed',
      );
      if (!res.headersSent) json(res, 500, { error: 'failed' });
      else res.end();
    });
  });

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, () => {
          server.off('error', reject);
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
    port: () => (server.address() as AddressInfo | null)?.port ?? options.port,
  };
}
