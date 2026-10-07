import type { Page } from '@playwright/test';
import { WEB_VITAL_NAMES } from '@suskii/shared/lite';

import { expect, test } from './fixtures';

/** Pretends the tab went to the background, which is when the page sends its report. */
async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    // Browsers fire it at the document and let it bubble to window.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}

/**
 * ADR-044: after the first interaction the page loads its web-vitals reporter, and when hidden it
 * sends one text/plain beacon with the page template, the device class and the metric values,
 * which the API accepts. Nothing in it names the URL, ids or the visitor.
 */
test('reports field web vitals with the page template only', async ({ page }) => {
  const beacons: { body: string; type: string; status: Promise<number | undefined> }[] = [];
  page.on('request', (request) => {
    if (!request.url().endsWith('/v1/telemetry/web-vitals')) return;
    beacons.push({
      body: request.postData() ?? '',
      type: request.headers()['content-type'] ?? '',
      status: request.response().then((response) => response?.status()),
    });
  });
  await page.goto('/flights?from=LOS', { waitUntil: 'networkidle' });
  expect(beacons).toHaveLength(0);
  await page.keyboard.press('Tab');

  // The reporter loads on demand, and the library only finalises LCP on trusted input, so keep
  // pressing a key and hiding the page until every page-load metric has been sent.
  const sent = (): Set<string> =>
    new Set(
      beacons
        .flatMap(({ body }) => (JSON.parse(body) as { metrics: { name: string }[] }).metrics)
        .map((metric) => metric.name),
    );
  await expect
    .poll(async () => {
      await page.keyboard.press('Shift');
      await hidePage(page);
      return [...sent()].sort();
    })
    .toEqual(expect.arrayContaining(['FCP', 'LCP', 'TTFB']));

  for (const beacon of beacons) {
    expect(beacon.type).toMatch(/^text\/plain/);
    const report = JSON.parse(beacon.body) as {
      page: string;
      device: string;
      metrics: { name: string; value: number }[];
    };
    expect(Object.keys(report).sort()).toEqual(['device', 'metrics', 'page']);
    expect(report.page).toBe('/flights');
    expect(['mobile', 'desktop']).toContain(report.device);
    for (const metric of report.metrics) {
      expect(WEB_VITAL_NAMES).toContain(metric.name);
      expect(metric.value).toBeGreaterThanOrEqual(0);
    }
    expect(await beacon.status).toBe(204);
  }
});
