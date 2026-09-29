/**
 * Lighthouse gate for the phase 4 acceptance criteria: mobile performance >= 90, accessibility
 * 100 and SEO 100 on the homepage (Lighthouse's default mobile emulation and throttling).
 *
 *   pnpm --filter @suskii/web lighthouse [url]        (default http://localhost:3000/)
 *
 * Runs LIGHTHOUSE_RUNS times (default 3) and judges the median performance run, since single
 * runs vary. Reports go to lighthouse-report/. Chrome comes from CHROME_PATH or Playwright.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const THRESHOLDS = { performance: 0.9, accessibility: 1, seo: 1 } as const;
const CATEGORIES = ['performance', 'accessibility', 'seo', 'best-practices'];

const url = process.argv[2] ?? process.env.LIGHTHOUSE_URL ?? 'http://localhost:3000/';
const runs = Math.max(1, Number(process.env.LIGHTHOUSE_RUNS ?? 3));
const outDir = join(import.meta.dirname, '..', 'lighthouse-report');

interface RunResult {
  scores: Record<string, number>;
  html: string;
  json: string;
}

const chrome = await launch({
  chromePath: process.env.CHROME_PATH ?? chromium.executablePath(),
  chromeFlags: [
    '--headless=new',
    // Chrome refuses to start as root (containers), and CI runners restrict the user namespaces its
    // sandbox needs; the browser only visits the local test server.
    ...(process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : []),
  ],
});

const results: RunResult[] = [];
try {
  // Warm the server's data cache so the first measured run is not a cold start.
  await fetch(url);
  for (let run = 1; run <= runs; run += 1) {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: ['html', 'json'],
      onlyCategories: CATEGORIES,
      logLevel: 'error',
    });
    if (!result) throw new Error('Lighthouse returned no result');
    // A broken trace scores 0 without failing; report it as an error instead.
    if (result.lhr.runtimeError)
      throw new Error(`Lighthouse run failed: ${result.lhr.runtimeError.code}`);
    const scores = Object.fromEntries(
      Object.entries(result.lhr.categories).map(([key, category]) => [key, category.score ?? 0]),
    );
    const [html, json] = result.report as [string, string];
    results.push({ scores, html, json });
    process.stdout.write(
      `run ${run}: ${Object.entries(scores)
        .map(([key, score]) => `${key} ${Math.round(score * 100)}`)
        .join(', ')}\n`,
    );
  }
} finally {
  chrome.kill();
}

const sorted = [...results].sort(
  (a, b) => (a.scores.performance ?? 0) - (b.scores.performance ?? 0),
);
const median = sorted[Math.floor(sorted.length / 2)];
if (!median) throw new Error('No Lighthouse runs completed');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'homepage.html'), median.html);
writeFileSync(join(outDir, 'homepage.json'), median.json);

const failures = Object.entries(THRESHOLDS).filter(
  ([key, minimum]) => (median.scores[key] ?? 0) < minimum,
);
for (const [key, minimum] of Object.entries(THRESHOLDS)) {
  const score = Math.round((median.scores[key] ?? 0) * 100);
  process.stdout.write(`${key}: ${score} (minimum ${minimum * 100})\n`);
}
process.stdout.write(`report: ${join(outDir, 'homepage.html')}\n`);
if (failures.length > 0) {
  process.stderr.write(`Lighthouse below threshold: ${failures.map(([key]) => key).join(', ')}\n`);
  process.exit(1);
}
