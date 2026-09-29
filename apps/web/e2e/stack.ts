import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { delimiter, join, resolve } from 'node:path';

import type { StartedTestContainer } from 'testcontainers';

/**
 * Boots the platform for the web e2e tests: Postgres and Redis (Testcontainers, or services
 * named by WEB_E2E_DATABASE_URL / WEB_E2E_REDIS_URL), the built API with the real seed, one
 * deals and destinations refresh through the built worker, and the built web app.
 *
 * Everything runs from build output, like production. The browser reaches the API at the
 * NEXT_PUBLIC_API_BASE_URL inlined at build time (default http://localhost:4000), so the API
 * listens on that port.
 */

const ROOT = resolve(__dirname, '../../..');
const API_DIR = join(ROOT, 'apps/api');
const WORKER_DIR = join(ROOT, 'apps/worker');
const WEB_DIR = join(ROOT, 'apps/web');
const LOG_DIR = join(WEB_DIR, 'test-results/stack');

export const WEB_PORT = 3000;
/** The mock supplier raises this route's fare at the payment re-check (see booking.spec.ts). */
export const PRICE_CHANGE_ROUTE = { origin: 'LOS', destination: 'DXB' } as const;
const PRICE_CHANGE_ROUTE_RULE = `${PRICE_CHANGE_ROUTE.origin}-${PRICE_CHANGE_ROUTE.destination}:500`;

export const API_PORT = Number(
  new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').port || 80,
);

export interface Stack {
  stop: () => Promise<void>;
}

function assertPortFree(port: number, name: string): Promise<void> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new Error(
          `Port ${port} (${name}) is in use. Stop the local dev servers, or set E2E_BASE_URL to ` +
            'run the tests against the stack that is already running.',
        ),
      ),
    );
    server.listen(port, () => server.close(() => resolvePort()));
  });
}

async function waitFor(url: string, child: ChildProcess, name: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`${name} exited with code ${child.exitCode}; see ${LOG_DIR}/${name}.log`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`${name} did not become ready at ${url}; see ${LOG_DIR}/${name}.log`);
}

function start(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const log = createWriteStream(join(LOG_DIR, `${name}.log`));
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return child;
}

function run(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const child = start(name, args, cwd, env);
  return new Promise((resolveRun, reject) => {
    child.once('exit', (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`${name} failed with code ${code}; see ${LOG_DIR}/${name}.log`)),
    );
  });
}

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveStop) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => {
      clearTimeout(force);
      resolveStop();
    });
    child.kill('SIGTERM');
  });
}

async function startDataServices(): Promise<{
  databaseUrl: string;
  redisUrl: string;
  containers: StartedTestContainer[];
}> {
  const containers: StartedTestContainer[] = [];
  let databaseUrl = process.env.WEB_E2E_DATABASE_URL;
  let redisUrl = process.env.WEB_E2E_REDIS_URL;
  if (!databaseUrl) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('suskii_web_e2e')
      .withUsername('suskii')
      .withPassword('suskii_web_e2e')
      .start();
    containers.push(postgres);
    databaseUrl = postgres.getConnectionUri();
  }
  if (!redisUrl) {
    const { RedisContainer } = await import('@testcontainers/redis');
    const redis = await new RedisContainer('redis:7.4-alpine').start();
    containers.push(redis);
    redisUrl = redis.getConnectionUrl();
  }
  return { databaseUrl, redisUrl, containers };
}

/** Applies the migrations and the idempotent reference-data seed with the API's Prisma CLI. */
function migrateAndSeed(databaseUrl: string): void {
  const prismaCli = createRequire(join(API_DIR, 'package.json')).resolve('prisma/build/index.js');
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    // The seed runs through `tsx` from the API package's .bin directory.
    PATH: `${join(API_DIR, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`,
    SEED_ADMIN_EMAIL: '',
    SEED_ADMIN_PASSWORD: '',
  };
  for (const args of [
    ['migrate', 'deploy'],
    ['db', 'seed'],
  ]) {
    execFileSync(process.execPath, [prismaCli, ...args], { cwd: API_DIR, env, stdio: 'pipe' });
  }
}

export async function startStack(): Promise<Stack> {
  mkdirSync(LOG_DIR, { recursive: true });
  await assertPortFree(API_PORT, 'API');
  await assertPortFree(WEB_PORT, 'web');

  const { databaseUrl, redisUrl, containers } = await startDataServices();
  const children: ChildProcess[] = [];
  const stop = async () => {
    await Promise.all(children.reverse().map(stopProcess));
    await Promise.all(containers.map((container) => container.stop()));
  };

  try {
    migrateAndSeed(databaseUrl);

    // A throwaway service token per run; NODE_ENV=test keeps the repo .env out of the processes.
    const internalToken = randomBytes(32).toString('base64url');
    const apiUrl = `http://localhost:${API_PORT}`;
    const webUrl = `http://localhost:${WEB_PORT}`;
    const base = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' } as const;

    const api = start('api', ['dist/main.js'], API_DIR, {
      ...base,
      API_PORT: String(API_PORT),
      LOG_LEVEL: 'info',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      INTERNAL_API_TOKEN: internalToken,
      CORS_ORIGINS: webUrl,
      WEB_APP_URL: webUrl,
      EMAIL_PROVIDER: 'mock',
      HIBP_ENABLED: 'false',
      // Lagos-Dubai fares rise 5% at the re-check before payment (price-change consent test).
      MOCK_REPRICE_RULES: PRICE_CHANGE_ROUTE_RULE,
      OBJECT_STORAGE_DIR: join(LOG_DIR, 'objects'),
    });
    children.push(api);
    await waitFor(`${apiUrl}/ready`, api, 'api');

    await run('worker-refresh', ['dist/refresh-once.js'], WORKER_DIR, {
      ...base,
      LOG_LEVEL: 'info',
      REDIS_URL: redisUrl,
      API_INTERNAL_URL: apiUrl,
      INTERNAL_API_TOKEN: internalToken,
    });

    const web = start(
      'web',
      [join(WEB_DIR, 'node_modules/next/dist/bin/next'), 'start', '--port', String(WEB_PORT)],
      WEB_DIR,
      { ...base, NODE_ENV: 'production', API_INTERNAL_URL: apiUrl, NEXT_TELEMETRY_DISABLED: '1' },
    );
    children.push(web);
    await waitFor(`${webUrl}/robots.txt`, web, 'web');
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}
