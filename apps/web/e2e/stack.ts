import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { delimiter, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

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

/** Placeholder app identities for the association-file tests; not real store identities. */
export const TEST_APP = {
  androidPackage: 'com.suskii.travels.e2e',
  androidFingerprint: Array.from({ length: 32 }, () => 'AB').join(':'),
  appleAppId: 'TEAMID1234.com.suskii.travels.e2e',
} as const;

/**
 * The API listens on the port of the inlined API URL, unless E2E_API_PORT names another: the
 * hosted test server (ADR-066) inlines its public https address and reaches the API through a
 * local proxy.
 */
export const API_PORT = Number(
  process.env.E2E_API_PORT ??
    (new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').port || 80),
);

/**
 * Supplier settings for the API: the mocks, unless E2E_FLIGHT_SUPPLIERS / E2E_HOTEL_SUPPLIERS ask
 * for others. Duffel runs in test mode only (ADR-062): its token comes from DUFFEL_API_TOKEN in the
 * shell or the repository's root .env, and anything but a `duffel_test_` token is refused.
 */
function supplierEnv(): Record<string, string> {
  const flights = process.env.E2E_FLIGHT_SUPPLIERS;
  const hotels = process.env.E2E_HOTEL_SUPPLIERS;
  const settings: Record<string, string> = {
    ...(flights ? { FLIGHT_SUPPLIERS: flights } : {}),
    ...(hotels ? { HOTEL_SUPPLIERS: hotels } : {}),
  };
  const duffel = [flights, hotels].some((list) => list?.split(',').includes('duffel'));
  if (!duffel) return settings;
  const rootEnvFile = join(ROOT, '.env');
  const token =
    process.env.DUFFEL_API_TOKEN ??
    (existsSync(rootEnvFile)
      ? parseEnv(readFileSync(rootEnvFile, 'utf8')).DUFFEL_API_TOKEN
      : undefined);
  if (!token?.startsWith('duffel_test_')) {
    throw new Error(
      'E2E_FLIGHT_SUPPLIERS / E2E_HOTEL_SUPPLIERS=duffel need DUFFEL_API_TOKEN set to a Duffel ' +
        'test token (duffel_test_...), in the shell or the root .env.',
    );
  }
  return { ...settings, DUFFEL_API_TOKEN: token };
}

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

function start(
  name: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  /** Share this terminal (input included) instead of writing a log file. */
  interactive = false,
): ChildProcess {
  if (interactive) return spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
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

/**
 * Applies the migrations and the idempotent reference-data seed with the API's Prisma CLI, then
 * the sample in-house inventory (packages, tours, add-ons, visa) the phase 8 journeys book.
 */
function migrateAndSeed(databaseUrl: string, keys: Record<string, string>): void {
  const apiRequire = createRequire(join(API_DIR, 'package.json'));
  const prismaCli = apiRequire.resolve('prisma/build/index.js');
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    // The seed runs through `tsx` from the API package's .bin directory.
    PATH: `${join(API_DIR, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`,
    SEED_ADMIN_EMAIL: '',
    SEED_ADMIN_PASSWORD: '',
    ...keys,
  };
  for (const args of [
    ['migrate', 'deploy'],
    ['db', 'seed'],
  ]) {
    execFileSync(process.execPath, [prismaCli, ...args], { cwd: API_DIR, env, stdio: 'pipe' });
  }
  // `node <tsx cli>` rather than the .bin shim, which is a .cmd file on Windows.
  execFileSync(process.execPath, [apiRequire.resolve('tsx/cli'), 'prisma/seed-demo.ts'], {
    cwd: API_DIR,
    env,
    stdio: 'pipe',
  });
}

/**
 * Test ids for the ad tags (ADR-079): Playwright runs turn them on, so the first-visit prompt and
 * the tags are tested; the hosted test server leaves them off, so phones never reach Meta or
 * TikTok. Tests never do either: fixtures.ts refuses the networks' hosts unless a test stubs them.
 */
export const TEST_AD_TAGS = { META_PIXEL_ID: '1234567890', TIKTOK_PIXEL_ID: 'C0SUSKIITEST01' };

export async function startStack(options: { adTags?: boolean } = {}): Promise<Stack> {
  mkdirSync(LOG_DIR, { recursive: true });
  await assertPortFree(API_PORT, 'API');
  await assertPortFree(WEB_PORT, 'web');

  const { databaseUrl, redisUrl, containers } = await startDataServices();
  // Throwaway keys for this run, shared by the seed, the API and the demo drivers, so each
  // process reads what the others encrypted or hashed.
  const keys = {
    HMAC_SECRET: randomBytes(32).toString('base64url'),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  const children: ChildProcess[] = [];
  const stop = async () => {
    await Promise.all(children.reverse().map(stopProcess));
    await Promise.all(containers.map((container) => container.stop()));
  };

  try {
    migrateAndSeed(databaseUrl, keys);
    // The seed gives rows new ids each run: API reads cached on disk by an earlier run (a bus
    // trip, a rental car) would point at rows that no longer exist.
    rmSync(join(WEB_DIR, '.next/cache/fetch-cache'), { recursive: true, force: true });

    // A throwaway service token per run; NODE_ENV=test keeps the repo .env out of the processes.
    const internalToken = randomBytes(32).toString('base64url');
    const apiUrl = `http://localhost:${API_PORT}`;
    const webUrl = `http://localhost:${WEB_PORT}`;
    // A device that reaches the web app through another origin (an emulator without
    // `adb reverse` uses http://10.0.2.2:3000) needs hosted checkout and return URLs there.
    const publicWebUrl = process.env.E2E_PUBLIC_WEB_URL ?? webUrl;
    const base = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' } as const;

    const apiEnv = {
      ...base,
      API_PORT: String(API_PORT),
      LOG_LEVEL: 'info',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      INTERNAL_API_TOKEN: internalToken,
      ...keys,
      CORS_ORIGINS: [...new Set([webUrl, publicWebUrl])].join(','),
      WEB_APP_URL: publicWebUrl,
      EMAIL_PROVIDER: 'mock',
      HIBP_ENABLED: 'false',
      // Google and Apple buttons work on test stacks through the mock provider (ADR-067).
      SOCIAL_MOCK_ENABLED: 'true',
      // Lagos-Dubai fares rise 5% at the re-check before payment (price-change consent test).
      MOCK_REPRICE_RULES: PRICE_CHANGE_ROUTE_RULE,
      // Mock suppliers unless a tester opts in to Duffel's test mode (phone and browser testing).
      ...supplierEnv(),
      OBJECT_STORAGE_DIR: join(LOG_DIR, 'objects'),
      // The mobile e2e job enforces (mock) device attestation for app requests (ADR-023).
      ATTESTATION_MODE: process.env.E2E_ATTESTATION_MODE ?? 'off',
      // The k6 load test (load/k6) measures capacity, not the per-IP limits (ADR-045).
      ...(process.env.E2E_RATE_LIMIT_ENABLED
        ? { RATE_LIMIT_ENABLED: process.env.E2E_RATE_LIMIT_ENABLED }
        : {}),
      // Behind Cloudflare's tunnel every request comes from the local proxy; the edge's header
      // names the visitor, so each phone gets its own rate limits (ADR-066).
      ...(process.env.E2E_CLIENT_IP_HEADER
        ? { CLIENT_IP_HEADER: process.env.E2E_CLIENT_IP_HEADER }
        : {}),
    };
    const api = start('api', ['dist/main.js'], API_DIR, apiEnv);
    children.push(api);
    await waitFor(`${apiUrl}/ready`, api, 'api');

    const workerEnv = {
      ...base,
      LOG_LEVEL: 'info',
      REDIS_URL: redisUrl,
      API_INTERNAL_URL: apiUrl,
      INTERNAL_API_TOKEN: internalToken,
    };
    await run('worker-refresh', ['dist/refresh-once.js'], WORKER_DIR, workerEnv);
    // A long-running stack (the hosted test server) also runs the worker's sweeps: expiry,
    // ticketing retries, installments, reminders and ride dispatch.
    if (process.env.E2E_WORKER === 'true') {
      children.push(start('worker', ['dist/main.js'], WORKER_DIR, workerEnv));
    }

    const web = start(
      'web',
      [join(WEB_DIR, 'node_modules/next/dist/bin/next'), 'start', '--port', String(WEB_PORT)],
      WEB_DIR,
      {
        ...base,
        NODE_ENV: 'production',
        API_INTERNAL_URL: apiUrl,
        NEXT_TELEMETRY_DISABLED: '1',
        // Test identities for the app-link association files (see mobile.spec.ts).
        MOBILE_ANDROID_PACKAGE: TEST_APP.androidPackage,
        MOBILE_ANDROID_CERT_SHA256: TEST_APP.androidFingerprint,
        MOBILE_IOS_APP_IDS: TEST_APP.appleAppId,
        ...(options.adTags ? TEST_AD_TAGS : {}),
      },
    );
    children.push(web);
    await waitFor(`${webUrl}/robots.txt`, web, 'web');

    // Sample drivers that take rides requested from a phone (ADR-056), with the API's settings.
    // In a terminal they share it, so the tester can type the PIN the rider's app shows.
    if (process.env.E2E_DEMO_DRIVERS === 'true') {
      const apiRequire = createRequire(join(API_DIR, 'package.json'));
      children.push(
        start(
          'demo-drivers',
          [apiRequire.resolve('tsx/cli'), 'scripts/demo-drivers.ts'],
          API_DIR,
          {
            ...apiEnv,
            LOG_LEVEL: 'warn',
            // Without a terminal, a local page takes the rider's PIN (the hosted test server).
            ...(process.env.E2E_DEMO_DRIVERS_PIN_PORT
              ? { DEMO_DRIVERS_PIN_PORT: process.env.E2E_DEMO_DRIVERS_PIN_PORT }
              : {}),
          },
          process.stdin.isTTY,
        ),
      );
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}
