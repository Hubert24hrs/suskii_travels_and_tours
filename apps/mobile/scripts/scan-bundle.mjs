#!/usr/bin/env node
/**
 * Fails when an app build contains a secret (ADR-024). Everything in a JS bundle or an APK is
 * readable by anyone who installs the app, so only public configuration may be in it.
 *
 * Checks every file under the given paths (an `expo export` output, an unzipped APK or an iOS
 * .app) for:
 *   1. well-known credential formats (private keys, provider secret keys, cloud keys, JWTs);
 *   2. names of server-side secret settings from .env.example (a sign of server config leaking
 *      into client code through `process.env`);
 *   3. the values of those settings when they are set in this environment (CI runs the scan with
 *      the e2e stack's throwaway secrets exported).
 *
 * Usage: node scripts/scan-bundle.mjs <file-or-directory>...
 *        node scripts/scan-bundle.mjs --self-test
 * Findings are printed redacted (first characters and length only).
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Credential formats. Built with `new RegExp` so this file is not itself flagged by scanners. */
const PATTERNS = [
  ['private key', String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`],
  ['Paystack or Stripe secret key', String.raw`\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}`],
  ['Stripe webhook secret', String.raw`\bwhsec_[0-9A-Za-z]{20,}`],
  ['Flutterwave secret key', String.raw`FLWSECK(?:_TEST)?-[0-9A-Za-z]{20,}-X`],
  ['Duffel access token', String.raw`\bduffel_(?:live|test)_[0-9A-Za-z_-]{20,}`],
  ['AWS access key id', String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`],
  ['Google API key', String.raw`\bAIza[0-9A-Za-z_-]{35}`],
  ['GitHub token', String.raw`\bgh[pousr]_[0-9A-Za-z]{36,}`],
  ['Slack token', String.raw`\bxox[abprs]-[0-9A-Za-z-]{10,}`],
  [
    'JSON Web Token',
    String.raw`\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}`,
  ],
  [
    'connection string with a password',
    String.raw`\b(?:postgres(?:ql)?|redis|rediss|mongodb(?:\+srv)?|amqps?):\/\/[^\s:@\/]+:[^\s@\/]+@`,
  ],
].map(([name, source]) => ({ name, regex: new RegExp(source, 'g') }));

const SECRET_NAME =
  /(SECRET|PRIVATE|PASSWORD|TOKEN|API_KEY|_KEY$|HMAC|WEBHOOK_HASH|DATABASE_URL|REDIS_URL)/;
// Public by design: client-side settings, JWT verification keys, analytics project keys.
const NOT_SECRET =
  /^(EXPO_PUBLIC_|NEXT_PUBLIC_)|_PUBLIC_KEYS?$|^POSTHOG_KEY$|_TTL_(SECONDS|DAYS)$|_KMS_KEY_ID$/;

/** Server-side secret setting names documented in .env.example. */
function secretSettingNames(envExample = join(ROOT, '.env.example')) {
  const names = new Set();
  for (const line of readFileSync(envExample, 'utf8').split('\n')) {
    const match = /^#?\s*([A-Z][A-Z0-9_]+)=/.exec(line);
    if (match?.[1] && SECRET_NAME.test(match[1]) && !NOT_SECRET.test(match[1])) names.add(match[1]);
  }
  return [...names];
}

const redact = (value) => `${value.slice(0, 4)}… (${value.length} chars)`;

function* files(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    yield path;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path)) yield* files(join(path, entry));
}

/** Values to look for: whole values, plus each long line of multi-line values (PEM keys). */
function secretValues(names, env) {
  const values = [];
  for (const name of names) {
    const value = env[name]?.trim();
    if (!value || value.length < 12) continue;
    values.push({ name, value });
    for (const line of value.replace(/\\n/g, '\n').split('\n')) {
      const part = line.trim();
      if (part.length >= 32 && part !== value && !part.startsWith('-----')) {
        values.push({ name, value: part });
      }
    }
  }
  return values;
}

/** Scans paths; returns findings (never the secret itself). */
function scan(paths, { env = process.env, names = secretSettingNames() } = {}) {
  const findings = [];
  const nameRegex = names.length > 0 ? new RegExp(`\\b(?:${names.join('|')})\\b`, 'g') : null;
  const values = secretValues(names, env);
  let scanned = 0;
  for (const path of paths) {
    for (const file of files(path)) {
      scanned += 1;
      // latin1 maps bytes 1:1, so ASCII patterns match inside binaries (Hermes bytecode, .so).
      const text = readFileSync(file).toString('latin1');
      const where = relative(process.cwd(), file) || file;
      for (const { name, regex } of PATTERNS) {
        for (const match of text.matchAll(regex)) {
          findings.push({ file: where, kind: name, sample: redact(match[0]) });
        }
      }
      if (nameRegex) {
        for (const match of new Set([...text.matchAll(nameRegex)].map((m) => m[0]))) {
          findings.push({ file: where, kind: 'server secret setting name', sample: match });
        }
      }
      for (const { name, value } of values) {
        if (text.includes(value)) {
          findings.push({ file: where, kind: `value of ${name}`, sample: redact(value) });
        }
      }
    }
  }
  return { findings, scanned };
}

/** Plants one example of every finding type and checks that each is reported. */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-bundle-'));
  try {
    const x = (count) => 'x'.repeat(count);
    const fakeKey = `${x(12)}PlantedPrivateKeyMaterial${x(12)}`;
    const planted = [
      ['-----BEGIN', 'PRIVATE KEY-----'].join(' RSA '),
      ['sk', 'live', `A1${x(22)}`].join('_'),
      ['whsec', `B2${x(24)}`].join('_'),
      ['FLWSECK', `TEST-${'c'.repeat(32)}-X`].join('_'),
      ['duffel', 'test', `D4${x(24)}`].join('_'),
      ['AKIA', 'E5'.padEnd(16, 'Z')].join(''),
      ['AIza', `F6${x(33)}`].join(''),
      ['ghp', `G7${x(36)}`].join('_'),
      ['xoxb', `H8${x(20)}`].join('-'),
      [`eyJ${x(12)}`, `eyJ${x(12)}`, x(12)].join('.'),
      ['postgresql://suskii', 'hunter2hunter2@db:5432/app'].join(':'),
      'process.env.PAYSTACK_SECRET_KEY',
      `const leaked = "${fakeKey}"`,
    ];
    writeFileSync(join(dir, 'planted.bundle'), planted.join('\n'));
    writeFileSync(join(dir, 'clean.bundle'), 'const apiBaseUrl = "https://api.example.com";');
    const { findings } = scan([dir], {
      env: { HMAC_SECRET: fakeKey },
      names: secretSettingNames(),
    });
    const kinds = new Set(findings.map((finding) => finding.kind));
    const expected = [
      ...PATTERNS.map((pattern) => pattern.name),
      'server secret setting name',
      'value of HMAC_SECRET',
    ];
    const missed = expected.filter((kind) => !kinds.has(kind));
    const falsePositives = findings.filter((finding) => finding.file.endsWith('clean.bundle'));
    if (missed.length > 0 || falsePositives.length > 0) {
      process.stderr.write(
        `Self-test failed. ${JSON.stringify({ missed, falsePositives }, null, 2)}\n`,
      );
      return 1;
    }
    process.stdout.write(`Self-test passed: ${expected.length} planted finding types detected.\n`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(args) {
  if (args.includes('--self-test')) return selfTest();
  if (args.length === 0) {
    process.stderr.write('Usage: scan-bundle.mjs <file-or-directory>... | --self-test\n');
    return 2;
  }
  const { findings, scanned } = scan(args);
  if (scanned === 0) {
    process.stderr.write('No files to scan.\n');
    return 2;
  }
  if (findings.length > 0) {
    process.stderr.write(`Secrets found in the app build (${findings.length}):\n`);
    for (const finding of findings) {
      process.stderr.write(`  ${finding.file}: ${finding.kind}: ${finding.sample}\n`);
    }
    return 1;
  }
  process.stdout.write(`No secrets found in ${scanned} files.\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
