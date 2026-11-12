#!/usr/bin/env node
/**
 * Gives a value to every secret the backend reads that can be generated, straight into Secret
 * Manager (ADR-110). A secret that already has a value is left alone, so this is safe to run
 * again. Nothing is printed but names, and nothing is written to disk: each value goes from this
 * process to `gcloud` through a pipe.
 *
 *   node scripts/gcp/seed-secrets.mjs --project <project id> --documents-account <email>
 *
 * With --passwords it also generates the passwords of the PostgreSQL roles and of Redis, for
 * the backend that runs its own on one VM (ADR-111).
 *
 * It needs only Node (Cloud Shell has it) and an authenticated gcloud. The values are the ones
 * `pnpm --filter @suskii/api keys:generate` prints (apps/api/scripts/generate-secrets.ts): keep
 * the two in step.
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    'documents-account': { type: 'string' },
    passwords: { type: 'boolean', default: false },
  },
});
const project = values.project;
if (!project) {
  process.stderr.write('usage: seed-secrets.mjs --project <id> [--documents-account <email>]\n');
  process.exit(2);
}

const gcloud = (args, input) =>
  execFileSync('gcloud', [...args, '--project', project], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  });

/** Whether a secret has at least one enabled version. */
function hasValue(name) {
  const listed = gcloud([
    'secrets',
    'versions',
    'list',
    name,
    '--filter=state=ENABLED',
    '--limit=1',
    '--format=value(name)',
  ]);
  return listed.trim() !== '';
}

function put(name, value) {
  gcloud(['secrets', 'versions', 'add', name, '--data-file=-'], value);
  process.stdout.write(`  set   ${name}\n`);
}

function putIfMissing(name, make) {
  if (hasValue(name)) {
    process.stdout.write(`  kept  ${name}\n`);
    return;
  }
  put(name, make());
}

const base64Pem = (pem) => Buffer.from(pem).toString('base64');
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Letters and digits only, so the value needs no escaping inside a connection address. */
function password(length = 40) {
  let out = '';
  while (out.length < length) {
    const byte = randomBytes(1)[0];
    // 248 is the largest multiple of 62 below 256: every character is equally likely.
    if (byte < 248) out += ALPHANUMERIC[byte % ALPHANUMERIC.length];
  }
  return out;
}
const privatePem = (key) => base64Pem(key.export({ type: 'pkcs8', format: 'pem' }).toString());

// The access-token signing pair is one thing: both halves, or neither.
const [hasPrivate, hasPublic] = [hasValue('JWT_PRIVATE_KEY'), hasValue('JWT_PUBLIC_KEY')];
if (hasPrivate !== hasPublic) {
  process.stderr.write(
    'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY: one has a value and the other has none. Give both a matching pair by hand (infra/terraform/README.md) and run this again.\n',
  );
  process.exit(1);
}
if (hasPrivate) {
  process.stdout.write('  kept  JWT_PRIVATE_KEY\n  kept  JWT_PUBLIC_KEY\n');
} else {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  put('JWT_PRIVATE_KEY', privatePem(privateKey));
  put('JWT_PUBLIC_KEY', base64Pem(publicKey.export({ type: 'spki', format: 'pem' }).toString()));
}

putIfMissing('FIELD_ENCRYPTION_KEY', () => randomBytes(32).toString('base64'));
putIfMissing('HMAC_SECRET', () => token(48));
putIfMissing('CARS_TICKET_SIGNING_KEY', () =>
  privatePem(generateKeyPairSync('ed25519').privateKey),
);
putIfMissing('INTERNAL_API_TOKEN', () => token());
// Between the API and the agent service (ADR-101): two different values.
putIfMissing('AGENT_RUN_TOKEN', () => token());
putIfMissing('AGENT_TOOLS_TOKEN', () => token());
// Cloudflare's documented test secret, which accepts every answer: this environment has no
// website yet, and the app proves itself with its device attestation instead. A real widget's
// secret replaces it when the website goes live.
putIfMissing('TURNSTILE_SECRET_KEY', () => '1x0000000000000000000000000000000AA');

// The documents bucket is reached with an HMAC key of a storage-only identity. Its secret is
// shown once, at creation, so the pair is made and stored in one step.
const [hasId, hasSecret] = [
  hasValue('OBJECT_STORAGE_ACCESS_KEY_ID'),
  hasValue('OBJECT_STORAGE_SECRET_ACCESS_KEY'),
];
if (hasId && hasSecret) {
  process.stdout.write(
    '  kept  OBJECT_STORAGE_ACCESS_KEY_ID\n  kept  OBJECT_STORAGE_SECRET_ACCESS_KEY\n',
  );
} else {
  const account = values['documents-account'];
  if (!account) {
    process.stderr.write('The documents bucket key is missing: pass --documents-account.\n');
    process.exit(1);
  }
  const created = JSON.parse(gcloud(['storage', 'hmac', 'create', account, '--format=json']));
  const accessId = created.metadata?.accessId ?? created.accessId;
  if (!accessId || !created.secret) {
    process.stderr.write('gcloud returned no HMAC key for the documents identity.\n');
    process.exit(1);
  }
  put('OBJECT_STORAGE_ACCESS_KEY_ID', accessId);
  put('OBJECT_STORAGE_SECRET_ACCESS_KEY', created.secret);
}

// The backend on one VM runs its own PostgreSQL and Redis: their passwords are generated too.
if (values.passwords) {
  for (const name of [
    'POSTGRES_OWNER_PASSWORD',
    'POSTGRES_APP_PASSWORD',
    'POSTGRES_AGENT_PASSWORD',
    'REDIS_PASSWORD',
  ]) {
    putIfMissing(name, password);
  }
}
