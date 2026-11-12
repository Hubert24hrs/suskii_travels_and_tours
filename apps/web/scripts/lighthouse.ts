/**
 * Lighthouse gate for the homepage (Lighthouse's default mobile emulation):
 *
 * - simulated throttling, as PageSpeed Insights reports it: performance >= 90, accessibility 100
 *   and SEO 100 (phase 4), CLS <= 0.1 and TBT <= 200 ms (phase 11);
 * - applied (DevTools) throttling: LCP <= 2.5 s. Simulated LCP charges every request that ends
 *   before the observed paint, so on a fast machine it swings with whether the scripts happened to
 *   arrive first; applied throttling loads in the order a slow phone sees (ADR-044).
 *
 * The spec's web targets (LCP 2 s, INP 200 ms, CLS 0.1) are field values at the 75th percentile,
 * measured from real visits through web-vitals reporting; lab values guard against regressions.
 *
 *   pnpm --filter @suskii/web lighthouse [url]        (default http://localhost:3000/)
 *
 * Runs LIGHTHOUSE_RUNS times (default 3) per throttling method and judges medians, since single
 * runs vary. Reports go to lighthouse-report/. Chrome comes from CHROME_PATH or Playwright.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const SCORE_MINIMUMS = { performance: 0.9, accessibility: 1, seo: 1 } as const;
const CATEGORIES = ['performance', 'accessibility', 'seo', 'best-practices'];

/** Lab ceilings: Lighthouse's mobile "good" boundaries (milliseconds; CLS is unitless). */
const LIMITS = {
  simulate: { 'cumulative-layout-shift': 0.1, 'total-blocking-time': 200 },
  devtools: { 'largest-contentful-paint': 2500, 'cumulative-layout-shift': 0.1 },
} as const;
type Method = keyof typeof LIMITS;

const url = process.argv[2] ?? process.env.LIGHTHOUSE_URL ?? 'http://localhost:3000/';
const runs = Math.max(1, Number(process.env.LIGHTHOUSE_RUNS ?? 3));
const outDir = join(import.meta.dirname, '..', 'lighthouse-report');

interface RunResult {
  scores: Record<string, number>;
  metrics: Record<string, number>;
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

const results: Record<Method, RunResult[]> = { simulate: [], devtools: [] };
try {
  // Warm the server's data cache so the first measured run is not a cold start.
  await fetch(url);
  for (const method of Object.keys(LIMITS) as Method[]) {
    for (let run = 1; run <= runs; run += 1) {
      const result = await lighthouse(url, {
        port: chrome.port,
        output: ['html', 'json'],
        // Scores come from the simulated runs; the applied runs only measure lab metrics.
        onlyCategories: method === 'simulate' ? CATEGORIES : ['performance'],
        throttlingMethod: method,
        logLevel: 'error',
      });
      if (!result) throw new Error('Lighthouse returned no result');
      // A broken trace scores 0 without failing; report it as an error instead.
      if (result.lhr.runtimeError)
        throw new Error(`Lighthouse run failed: ${result.lhr.runtimeError.code}`);
      const scores = Object.fromEntries(
        Object.entries(result.lhr.categories).map(([key, category]) => [key, category.score ?? 0]),
      );
      const metrics = Object.fromEntries(
        Object.keys(LIMITS[method]).map((id) => [
          id,
          result.lhr.audits[id]?.numericValue ?? Number.POSITIVE_INFINITY,
        ]),
      );
      const [html, json] = result.report as [string, string];
      results[method].push({ scores, metrics, html, json });
      const shown = method === 'simulate' ? Object.entries(scores) : [];
      process.stdout.write(
        `${method} run ${run}: ${[
          ...shown.map(([key, score]) => `${key} ${Math.round(score * 100)}`),
          ...Object.entries(metrics).map(([id, value]) => `${id} ${format(id, value)}`),
        ].join(', ')}\n`,
      );
    }
  }
} finally {
  chrome.kill();
}

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

// The report shows the simulated run with the median performance score.
const byScore = [...results.simulate].sort(
  (a, b) => (a.scores.performance ?? 0) - (b.scores.performance ?? 0),
);
const report = byScore[Math.floor(byScore.length / 2)];
if (!report) throw new Error('No Lighthouse runs completed');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'homepage.html'), report.html);
writeFileSync(join(outDir, 'homepage.json'), report.json);

const failures: string[] = [];
for (const [key, minimum] of Object.entries(SCORE_MINIMUMS)) {
  const score = report.scores[key] ?? 0;
  if (score < minimum) failures.push(key);
  process.stdout.write(`${key}: ${Math.round(score * 100)} (minimum ${minimum * 100})\n`);
}
for (const method of Object.keys(LIMITS) as Method[]) {
  for (const [id, limit] of Object.entries(LIMITS[method])) {
    const value = median(results[method].map((run) => run.metrics[id] ?? Number.NaN));
    if (!(value <= limit)) failures.push(`${id} (${method})`);
    process.stdout.write(
      `${id} (${method}, median): ${format(id, value)} (maximum ${format(id, limit)})\n`,
    );
  }
}
process.stdout.write(`report: ${join(outDir, 'homepage.html')}\n`);
if (failures.length > 0) {
  process.stderr.write(`Lighthouse outside its limits: ${failures.join(', ')}\n`);
  process.exit(1);
}

function format(id: string, value: number): string {
  return id === 'cumulative-layout-shift' ? value.toFixed(3) : `${Math.round(value)} ms`;
}
