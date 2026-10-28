import { devices, type Browser, type Page } from '@playwright/test';

import { expect, isoDaysFromToday, t, test } from './fixtures';
import { choose, pickDates } from './helpers';

/**
 * Fast on slow 3G (ADR-075): on WebPageTest's "3G Slow" profile (400 kbit/s each way, 400 ms round
 * trip) and a phone with a 4x slower CPU, flight results show within 3 seconds of pressing Search
 * on the homepage. Supplier time is not part of the budget: the e2e stack's mock suppliers answer
 * at once, so the test measures our website and API. Median of three runs, each in a fresh
 * browser profile; runs on its own after the other projects so they cannot slow it.
 */
const SLOW_3G = {
  offline: false,
  latency: 400,
  downloadThroughput: (400 * 1024) / 8,
  uploadThroughput: (400 * 1024) / 8,
};
const CPU_SLOWDOWN = 4;
const BUDGET_MS = 3_000;
const RUNS = 3;

async function onSlowPhone(browser: Browser, baseURL: string): Promise<Page> {
  const context = await browser.newContext({
    ...devices['Moto G4'],
    baseURL,
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_3G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  return page;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
};

test('flight results show within 3 s of pressing Search on slow 3G', async ({
  browser,
}, testInfo) => {
  test.setTimeout(RUNS * 120_000);
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3000';
  const times: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const page = await onSlowPhone(browser, baseURL);
    // Loading the page and filling in the form are not measured, only Search to the first fare.
    await page.goto('/', { waitUntil: 'load', timeout: 90_000 });
    await choose(page, 'flight-origin', 'LOS', /Lagos/);
    await choose(page, 'flight-destination', 'ABV', /Abuja/);
    await pickDates(page, 'flight-departureDate', isoDaysFromToday(33 + run));
    const submit = page.getByRole('button', { name: t('search.flights.submit') });
    const started = Date.now();
    await submit.click();
    await expect(page.getByTestId('flight-offer').first()).toBeVisible({ timeout: 60_000 });
    times.push(Date.now() - started);
    await page.context().close();
  }
  testInfo.annotations.push({
    type: 'slow-3g-search',
    description: `${times.map((ms) => `${ms} ms`).join(', ')} (median ${median(times)} ms)`,
  });
  expect(median(times)).toBeLessThanOrEqual(BUDGET_MS);
});
