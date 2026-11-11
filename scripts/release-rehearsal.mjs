#!/usr/bin/env node
/**
 * Release rehearsal on the compose stack (ADR-060): deploys the release images as a release does
 * (database step first, then the services behind their health checks, then the smoke tests), runs
 * an operator command the way the ops job does (the first super admin, written as the API's
 * restricted database role), then deploys a broken API release, checks the health gate refuses
 * it, rolls back to the previous image and smoke-tests again. Runs locally and in CI once the
 * images are built.
 *
 *   node scripts/release-rehearsal.mjs [--keep]
 *
 * Images default to the `:local` tags (docker build ... -t suskii-api:local); override with
 * SUSKII_API_IMAGE, SUSKII_MIGRATE_IMAGE, SUSKII_WORKER_IMAGE, SUSKII_AGENT_IMAGE,
 * SUSKII_WEB_IMAGE and SUSKII_ADMIN_IMAGE. Throwaway keys go to .env.release (git-ignored), from
 * the API's keys:generate; the agent service gets only its two tokens, in .env.release.agent.
 * Compose replaces a container in place, so unlike Cloud Run or Helm it rehearses the procedure
 * (gate, rollback, verification), not a traffic split.
 *
 * The agent service (ADR-101) is deployed as a release deploys it: the database step creates its
 * role, it is healthy only once that role reads its checkpoint tables, and each of its two doors
 * is checked to answer to its own token and to no other.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = ['compose', '-f', join(ROOT, 'docker-compose.release.yml')];
const { values } = parseArgs({ options: { keep: { type: 'boolean', default: false } } });
const apiImage = process.env.SUSKII_API_IMAGE ?? 'suskii-api:local';
const brokenImage = 'suskii-api:rehearsal-broken';

const say = (line) => process.stdout.write(`\n[rehearsal] ${line}\n`);

function run(command, args, { env = {}, input, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
  return result.status === 0;
}

const compose = (args, options) => run('docker', [...COMPOSE, ...args], options);

const smoke = () =>
  run(
    process.execPath,
    [
      join(ROOT, 'scripts/smoke.mjs'),
      '--api',
      'http://127.0.0.1:14000',
      '--web',
      'http://127.0.0.1:13000',
      '--admin',
      'http://127.0.0.1:13001',
    ],
    { allowFailure: true },
  );

/** Deploys one API image behind its health check; false when the gate refuses it. */
const deployApi = (image, waitSeconds) =>
  compose(['up', '-d', '--wait', '--wait-timeout', String(waitSeconds), 'api'], {
    env: { SUSKII_API_IMAGE: image },
    allowFailure: true,
  });

const AGENT_TOKENS = ['AGENT_RUN_TOKEN', 'AGENT_TOOLS_TOKEN'];

function writeKeys() {
  const path = join(ROOT, '.env.release');
  if (!existsSync(path)) {
    const result = spawnSync('pnpm', ['--filter', '@suskii/api', '-s', 'keys:generate'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error('keys:generate failed');
    writeFileSync(path, result.stdout, { mode: 0o600 });
  }
  // A key file from before the agent service existed has no tokens for it.
  const lines = () => readFileSync(path, 'utf8').split('\n');
  for (const name of AGENT_TOKENS) {
    if (!lines().some((line) => line.startsWith(`${name}=`))) {
      appendFileSync(path, `${name}=${randomBytes(32).toString('base64url')}\n`);
    }
  }
  // The agent service is given its two tokens and none of the API's keys.
  writeFileSync(
    join(ROOT, '.env.release.agent'),
    `${lines()
      .filter((line) => AGENT_TOKENS.some((name) => line.startsWith(`${name}=`)))
      .join('\n')}\n`,
    { mode: 0o600 },
  );
}

/** Runs a short script with Node inside a running service; true when it exits 0. */
const inside = (service, script) =>
  compose(['exec', '-T', service, 'node', '-e', script], { allowFailure: true });

/**
 * From inside the API: the agent service starts nothing without the run token. With it, a
 * request that is not a run is refused as one (400); with any other token, or none, the door
 * does not exist (404).
 */
const RUN_DOOR = `
const post = (token) =>
  fetch(process.env.AGENT_URL + '/runs', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: '{}',
  }).then((response) => response.status);
Promise.all([
  post(process.env.AGENT_RUN_TOKEN),
  post(process.env.AGENT_TOOLS_TOKEN),
  post(process.env.INTERNAL_API_TOKEN),
  post(''),
]).then((statuses) => {
  const wanted = [400, 404, 404, 404];
  if (statuses.join() !== wanted.join()) {
    console.error('run door answered ' + statuses.join() + ', wanted ' + wanted.join());
    process.exit(1);
  }
}, () => process.exit(1));
`;

/**
 * From inside the agent service: the tool gateway lists its tools to the tools token, and
 * refuses the run token and no token (401). It is the agent's only way into the platform.
 */
const TOOL_DOOR = `
const list = (token) =>
  fetch(process.env.API_INTERNAL_URL + '/v1/internal/agent-tools', {
    headers: token ? { authorization: 'Bearer ' + token } : {},
  }).then(async (response) => [response.status, response.ok ? (await response.json()).tools.length : 0]);
Promise.all([
  list(process.env.AGENT_TOOLS_TOKEN),
  list(process.env.AGENT_RUN_TOKEN),
  list(''),
]).then(([own, other, none]) => {
  if (own[0] !== 200 || own[1] < 1 || other[0] !== 401 || none[0] !== 401) {
    console.error('tool gateway answered ' + [own[0], other[0], none[0]].join() + ' with ' + own[1] + ' tools');
    process.exit(1);
  }
}, () => process.exit(1));
`;

const steps = [];
const done = (step) => {
  steps.push(step);
  say(`ok: ${step}`);
};

try {
  writeKeys();
  say('fresh stack: data services');
  compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
  compose(['up', '-d', '--wait', 'postgres', 'redis', 's3']);
  done('data services healthy');

  say('release N: database step (migrate deploy, reference seed, the app and agent roles)');
  compose(['run', '--rm', 'migrate']);
  done('migrations and reference seed applied');

  say('release N: services behind their health checks');
  compose([
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '240',
    'api',
    'worker',
    'agent',
    'web',
    'admin',
  ]);
  done('api, worker, agent, web and admin healthy');
  if (!smoke()) throw new Error('smoke tests failed on release N');
  done('smoke tests passed on release N');

  say("the agent service's two doors, each with its own token");
  if (!inside('api', RUN_DOOR)) throw new Error('the run door did not answer as it should');
  if (!inside('agent', TOOL_DOOR)) throw new Error('the tool gateway did not answer as it should');
  done('the agent starts runs only for the API, and reaches the platform only as itself');

  say('ops: first super admin through the ops command, as the app role');
  compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'suskii',
    '-d',
    'suskii',
    '-c',
    "INSERT INTO users (id, email, email_verified_at, updated_at) VALUES (gen_random_uuid(), 'owner@example.com', now(), now())",
  ]);
  compose([
    'run',
    '--rm',
    'ops',
    'scripts/staff-bootstrap.ts',
    '--email',
    'owner@example.com',
    '--yes',
  ]);
  if (
    compose(['run', '--rm', 'ops', 'scripts/staff-bootstrap.ts', '--email', 'owner@example.com'], {
      allowFailure: true,
    })
  ) {
    throw new Error('the bootstrap command accepted a second super admin');
  }
  done('ops command granted the first super admin and refused a second');

  say('release N+1: a broken API image (it crashes at start-up)');
  // The release image with a faulty start baked in, as a bad release would ship it; nothing in
  // the deployment's own settings can mask it.
  run('docker', ['build', '-q', '-t', brokenImage, '-'], {
    input: `FROM ${apiImage}\nCMD ["node", "-e", "console.error('release N+1 fails at start-up'); process.exit(1)"]\n`,
  });
  if (deployApi(brokenImage, 45)) throw new Error('the health gate accepted a broken release');
  done('health gate refused release N+1');

  say(`rollback to release N (${apiImage})`);
  if (!deployApi(apiImage, 180)) throw new Error('rollback did not become healthy');
  done('rolled back; api healthy on release N');
  if (!smoke()) throw new Error('smoke tests failed after the rollback');
  done('smoke tests passed after the rollback');

  say(`rehearsal passed: ${steps.join('; ')}`);
} catch (error) {
  say(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  say(`completed before the failure: ${steps.join('; ') || 'nothing'}`);
  // Every service: an unhealthy website or console fails the gate as surely as the API.
  compose(['logs', '--tail', '60'], { allowFailure: true });
  process.exitCode = 1;
} finally {
  run('docker', ['image', 'rm', '-f', brokenImage], { allowFailure: true });
  if (!values.keep) compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
}
