import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';

/**
 * Ways into a hotel search (ADR-097): collections and deals by fixed rules, the hotels as pins
 * on a drawing with a link to a maps app, things to do in the city from partners, and the
 * visitor's last searches on the hotels page. The rules are covered against the API
 * (`apps/api/test/search.e2e-spec.ts`) and in `@suskii/shared`.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

async function lagos(page: Page): Promise<string> {
  const airport = (await (await page.request.get(`${API}/v1/catalog/airports/LOS`)).json()) as {
    cityId: string;
  };
  return `/hotels/search?dest=${airport.cityId}&checkin=${isoDaysFromToday(30)}&checkout=${isoDaysFromToday(33)}&room=2`;
}

test('narrows the results to a collection and says what the collection means', async ({ page }) => {
  await page.goto(await lagos(page));
  const hotels = page.getByTestId('hotel-result');
  await expect(hotels.first()).toBeVisible({ timeout: 30_000 });
  const count = page.locator('#hotel-results-count');
  const all = await count.textContent();

  const chips = page.getByTestId('hotel-collections');
  await expect(chips.getByTestId('hotel-collection-all')).toBeChecked();
  await chips.getByTestId('hotel-collection-luxury').check();
  await expect(page).toHaveURL(/collection=luxury/);
  await expect(page.getByTestId('collection-help')).toHaveText(
    t('results.collections.help.luxury'),
  );
  await expect(count).not.toHaveText(all ?? '');
  // Five-star hotels, and four-star ones guests rate 9 or more.
  await expect
    .poll(async () => {
      const labels = await hotels.getByRole('img', { name: /-star hotel$/ }).all();
      const stars = await Promise.all(labels.map((label) => label.getAttribute('aria-label')));
      return stars.every((label) => /^[45]-star/.test(label ?? ''));
    })
    .toBe(true);
  await expectNoAxeViolations(page);

  await chips.getByTestId('hotel-collection-all').check();
  await expect(page).not.toHaveURL(/collection=/);
  await expect(count).toHaveText(all ?? '');
});

test('shows the hotels as pins and the chosen one with a link to a maps app', async ({ page }) => {
  await page.goto(await lagos(page));
  const hotels = page.getByTestId('hotel-result');
  await expect(hotels.first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => hotels.count()).toBeGreaterThan(4);
  const listed = await hotels.count();

  await page.getByTestId('hotel-view-map').click();
  await expect(page).toHaveURL(/view=map/);
  const map = page.getByTestId('hotel-map');
  await expect(map).toBeVisible({ timeout: 30_000 });
  const pins = map.getByRole('button');
  await expect(pins).toHaveCount(listed);
  // Pins keep one size on screen however wide the drawing is: big enough to press (24 px),
  // small enough not to bury their neighbours.
  await expect
    .poll(async () => (await pins.first().boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(24);
  expect((await pins.first().boundingBox())?.width ?? 0).toBeLessThan(48);
  await expect(page.getByText(t('results.map.choose'))).toBeVisible();
  await expect(page.getByText(t('results.map.note'))).toBeVisible();
  await expectNoAxeViolations(page);

  // A pin is a button: the keyboard chooses it, and its hotel shows under the drawing.
  const pin = pins.first();
  const name = ((await pin.getAttribute('aria-label')) ?? '').split(',')[0] ?? '';
  await pin.focus();
  await page.keyboard.press('Enter');
  const selection = page.getByTestId('map-selection');
  await expect(selection.getByRole('heading', { name })).toBeVisible();
  await expect(map.getByRole('button', { pressed: true })).toHaveCount(1);
  const open = selection.getByRole('link', { name: t('results.map.openLabel', { hotel: name }) });
  await expect(open).toHaveAttribute(
    'href',
    /^https:\/\/www\.openstreetmap\.org\/\?mlat=-?\d+\.\d+&mlon=-?\d+\.\d+#map=16\//,
  );
  await expect(open).toHaveAttribute('rel', /noopener/);
  // Focusing a pin scrolled the view buttons half under the sticky header; axe measures only
  // what shows of a target, so the page is checked from the top, as every other page is.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoAxeViolations(page);

  await page.getByTestId('hotel-view-list').click();
  await expect(page).not.toHaveURL(/view=map/);
  await expect(hotels.first()).toBeVisible();
});

test('offers things to do in the city and a maps link on the hotel page', async ({ page }) => {
  await page.goto(await lagos(page));
  const first = page.getByTestId('hotel-result').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.getByRole('link', { name: /See rooms/ }).click();
  await page.waitForURL(/\/hotels\/stay\//);

  await expect(page.getByTestId('hotel-open-map')).toHaveAttribute(
    'href',
    /^https:\/\/www\.openstreetmap\.org\//,
  );
  const things = page.getByTestId('hotel-things-to-do');
  await expect(things).toBeVisible({ timeout: 30_000 });
  await expect(
    things.getByRole('heading', { name: t('results.discover.thingsToDo', { city: 'Lagos' }) }),
  ).toBeVisible();
  // Partner offers are booked on the partner's site, and the card says so.
  await expect(things).toContainText(t('partners.disclosure'));
  await expectNoAxeViolations(page);
});

test('offers the last hotel search again on the hotels page, from this browser only', async ({
  page,
}) => {
  await page.goto('/hotels');
  await expect(page.getByTestId('recent-hotel-searches')).toHaveCount(0);

  const url = await lagos(page);
  await page.goto(url);
  await expect(page.getByTestId('hotel-result').first()).toBeVisible({ timeout: 30_000 });

  await page.goto('/hotels');
  const recent = page.getByTestId('recent-hotel-searches');
  await expect(recent).toBeVisible();
  const link = recent.getByTestId('recent-hotel-search');
  await expect(link).toHaveCount(1);
  await expect(link).toContainText('Lagos');
  await expect(link).toContainText(t('results.discover.recentGuests', { count: 2 }));
  await expect(recent).toContainText(t('results.discover.recentNote'));
  await expectNoAxeViolations(page);

  await link.click();
  await expect(page).toHaveURL(new RegExp(url.replace(/[?]/g, '\\?')));
  await expect(page.getByTestId('hotel-result').first()).toBeVisible({ timeout: 30_000 });

  await page.goto('/hotels');
  await page.getByTestId('recent-hotel-clear').click();
  await expect(page.getByTestId('recent-hotel-searches')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('recent-hotel-searches')).toHaveCount(0);
});

test("leads from the hotels page to tonight's deals in a popular city", async ({ page }) => {
  await page.goto('/hotels');
  const deals = page.getByTestId('last-minute-deals');
  await expect(deals).toBeVisible();
  await expect(
    deals.getByRole('heading', { name: t('results.discover.lastMinuteHeading') }),
  ).toBeVisible();
  await expect(deals).toContainText(t('results.discover.lastMinuteNote'));
  const link = deals.getByTestId('last-minute-deal').first();
  // One night from the visitor's own today, two adults, the deals collection.
  const today = await page.evaluate(() => {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });
  const href = (await link.getAttribute('href')) ?? '';
  const params = new URL(href, 'http://localhost').searchParams;
  expect(params.get('checkin')).toBe(today);
  expect(Date.parse(params.get('checkout') ?? '') - Date.parse(today)).toBe(86_400_000);
  expect(params.get('room')).toBe('2');
  expect(params.get('collection')).toBe('deals');
  await expectNoAxeViolations(page);

  await link.click();
  await expect(page).toHaveURL(/collection=deals/);
  // The collection is chosen on arrival, whether or not tonight has a deal in this city.
  await expect(page.getByTestId('hotel-collection-deals')).toBeChecked({ timeout: 30_000 });
  await expect(page.getByTestId('collection-help')).toHaveText(t('results.collections.help.deals'));
});
