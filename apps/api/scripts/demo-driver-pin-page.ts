import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { ridePinSchema } from '@suskii/shared';

import type { PinSource } from './demo-driver-simulator';

/** A driver gives up waiting for the PIN after this long and asks again later. */
const WAIT_MS = 10 * 60_000;
const MAX_BODY_BYTES = 1024;
export const PIN_PAGE_PATH = '/demo-drivers';

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;

function page(message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Demo drivers</title></head>
<body>
<h1>Demo drivers</h1>
<p>${message}</p>
<form method="post" action="${PIN_PAGE_PATH}">
<label for="pin">PIN shown in the rider's app</label><br>
<input id="pin" name="pin" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}" maxlength="4" required>
<button type="submit">Send PIN</button>
</form>
<p>Sample drivers take rides on this test server. When one reaches the pick-up, type the PIN the
rider's app shows, as a real driver hears it from the rider.</p>
</body>
</html>`;
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/**
 * The PIN source for a stack without a terminal, such as the hosted test server (ADR-066): a
 * small page where the tester types the PIN the rider's app shows, as a driver hears it. Like the
 * terminal prompt, it never reads the PIN itself; the API's attempt counter and lockout apply to
 * every PIN typed here. It listens on 127.0.0.1 behind the test server's proxy.
 */
export function createPinPage(waitMs: number = WAIT_MS): { pins: PinSource; server: Server } {
  /** Drivers at a pick-up, oldest first, each waiting for a PIN typed on the page. */
  const waiting = new Map<string, (pin: string | null) => void>();

  const pins: PinSource = {
    // Holds the driver until a PIN arrives, as the terminal prompt does, so it is tried at once.
    pinFor: (ride) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(ride.id);
          resolve(null);
        }, waitMs);
        timer.unref();
        waiting.set(ride.id, (pin) => {
          clearTimeout(timer);
          waiting.delete(ride.id);
          resolve(pin);
        });
      }),
  };

  const answer = (res: ServerResponse, status: number, message: string): void => {
    res.writeHead(status, HEADERS);
    res.end(page(message));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PIN_PAGE_PATH) {
      answer(res, 404, 'Not found.');
      return;
    }
    if (req.method === 'GET') {
      const status = url.searchParams.has('sent')
        ? 'PIN sent. If it matches, the trip starts within a few seconds.'
        : waiting.size > 0
          ? 'A driver is waiting at the pick-up for the PIN.'
          : 'No driver is waiting for a PIN right now.';
      answer(res, 200, status);
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'GET, POST' });
      res.end();
      return;
    }
    void readBody(req).then((body) => {
      const pin = body === null ? null : new URLSearchParams(body).get('pin')?.trim();
      if (!pin || !ridePinSchema.safeParse(pin).success) {
        answer(res, 400, 'A PIN is four digits; try again.');
        return;
      }
      // The driver who has waited longest takes it (one tester per ride on a test server).
      const first = waiting.values().next();
      if (first.done) {
        answer(res, 409, 'No driver is waiting for a PIN right now.');
        return;
      }
      first.value(pin);
      res.writeHead(303, { location: `${PIN_PAGE_PATH}?sent=1`, 'cache-control': 'no-store' });
      res.end();
    });
  });

  return { pins, server };
}
