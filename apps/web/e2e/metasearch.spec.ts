import type { Page } from '@playwright/test';
import { createFormatters } from '@suskii/i18n';

import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * Metasearch landings (ADR-081). The API's side (partners, keys, prices, quotes, attribution)
 * is covered by its own e2e suite; here the page's answer to each outcome is checked by
 * answering the landing request in the browser, plus one real call with a forged link.
 */

const format = createFormatters('en-NG');
const QUOTE_ID = '0192f0e0-1111-7000-8000-000000000001';
const shown = { amountMinor: 18_500_000, currency: 'NGN' };
const current = { amountMinor: 19_250_000, currency: 'NGN' };
const request = {
  slices: [
    { origin: 'LOS', destination: 'ABV', departureDate: '2030-03-10' },
    { origin: 'ABV', destination: 'LOS', departureDate: '2030-03-17' },
  ],
  passengers: { adults: 1, children: 0, infants: 0 },
  cabinClass: 'economy',
  directOnly: false,
};
const slice = (origin: string, destination: string, day: string, flight: string) => ({
  origin: { code: origin },
  destination: { code: destination },
  departureLocal: `${day}T08:30`,
  departureUtc: `${day}T07:30:00.000Z`,
  segments: [{ marketingCarrier: { code: 'P4' }, flightNumber: flight }],
});

async function answerLanding(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.route('**/v1/metasearch/landings', (route) =>
    route.fulfill({
      status: 200,
      json: { partner: { name: 'Skyscanner' }, shown, request, ...body },
    }),
  );
}

test.describe('metasearch landings (ADR-081)', () => {
  test('goes straight to checkout when the price held', async ({ page }) => {
    await answerLanding(page, { outcome: 'same', quoteId: QUOTE_ID, current: shown, offer: {} });
    await page.goto('/flights/go/sealed-token');
    await page.waitForURL(`**/checkout/${QUOTE_ID}`);
  });

  test('shows both totals and the flights before continuing when the price rose', async ({
    page,
  }) => {
    await answerLanding(page, {
      outcome: 'higher',
      quoteId: QUOTE_ID,
      current,
      offer: {
        slices: [
          slice('LOS', 'ABV', '2030-03-10', '7120'),
          slice('ABV', 'LOS', '2030-03-17', '7121'),
        ],
      },
    });
    await page.goto('/flights/go/sealed-token');
    const card = page.getByTestId('metasearch-higher');
    await expect(
      card.getByRole('heading', { name: t('pages.metasearch.higherTitle') }),
    ).toBeVisible();
    await expect(card).toContainText(
      t('pages.metasearch.higherBody', {
        partner: 'Skyscanner',
        shown: format.money(shown),
        current: format.money(current),
      }),
    );
    await expect(card).toContainText('P47120');
    await expect(card).toContainText('P47121');
    await expect(page).toHaveTitle(new RegExp(t('pages.metasearch.title')));
    await expectNoAxeViolations(page);
    await card
      .getByRole('button', {
        name: t('pages.metasearch.continue', { price: format.money(current) }),
      })
      .click();
    await page.waitForURL(`**/checkout/${QUOTE_ID}`);
  });

  test('offers the same search when the flight is gone', async ({ page }) => {
    await answerLanding(page, {
      outcome: 'unavailable',
      quoteId: null,
      current: null,
      offer: null,
    });
    await page.goto('/flights/go/sealed-token');
    const card = page.getByTestId('metasearch-gone');
    await expect(card).toContainText(t('pages.metasearch.unavailableTitle'));
    const link = card.getByTestId('metasearch-other-flights');
    await expect(link).toHaveText(t('pages.metasearch.otherFlights'));
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toContain('/flights/search?');
    const params = new URL(href, 'http://localhost').searchParams;
    expect(params.get('from')).toBe('LOS');
    expect(params.get('to')).toBe('ABV');
    expect(params.get('return')).toBe('2030-03-17');
  });

  test('a lapsed price promise says so and offers the search', async ({ page }) => {
    await answerLanding(page, { outcome: 'expired', quoteId: null, current: null, offer: null });
    await page.goto('/flights/go/sealed-token');
    await expect(page.getByTestId('metasearch-gone')).toContainText(
      t('pages.metasearch.expiredTitle'),
    );
  });
});

test.describe('metasearch landings with a forged link', () => {
  // The API answers 404, which the browser logs as a failed resource.
  test.use({ allowedConsoleErrors: [/404/] });

  test('a forged link reaches the API, which refuses it, and the page offers a search', async ({
    page,
  }) => {
    await page.goto('/flights/go/forged-link');
    await expect(
      page.getByRole('heading', { name: t('pages.metasearch.expiredTitle') }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: t('pages.metasearch.otherFlights') }),
    ).toHaveAttribute('href', '/flights');
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', /noindex/);
  });
});
