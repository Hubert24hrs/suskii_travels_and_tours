#!/usr/bin/env node
/**
 * Post-deploy smoke tests (ADR-060): run after every deploy, by the pipelines, the compose release
 * rehearsal and by hand. Waits for the API to be ready, then checks the API, website and console
 * answer with their security headers and the seeded reference data. Reads only public routes, so
 * it is safe against production.
 *
 *   node scripts/smoke.mjs --api https://api.example.com --web https://www.example.com \
 *     --admin https://admin.example.com [--wait 120]
 *
 * Exits 1 with one line per failed check. Never prints response bodies.
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    api: { type: 'string' },
    web: { type: 'string' },
    admin: { type: 'string' },
    wait: { type: 'string', default: '120' },
  },
});
if (!values.api) {
  process.stderr.write('smoke: --api is required (--web and --admin are optional)\n');
  process.exit(2);
}

const TIMEOUT_MS = 10_000;
const results = [];

const get = (url) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });

async function check(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({
      name,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** Polls a URL until it answers 200 or the wait runs out (a fresh revision may still be starting). */
async function waitFor(url, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const response = await get(url);
      if (response.status === 200) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.name : 'error';
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${url} not ready after ${seconds}s (${last})`);
}

const api = values.api.replace(/\/$/, '');
await check('api ready', () => waitFor(`${api}/ready`, Number(values.wait)));
await check('api health', async () => {
  const response = await get(`${api}/health`);
  expect(response.status === 200, `status ${response.status}`);
  expect(response.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
});
await check('api reference data (countries)', async () => {
  const response = await get(`${api}/v1/catalog/countries`);
  expect(response.status === 200, `status ${response.status}`);
  const body = await response.json();
  const countries = Array.isArray(body) ? body : (body.countries ?? body.items ?? []);
  expect(countries.length > 100, 'fewer than 100 countries: was the seed applied?');
});
await check('api cars features', async () => {
  const response = await get(`${api}/v1/cars/features`);
  expect(response.status === 200, `status ${response.status}`);
  const body = await response.json();
  expect(typeof body.buses === 'boolean', 'unexpected shape');
});
await check('api unknown route is a problem document', async () => {
  const response = await get(`${api}/v1/does-not-exist`);
  expect(response.status === 404, `status ${response.status}`);
  expect(
    (response.headers.get('content-type') ?? '').includes('application/problem+json'),
    'not application/problem+json',
  );
});

if (values.web) {
  const web = values.web.replace(/\/$/, '');
  await check('web home', async () => {
    const response = await get(`${web}/`);
    expect(response.status === 200, `status ${response.status}`);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp.includes("'nonce-"), 'no nonce CSP');
    expect(response.headers.get('x-frame-options') === 'DENY', 'missing X-Frame-Options');
  });
  await check('web robots.txt', async () => {
    const response = await get(`${web}/robots.txt`);
    expect(response.status === 200, `status ${response.status}`);
  });
}

if (values.admin) {
  const admin = values.admin.replace(/\/$/, '');
  await check('admin sign-in', async () => {
    const response = await get(`${admin}/sign-in`);
    expect(response.status === 200, `status ${response.status}`);
    expect(
      (response.headers.get('x-robots-tag') ?? '').includes('noindex'),
      'console is indexable',
    );
  });
}

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  process.stdout.write(
    `${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.ok ? '' : `: ${result.reason}`}\n`,
  );
}
process.stdout.write(`smoke: ${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
