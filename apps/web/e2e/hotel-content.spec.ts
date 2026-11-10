import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';

/**
 * What a property is, on the results and on its page (ADR-096): a picture and the property type
 * on each card, a filter by type, and on the hotel page the photos, a description and each
 * room's details. The demo supplier's pictures are drawn by this site (`/art/hotels`). The
 * rules are covered against the API (`apps/api/test/search.e2e-spec.ts`).
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

async function lagos(page: Page): Promise<string> {
  const airport = (await (await page.request.get(`${API}/v1/catalog/airports/LOS`)).json()) as {
    cityId: string;
  };
  return `/hotels/search?dest=${airport.cityId}&checkin=${isoDaysFromToday(30)}&checkout=${isoDaysFromToday(33)}&room=2`;
}

/** Every image inside `scope` has loaded and has pixels. */
const loadedImages = (page: Page, scope: string) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll<HTMLImageElement>(`${selector} img`)].map(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    scope,
  );

test('shows a picture and the type on each card, and filters by property type', async ({
  page,
}) => {
  await page.goto(await lagos(page));
  const hotels = page.getByTestId('hotel-result');
  await expect(hotels.first()).toBeVisible({ timeout: 30_000 });

  // Every card has a picture, served by this site and decorative beside the hotel's name.
  const first = hotels.first();
  const picture = first.getByTestId('hotel-photo').locator('img');
  await expect(picture).toHaveAttribute('src', /^\/art\/hotels\/[a-z0-9]{10}-exterior\.svg$/);
  await expect(picture).toHaveAttribute('alt', '');
  await picture.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await loadedImages(page, '[data-testid="hotel-photo"]'))[0])
    .toBe(true);
  await expectNoAxeViolations(page);

  // The type filter lists what the search found; choosing one narrows the list on the API.
  const resort = page.getByLabel(new RegExp(`^${t('results.propertyTypes.resort')} \\(\\d+\\)$`));
  const label = (await resort.locator('xpath=ancestor-or-self::label').textContent()) ?? '';
  const expected = Number(/\((\d+)\)/.exec(label)?.[1] ?? '0');
  expect(expected).toBeGreaterThan(0);
  await resort.check();
  await expect(page).toHaveURL(/types=resort/);
  await expect(page.locator('#hotel-results-count')).toContainText(String(expected));
  await expect
    .poll(async () => {
      const cards = await hotels.all();
      const texts = await Promise.all(cards.map((card) => card.textContent()));
      return texts.every((text) => text?.includes(t('results.propertyTypes.resort')));
    })
    .toBe(true);
});

test('shows the photos, a description and room details on the hotel page', async ({ page }) => {
  await page.goto(await lagos(page));
  const first = page.getByTestId('hotel-result').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const name = (await first.getByRole('heading').textContent()) ?? '';
  await first.getByRole('link', { name: /See rooms/ }).click();
  await page.waitForURL(/\/hotels\/stay\//);

  const gallery = page.getByTestId('hotel-gallery');
  await expect(gallery).toBeVisible({ timeout: 30_000 });
  const pictures = gallery.locator('img');
  expect(await pictures.count()).toBeGreaterThanOrEqual(2);
  // Each picture is named for screen readers: the hotel, its place in the set and a caption.
  await expect(pictures.first()).toHaveAttribute(
    'alt',
    new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: photo 1 of \\d\\. `),
  );
  await expect
    .poll(async () => (await loadedImages(page, '[data-testid="hotel-gallery"]'))[0])
    .toBe(true);
  await expect(page.getByText(t('results.stayContent.samplePhotos'))).toBeVisible();
  // The strip scrolls with the keyboard.
  await gallery.focus();
  await expect(gallery).toBeFocused();

  await expect(page.getByTestId('property-type')).toBeVisible();
  await expect(page.getByTestId('hotel-description')).toContainText(name);
  const room = page.getByTestId('hotel-rate').first().getByTestId('room-details');
  await expect(room).toContainText(/Sleeps \d/);
  await expect(room).toContainText(/\d+ m²/);
  await expect(room).toContainText(/\d × \w+ bed/);
  await expectNoAxeViolations(page);
});

test('keeps hotel results to text under the data saver', async ({ page }) => {
  const url = await lagos(page);
  await page.route(
    (target) => target.pathname.startsWith('/hotels/'),
    (route) => route.continue({ headers: { ...route.request().headers(), 'save-data': 'on' } }),
  );
  await page.goto(url);
  const first = page.getByTestId('hotel-result').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('hotel-photo')).toHaveCount(0);

  await first.getByRole('link', { name: /See rooms/ }).click();
  await page.waitForURL(/\/hotels\/stay\//);
  await expect(page.getByTestId('hotel-description')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('hotel-gallery')).toHaveCount(0);
});
