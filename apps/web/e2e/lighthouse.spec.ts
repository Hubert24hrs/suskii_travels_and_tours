import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Phase 4 acceptance: Lighthouse mobile performance >= 90, accessibility 100 and SEO 100 on the
 * homepage. Runs last and alone (its own project) so parallel tests cannot skew the scores; the
 * script judges the median of LIGHTHOUSE_RUNS runs and writes lighthouse-report/.
 */
test('homepage meets the Lighthouse thresholds', async ({ baseURL }) => {
  test.setTimeout(10 * 60_000);
  const script = join(__dirname, '..', 'scripts', 'lighthouse.ts');
  const output: string[] = [];
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', script, `${baseURL ?? ''}/`],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.on('exit', resolve);
  });
  await test.info().attach('lighthouse.txt', { body: output.join(''), contentType: 'text/plain' });
  expect(code, output.join('')).toBe(0);
});
