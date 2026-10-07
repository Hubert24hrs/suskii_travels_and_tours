import { gzipSync } from 'node:zlib';

import { expect, test } from './fixtures';

/**
 * Initial JavaScript of the homepage: scripts loaded without any interaction (overlay, calendar,
 * schema and other-tab chunks load on demand). PROJECT_SPEC.json#/performance/web_targets sets
 * 170 kB gzip (ADR-013, ADR-043).
 */
const HOMEPAGE_JS_BUDGET_BYTES = 170 * 1024;

test('homepage initial JavaScript stays within budget', async ({ page }) => {
  const scripts: Promise<number>[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script')
      scripts.push(response.body().then((body) => gzipSync(body).length));
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  const sizes = await Promise.all(scripts);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  test.info().annotations.push({
    type: 'homepage-js',
    description: `${(total / 1024).toFixed(1)} kB gzip in ${sizes.length} scripts`,
  });
  expect(total).toBeLessThanOrEqual(HOMEPAGE_JS_BUDGET_BYTES);
});

test('the search form works before its on-demand code has loaded', async ({ page }) => {
  // Only the trigger and fields ship with the page; opening a picker loads the overlay code.
  const requested: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') requested.push(request.url());
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  const before = requested.length;
  await page.locator('#flight-departureDate').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(requested.length).toBeGreaterThan(before);
});
