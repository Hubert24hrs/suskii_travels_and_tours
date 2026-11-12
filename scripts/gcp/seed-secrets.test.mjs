import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const SCRIPT = join(import.meta.dirname, 'seed-secrets.mjs');

/**
 * A stand-in for gcloud: it keeps what it was given in a JSON file, answers "versions list"
 * from it, and returns a fixed HMAC key. No call leaves this machine.
 */
function fakeGcloud(dir) {
  const store = join(dir, 'store.json');
  writeFileSync(store, JSON.stringify({ secrets: {}, calls: [] }));
  const bin = join(dir, 'gcloud');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(${JSON.stringify(store)}, 'utf8'));
state.calls.push(args.join(' '));
const save = () => fs.writeFileSync(${JSON.stringify(store)}, JSON.stringify(state));
if (args[0] === 'secrets' && args[2] === 'list') {
  save();
  process.stdout.write(state.secrets[args[3]] ? 'projects/p/secrets/x/versions/1\\n' : '');
} else if (args[0] === 'secrets' && args[2] === 'add') {
  state.secrets[args[3]] = fs.readFileSync(0, 'utf8');
  save();
} else if (args[0] === 'storage' && args[1] === 'hmac') {
  save();
  process.stdout.write(JSON.stringify({ metadata: { accessId: 'GOOG1EXAMPLE' }, secret: 'hmac-secret-value' }));
} else {
  save();
  process.exit(3);
}
`,
  );
  chmodSync(bin, 0o755);
  return { store, read: () => JSON.parse(readFileSync(store, 'utf8')) };
}

function run(
  dir,
  args = ['--project', 'p', '--documents-account', 'docs@p.iam.gserviceaccount.com'],
) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
  });
}

const NAMES = [
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'FIELD_ENCRYPTION_KEY',
  'HMAC_SECRET',
  'CARS_TICKET_SIGNING_KEY',
  'INTERNAL_API_TOKEN',
  'AGENT_RUN_TOKEN',
  'AGENT_TOOLS_TOKEN',
  'TURNSTILE_SECRET_KEY',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
];

test('gives every generated secret a value, and prints names only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-secrets-'));
  try {
    const gcloud = fakeGcloud(dir);
    const printed = run(dir);
    const { secrets } = gcloud.read();
    assert.deepEqual(Object.keys(secrets).sort(), [...NAMES].sort());

    // A matching Ed25519 pair, as base64 of the PEM (what the API reads).
    const pem = (name) => Buffer.from(secrets[name], 'base64').toString();
    assert.match(pem('JWT_PRIVATE_KEY'), /^-----BEGIN PRIVATE KEY-----/);
    assert.match(pem('JWT_PUBLIC_KEY'), /^-----BEGIN PUBLIC KEY-----/);
    assert.match(pem('CARS_TICKET_SIGNING_KEY'), /^-----BEGIN PRIVATE KEY-----/);
    assert.equal(Buffer.from(secrets.FIELD_ENCRYPTION_KEY, 'base64').length, 32);
    // The two tokens between the API and the agent service are different values.
    assert.notEqual(secrets.AGENT_RUN_TOKEN, secrets.AGENT_TOOLS_TOKEN);
    assert.notEqual(secrets.AGENT_RUN_TOKEN, secrets.INTERNAL_API_TOKEN);
    assert.equal(secrets.OBJECT_STORAGE_ACCESS_KEY_ID, 'GOOG1EXAMPLE');
    assert.equal(secrets.OBJECT_STORAGE_SECRET_ACCESS_KEY, 'hmac-secret-value');

    // Nothing of a value reaches the terminal.
    for (const value of Object.values(secrets)) {
      if (value.length > 12) assert.equal(printed.includes(value), false);
    }
    assert.match(printed, /set {3}JWT_PRIVATE_KEY/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves a secret that has a value alone when run again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-secrets-'));
  try {
    const gcloud = fakeGcloud(dir);
    run(dir);
    const first = gcloud.read().secrets;
    const printed = run(dir);
    assert.deepEqual(gcloud.read().secrets, first);
    assert.equal(/ set /.test(printed), false);
    assert.match(printed, /kept {2}HMAC_SECRET/);
    // No second HMAC key was made for the documents bucket.
    assert.equal(gcloud.read().calls.filter((call) => call.startsWith('storage hmac')).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stops when only half of the signing pair exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-secrets-'));
  try {
    const gcloud = fakeGcloud(dir);
    const state = gcloud.read();
    state.secrets.JWT_PRIVATE_KEY = 'existing';
    writeFileSync(gcloud.store, JSON.stringify(state));
    assert.throws(() => run(dir), /one has a value and the other has none/);
    assert.deepEqual(Object.keys(gcloud.read().secrets), ['JWT_PRIVATE_KEY']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("covers every secret the API's own generator prints", () => {
  // The two files generate the same values; a secret added to one must reach the other.
  const generator = readFileSync(
    join(import.meta.dirname, '../../apps/api/scripts/generate-secrets.ts'),
    'utf8',
  );
  const printed = [...generator.matchAll(/`([A-Z][A-Z0-9_]+)=\$\{/g)].map((match) => match[1]);
  assert.ok(printed.length >= 7);
  for (const name of printed) assert.ok(NAMES.includes(name), `${name} is not seeded`);
});
