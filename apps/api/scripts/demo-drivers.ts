/**
 * Demo drivers for trying rides on a local or test stack (ADR-056). Sample drivers from
 * `db:seed:demo` come online near each waiting ride, accept it, drive to the pick-up and along the
 * route, and complete it, through the same services as a driver's phone. When a driver arrives,
 * type the PIN shown in the rider's app (as a real driver hears it from the rider), in the terminal
 * or, with DEMO_DRIVERS_PIN_PORT and no terminal, on a local page (`/demo-drivers`). Refuses to
 * run with NODE_ENV=production. Needs the API's build output (`pnpm build`, or `pnpm dev` running)
 * and its configuration (the repo .env in development).
 *
 *   pnpm --filter @suskii/api rides:demo                # 25 m/s, a tick every 2 seconds
 *   pnpm --filter @suskii/api rides:demo --speed 40 --interval 1
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { NestFactory } from '@nestjs/core';

import type * as AppModuleSource from '../src/app.module';
import type * as ConfigSource from '../src/config/config';
import type * as PrismaSource from '../src/infra/prisma.service';
import type * as DispatchSource from '../src/rides/ride-dispatch.service';
import type * as DriverSource from '../src/rides/ride-driver.service';

import { createPinPage, PIN_PAGE_PATH } from './demo-driver-pin-page';
import {
  DemoDriverSimulator,
  describeError,
  MAX_DEMO_SPEED,
  type PinSource,
} from './demo-driver-simulator';

const DIST = resolve(__dirname, '../dist');

/**
 * A module from the API's build output, typed by its source. Nest's injection needs the
 * decorator metadata tsc emits, which tsx (esbuild) does not.
 */
async function built<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(resolve(DIST, path)).href)) as T;
}

const say = (line: string): void => {
  process.stdout.write(`[demo drivers] ${line}\n`);
};

/** Without a terminal nobody can read the PIN out; drivers wait at the pick-up. */
const noPins: PinSource = {
  pinFor: () => {
    say('A driver is waiting for the PIN: run rides:demo in a terminal to type it');
    return Promise.resolve(null);
  },
};

/**
 * Asks in the terminal, one ride at a time; an empty answer skips for now. Once the input closes
 * (Ctrl+D, or the stack shutting down) drivers simply wait, as without a terminal. Lines are read
 * in the terminal's own (cooked) mode: raw mode would swallow Ctrl+C, which must still stop this
 * process and, under `e2e:stack`, the whole stack.
 */
function terminalPins(): { pins: PinSource; close: () => void } {
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  let closed = false;
  prompt.once('close', () => {
    closed = true;
  });
  let queue: Promise<unknown> = Promise.resolve();
  return {
    pins: {
      pinFor: (ride) => {
        if (closed) return noPins.pinFor(ride);
        const asked = queue.then(() =>
          prompt.question(
            `[demo drivers] PIN for the ride at ${ride.pickupLabel} (Enter to skip): `,
          ),
        );
        queue = asked.catch(() => undefined);
        return asked.then(
          (answer) => answer.trim() || null,
          () => null,
        );
      },
    },
    close: () => prompt.close(),
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('rides:demo drives sample drivers and never runs in production');
  }
  const { values } = parseArgs({
    options: {
      speed: { type: 'string', default: '25' },
      interval: { type: 'string', default: '2' },
    },
  });
  const speed = Number(values.speed);
  const intervalMs = Number(values.interval) * 1000;
  if (!(speed >= 1 && speed <= MAX_DEMO_SPEED) || !(intervalMs >= 500 && intervalMs <= 10_000)) {
    throw new Error(`--speed is 1 to ${MAX_DEMO_SPEED} m/s and --interval 0.5 to 10 seconds`);
  }
  if (!existsSync(resolve(DIST, 'app.module.js'))) {
    throw new Error('rides:demo runs the API build: run pnpm --filter @suskii/api build first');
  }
  const [{ AppModule }, { loadConfig, loadDevelopmentEnvFile }, { PrismaService }] =
    await Promise.all([
      built<typeof AppModuleSource>('app.module.js'),
      built<typeof ConfigSource>('config/config.js'),
      built<typeof PrismaSource>('infra/prisma.service.js'),
    ]);
  const [{ RideDispatchService }, { RideDriverService }] = await Promise.all([
    built<typeof DispatchSource>('rides/ride-dispatch.service.js'),
    built<typeof DriverSource>('rides/ride-driver.service.js'),
  ]);
  loadDevelopmentEnvFile();
  // Without them each process makes its own ephemeral keys, and what the API encrypted (a rider's
  // emergency contacts, a booking's contact details) would not decrypt here.
  if (!process.env.HMAC_SECRET || !process.env.FIELD_ENCRYPTION_KEY) {
    throw new Error(
      'rides:demo needs the HMAC_SECRET and FIELD_ENCRYPTION_KEY the API runs with ' +
        '(pnpm --filter @suskii/api keys:generate prints a set for .env)',
    );
  }
  // The API's own request and job logs would bury the prompts.
  process.env.LOG_LEVEL ??= 'warn';
  const config = loadConfig();
  // Checked again now that .env is loaded, before anything connects.
  if (config.NODE_ENV === 'production') {
    throw new Error('rides:demo drives sample drivers and never runs in production');
  }
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const samples = await prisma.driver.count({ where: { sample: true, status: 'approved' } });
  if (samples === 0) {
    await app.close();
    throw new Error('No sample drivers: run pnpm --filter @suskii/api db:seed:demo first');
  }
  const terminal = process.stdin.isTTY ? terminalPins() : null;
  // Without a terminal (the hosted test server, ADR-066), a local page takes the PIN instead.
  const pinPort = Number(process.env.DEMO_DRIVERS_PIN_PORT ?? 0);
  const web = !terminal && pinPort > 0 ? createPinPage() : null;
  if (web) {
    await new Promise<void>((resolve) => web.server.listen(pinPort, '127.0.0.1', resolve));
    say(`Type the rider's PIN at ${PIN_PAGE_PATH} on the test server`);
  }
  const simulator = new DemoDriverSimulator({
    prisma,
    drivers: app.get(RideDriverService),
    dispatch: app.get(RideDispatchService),
    config,
    pins: terminal?.pins ?? web?.pins ?? noPins,
    report: say,
    speed,
  });
  say(`${samples} sample drivers ready; waiting for ride requests (Ctrl+C to stop)`);

  let running = true;
  const stop = (): void => {
    running = false;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  while (running) {
    try {
      await simulator.tick();
    } catch (error) {
      say(`tick failed: ${describeError(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const offline = await simulator.stop();
  say(`${offline} idle drivers went offline`);
  terminal?.close();
  web?.server.close();
  await app.close();
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
