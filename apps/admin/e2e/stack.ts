import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { delimiter, join, resolve } from 'node:path';

import type { StartedTestContainer } from 'testcontainers';

import { LOG_DIR, STATE_FILE } from './personas';
import { provision } from './provision';

/**
 * Boots the platform for the admin e2e tests: Postgres and Redis (Testcontainers, or a new
 * database on the server named by ADMIN_E2E_DATABASE_URL and the Redis at ADMIN_E2E_REDIS_URL),
 * the built API with the reference seed
 * and the demo inventory, the e2e accounts and bookings (provision.ts), and the built console.
 *
 * The console calls the API from the browser at the NEXT_PUBLIC_API_BASE_URL inlined at build
 * time (default http://localhost:4000), so the API listens on that port.
 */

const ROOT = resolve(__dirname, '../../..');
const API_DIR = join(ROOT, 'apps/api');
const ADMIN_DIR = join(ROOT, 'apps/admin');

export const ADMIN_PORT = 3001;
export const API_PORT = Number(
  new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').port || 80,
);
export const API_URL = `http://localhost:${API_PORT}`;

export interface Stack {
  stop: () => Promise<void>;
}

function assertPortFree(port: number, name: string): Promise<void> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} (${name}) is in use. Stop the local dev servers first.`)),
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

interface PgClient {
  connect: () => Promise<void>;
  query: (sql: string) => Promise<unknown>;
  end: () => Promise<void>;
}

/** Runs one statement on the server's maintenance database (pg from the API's dependencies). */
async function onServer(serverUrl: string, sql: string): Promise<void> {
  const apiRequire = createRequire(join(API_DIR, 'package.json'));
  const { Client } = apiRequire('pg') as {
    Client: new (config: { connectionString: string }) => PgClient;
  };
  const url = new URL(serverUrl);
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * Postgres and Redis for one run. With ADMIN_E2E_DATABASE_URL the run gets its own new database
 * on that server, dropped afterwards; nothing that was there before is touched.
 */
async function startDataServices(): Promise<{
  databaseUrl: string;
  redisUrl: string;
  cleanup: () => Promise<void>;
}> {
  const containers: StartedTestContainer[] = [];
  let databaseUrl: string;
  let dropDatabase: (() => Promise<void>) | null = null;
  const serverUrl = process.env.ADMIN_E2E_DATABASE_URL;
  if (serverUrl) {
    // A generated identifier, safe to interpolate.
    const name = `suskii_admin_e2e_${randomBytes(6).toString('hex')}`;
    await onServer(serverUrl, `CREATE DATABASE ${name}`);
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    databaseUrl = url.toString();
    dropDatabase = () => onServer(serverUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } else {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('suskii_admin_e2e')
      .withUsername('suskii')
      .withPassword('suskii_admin_e2e')
      .start();
    containers.push(postgres);
    databaseUrl = postgres.getConnectionUri();
  }
  let redisUrl = process.env.ADMIN_E2E_REDIS_URL;
  if (!redisUrl) {
    const { RedisContainer } = await import('@testcontainers/redis');
    const redis = await new RedisContainer('redis:7.4-alpine').start();
    containers.push(redis);
    redisUrl = redis.getConnectionUrl();
  }
  const cleanup = async () => {
    await Promise.all(containers.map((container) => container.stop()));
    await dropDatabase?.();
  };
  return { databaseUrl, redisUrl, cleanup };
}

/**
 * Migrations, the reference seed with a throwaway super admin (SEED_ADMIN_*, refused in
 * production) and the sample inventory the refund and visa journeys book.
 */
function migrateAndSeed(databaseUrl: string, root: { email: string; password: string }): void {
  const apiRequire = createRequire(join(API_DIR, 'package.json'));
  const prismaCli = apiRequire.resolve('prisma/build/index.js');
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PATH: `${join(API_DIR, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`,
    SEED_ADMIN_EMAIL: root.email,
    SEED_ADMIN_PASSWORD: root.password,
  };
  for (const args of [
    ['migrate', 'deploy'],
    ['db', 'seed'],
  ]) {
    execFileSync(process.execPath, [prismaCli, ...args], { cwd: API_DIR, env, stdio: 'pipe' });
  }
  execFileSync(process.execPath, [apiRequire.resolve('tsx/cli'), 'prisma/seed-demo.ts'], {
    cwd: API_DIR,
    env,
    stdio: 'pipe',
  });
}

export async function startStack(): Promise<Stack> {
  mkdirSync(LOG_DIR, { recursive: true });
  await assertPortFree(API_PORT, 'API');
  await assertPortFree(ADMIN_PORT, 'admin');

  const { databaseUrl, redisUrl, cleanup } = await startDataServices();
  const children: ChildProcess[] = [];
  const stop = async () => {
    await Promise.all(children.reverse().map(stopProcess));
    await cleanup();
    // The run's passwords and authenticator keys are useless now; do not leave them around.
    rmSync(STATE_FILE, { force: true });
  };

  try {
    const root = {
      email: 'root@e2e.suskii.test',
      password: `e2e-${randomBytes(12).toString('base64url')}-root`,
    };
    migrateAndSeed(databaseUrl, root);

    const adminUrl = `http://localhost:${ADMIN_PORT}`;
    // NODE_ENV=test keeps the repo .env out of the processes.
    const base = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' } as const;
    const api = start('api', ['dist/main.js'], API_DIR, {
      ...base,
      API_PORT: String(API_PORT),
      LOG_LEVEL: 'info',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      INTERNAL_API_TOKEN: randomBytes(32).toString('base64url'),
      CORS_ORIGINS: adminUrl,
      ADMIN_ORIGINS: adminUrl,
      EMAIL_PROVIDER: 'mock',
      HIBP_ENABLED: 'false',
      // Every persona signs in from 127.0.0.1 within a minute; the per-IP sign-in limits are
      // covered by the API e2e suite.
      RATE_LIMIT_ENABLED: 'false',
      OBJECT_STORAGE_DIR: join(LOG_DIR, 'objects'),
    });
    children.push(api);
    await waitFor(`${API_URL}/ready`, api, 'api');

    const state = await provision(API_URL, root);
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

    const admin = start(
      'admin',
      [join(ADMIN_DIR, 'node_modules/next/dist/bin/next'), 'start', '--port', String(ADMIN_PORT)],
      ADMIN_DIR,
      { ...base, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    );
    children.push(admin);
    await waitFor(`${adminUrl}/sign-in`, admin, 'admin');
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}
