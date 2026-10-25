#!/usr/bin/env node
/**
 * Helm release rehearsal on a kind cluster (ADR-060), the Kubernetes counterpart of
 * scripts/release-rehearsal.mjs:
 *
 *   1. installs the chart (migration hook, then the services behind their readiness probes);
 *   2. smoke-tests it from inside the cluster;
 *   3. upgrades to a broken API image with `--atomic`, which must fail and roll back by itself;
 *   4. upgrades to a good revision, rolls it back by hand with `helm rollback`;
 *   5. smoke-tests again.
 *
 *   node scripts/helm-rehearsal.mjs [--keep] [--reuse]
 *
 * Needs Docker, kind and Helm (KIND and HELM override the commands) and the release images under
 * their `:local` tags. kubectl runs inside the kind node, so it need not be installed. Images are
 * loaded into the cluster, never pulled from inside it.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHART = join(ROOT, 'infra/helm/suskii');
const CLUSTER = 'suskii-rehearsal';
const NODE = `${CLUSTER}-control-plane`;
const NAMESPACE = 'suskii';
const RELEASE = 'suskii';
const KIND = process.env.KIND ?? 'kind';
const HELM = process.env.HELM ?? 'helm';
const NODE_IMAGE = 'node:24.21.0-alpine3.24';
const IMAGES = [
  'suskii-api:local',
  'suskii-api-migrate:local',
  'suskii-worker:local',
  'suskii-web:local',
  'suskii-admin:local',
  'postgres:16-alpine',
  'redis:7.4-alpine',
  'versity/versitygw:v1.8.0',
  NODE_IMAGE,
];
const BROKEN = 'suskii-api:rehearsal-broken';
const OWNER_URL =
  'postgresql://suskii:release-rehearsal@rehearsal-postgres:5432/suskii?sslmode=disable';
const APP_URL =
  'postgresql://suskii_app:release-rehearsal-app-password@rehearsal-postgres:5432/suskii?sslmode=disable';

const { values } = parseArgs({
  options: {
    keep: { type: 'boolean', default: false },
    reuse: { type: 'boolean', default: false },
  },
});
const work = mkdtempSync(join(tmpdir(), 'suskii-helm-'));
const kubeconfig = join(work, 'kubeconfig');

const say = (line) => process.stdout.write(`\n[helm-rehearsal] ${line}\n`);

function run(command, args, { input, allowFailure = false, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    env: { ...process.env, KUBECONFIG: kubeconfig },
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} ... exited with ${result.status}`);
  }
  return { ok: result.status === 0, stdout: result.stdout ?? '' };
}

/** kubectl from inside the kind node, with the cluster's admin credentials. */
const kubectl = (args, options) =>
  run(
    'docker',
    ['exec', '-i', NODE, 'kubectl', '--kubeconfig', '/etc/kubernetes/admin.conf', ...args],
    options,
  );

const helm = (args, options) =>
  run(HELM, [...args, '--namespace', NAMESPACE, '--kubeconfig', kubeconfig], options);

const upgrade = (extra, timeout) =>
  helm(
    [
      'upgrade',
      '--install',
      RELEASE,
      CHART,
      '-f',
      join(CHART, 'ci/rehearsal-values.yaml'),
      '--atomic',
      '--wait',
      '--timeout',
      timeout,
      ...extra,
    ],
    { allowFailure: true },
  ).ok;

/** Runs scripts/smoke.mjs in a pod next to the services; true when every check passes. */
function smoke(label) {
  const name = `smoke-${label}`;
  kubectl(['-n', NAMESPACE, 'delete', 'job', name, '--ignore-not-found'], { allowFailure: true });
  kubectl(['-n', NAMESPACE, 'apply', '-f', '-'], {
    input: JSON.stringify({
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name, namespace: NAMESPACE },
      spec: {
        backoffLimit: 0,
        template: {
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'smoke',
                image: NODE_IMAGE,
                imagePullPolicy: 'Never',
                command: ['node', '/smoke/smoke.mjs'],
                args: [
                  '--api',
                  `http://${RELEASE}-api`,
                  '--web',
                  `http://${RELEASE}-web`,
                  '--admin',
                  `http://${RELEASE}-admin`,
                  '--wait',
                  '120',
                ],
                volumeMounts: [{ name: 'smoke', mountPath: '/smoke' }],
              },
            ],
            volumes: [{ name: 'smoke', configMap: { name: 'smoke-script' } }],
          },
        },
      },
    }),
  });
  const done = kubectl(
    ['-n', NAMESPACE, 'wait', '--for=condition=complete', `job/${name}`, '--timeout=180s'],
    { allowFailure: true },
  ).ok;
  kubectl(['-n', NAMESPACE, 'logs', `job/${name}`], { allowFailure: true });
  return done;
}

const apiImage = () =>
  kubectl(
    [
      '-n',
      NAMESPACE,
      'get',
      'deployment',
      `${RELEASE}-api`,
      '-o',
      'jsonpath={.spec.template.spec.containers[0].image}',
    ],
    { capture: true },
  ).stdout.trim();

const steps = [];
const done = (step) => {
  steps.push(step);
  say(`ok: ${step}`);
};

try {
  const clusters = run(KIND, ['get', 'clusters'], { capture: true }).stdout.split('\n');
  if (!values.reuse || !clusters.includes(CLUSTER)) {
    say('fresh kind cluster');
    run(KIND, ['delete', 'cluster', '--name', CLUSTER], { allowFailure: true });
    run(KIND, ['create', 'cluster', '--name', CLUSTER, '--wait', '180s']);
  }
  writeFileSync(
    kubeconfig,
    run(KIND, ['get', 'kubeconfig', '--name', CLUSTER], { capture: true }).stdout,
    {
      mode: 0o600,
    },
  );
  done('cluster ready');

  say('images into the cluster (nothing is pulled from inside it)');
  for (const image of IMAGES.filter((name) => !name.startsWith('suskii-'))) {
    if (!run('docker', ['image', 'inspect', image], { allowFailure: true, capture: true }).ok) {
      run('docker', ['pull', '-q', image]);
    }
  }
  run('docker', ['build', '-q', '-t', BROKEN, '-'], {
    input: `FROM suskii-api:local\nCMD ["node", "-e", "console.error('release N+1 fails at start-up'); process.exit(1)"]\n`,
  });
  run(KIND, ['load', 'docker-image', '--name', CLUSTER, ...IMAGES, BROKEN]);
  done('images loaded');

  say('data services and secrets');
  kubectl(['apply', '-f', '-'], {
    input: readFileSync(join(ROOT, 'infra/helm/rehearsal/data-services.yaml'), 'utf8').replaceAll(
      /image: (\S+)/g,
      'image: $1\n          imagePullPolicy: Never',
    ),
  });
  for (const name of ['rehearsal-postgres', 'rehearsal-redis', 'rehearsal-s3']) {
    kubectl(['-n', NAMESPACE, 'rollout', 'status', `deployment/${name}`, '--timeout=180s']);
  }
  const keys = run('pnpm', ['--filter', '@suskii/api', '-s', 'keys:generate'], { capture: true })
    .stdout.split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line));
  const literal = (pairs) => pairs.flatMap((pair) => ['--from-literal', pair]);
  const secret = (name, pairs) =>
    kubectl(
      [
        '-n',
        NAMESPACE,
        'create',
        'secret',
        'generic',
        name,
        ...literal(pairs),
        '--dry-run=client',
        '-o',
        'yaml',
      ],
      { capture: true },
    ).stdout;
  for (const [name, pairs] of [
    [
      'suskii-api',
      [
        ...keys,
        `DATABASE_URL=${APP_URL}`,
        'REDIS_URL=redis://rehearsal-redis:6379',
        // Cloudflare's documented always-passes test secret; never a real key.
        'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA',
        'OBJECT_STORAGE_ACCESS_KEY_ID=release-rehearsal',
        'OBJECT_STORAGE_SECRET_ACCESS_KEY=release-rehearsal-secret',
      ],
    ],
    ['suskii-migrate', [`DATABASE_URL=${OWNER_URL}`, `DATABASE_APP_URL=${APP_URL}`]],
    [
      'suskii-worker',
      [
        'REDIS_URL=redis://rehearsal-redis:6379',
        keys.find((line) => line.startsWith('INTERNAL_API_TOKEN=')),
      ],
    ],
  ]) {
    kubectl(['apply', '-f', '-'], { input: secret(name, pairs) });
  }
  kubectl(['-n', NAMESPACE, 'apply', '-f', '-'], {
    input: kubectl(
      [
        '-n',
        NAMESPACE,
        'create',
        'configmap',
        'smoke-script',
        '--from-file',
        'smoke.mjs=/dev/stdin',
        '--dry-run=client',
        '-o',
        'yaml',
      ],
      { input: readFileSync(join(ROOT, 'scripts/smoke.mjs'), 'utf8'), capture: true },
    ).stdout,
  });
  done('data services healthy, secrets and smoke script in place');

  say('release 1: install (migration hook, then the services behind their probes)');
  if (!upgrade(['--set', 'images.api.tag=local'], '10m')) throw new Error('the install failed');
  done('release 1 installed');
  if (!smoke('r1')) throw new Error('smoke tests failed on release 1');
  done('smoke tests passed on release 1');

  say('release 2: a broken API image, with --atomic');
  if (upgrade(['--set', 'images.api.tag=rehearsal-broken'], '3m')) {
    throw new Error('helm accepted a broken release');
  }
  if (apiImage() !== 'suskii-api:local') throw new Error('--atomic did not restore the API image');
  done('broken release failed its probes and --atomic rolled it back');

  say('release 3: a good change, then a manual rollback');
  if (!upgrade(['--set', 'images.api.tag=local', '--set', 'api.env.LOG_LEVEL=warn'], '5m')) {
    throw new Error('a good upgrade failed');
  }
  const history = JSON.parse(helm(['history', RELEASE, '-o', 'json'], { capture: true }).stdout);
  const previous = history.filter((entry) => entry.status === 'superseded').at(-1)?.revision;
  if (!previous) throw new Error('no earlier revision to roll back to');
  helm(['rollback', RELEASE, String(previous), '--wait', '--timeout', '5m']);
  done(`rolled back by hand to revision ${previous}`);
  if (!smoke('rollback')) throw new Error('smoke tests failed after the rollback');
  done('smoke tests passed after the rollback');

  say(`rehearsal passed: ${steps.join('; ')}`);
} catch (error) {
  say(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  say(`completed before the failure: ${steps.join('; ') || 'nothing'}`);
  kubectl(['-n', NAMESPACE, 'get', 'pods,jobs', '-o', 'wide'], { allowFailure: true });
  kubectl(['-n', NAMESPACE, 'logs', '-l', 'app.kubernetes.io/component=migrate', '--tail', '40'], {
    allowFailure: true,
  });
  kubectl(['-n', NAMESPACE, 'logs', '-l', 'app.kubernetes.io/component=api', '--tail', '40'], {
    allowFailure: true,
  });
  process.exitCode = 1;
} finally {
  run('docker', ['image', 'rm', '-f', BROKEN], { allowFailure: true });
  if (!values.keep) run(KIND, ['delete', 'cluster', '--name', CLUSTER], { allowFailure: true });
  rmSync(work, { recursive: true, force: true });
}
