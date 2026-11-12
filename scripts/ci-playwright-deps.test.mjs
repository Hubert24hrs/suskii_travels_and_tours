import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { ensureBrowserDeps, launchScript } from './ci-playwright-deps.mjs';

const calls = () => {
  const made = [];
  return {
    made,
    step: (name, result) => () => {
      made.push(name);
      return result;
    },
    warn: (message) => made.push(`warn: ${message}`),
  };
};

test('says installed when apt did its work, without starting a browser or warning', () => {
  const log = calls();
  const outcome = ensureBrowserDeps({
    install: log.step('install', true),
    launch: log.step('launch', true),
    warn: log.warn,
  });
  assert.equal(outcome, 'installed');
  assert.deepEqual(log.made, ['install']);
});

test("goes on with the image's libraries when apt fails and the browser still starts, and says so", () => {
  const log = calls();
  const outcome = ensureBrowserDeps({
    install: log.step('install', false),
    launch: log.step('launch', true),
    warn: log.warn,
  });
  assert.equal(outcome, 'image');
  assert.equal(log.made.length, 3);
  assert.deepEqual(log.made.slice(0, 2), ['install', 'launch']);
  assert.match(log.made[2], /^warn: apt could not install/);
  assert.match(log.made[2], /visual test/);
});

test('fails when apt fails and the browser does not start, and warns of nothing', () => {
  const log = calls();
  assert.throws(
    () =>
      ensureBrowserDeps({
        install: log.step('install', false),
        launch: log.step('launch', false),
        warn: log.warn,
      }),
    /does not start without them/,
  );
  assert.deepEqual(log.made, ['install', 'launch']);
});

test('the launch script is valid JavaScript that names the browser asked for', () => {
  const script = launchScript('chromium');
  assert.match(script, /playwright\["chromium"\]\.launch/);
  const checked = spawnSync(process.execPath, ['--check', '-'], { input: script });
  assert.equal(checked.status, 0, checked.stderr.toString());
});
