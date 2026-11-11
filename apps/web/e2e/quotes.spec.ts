import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';

/**
 * Price requests on the website (ADR-104). A signed-in traveller asks for a price to be
 * confirmed, sees it waiting, and withdraws it. Verifying a price, paying an offer and booking
 * it by hand need staff and are covered against the API (`assisted-quotes.e2e-spec.ts`) and in
 * the console; here the offer a traveller would see is the API's own answer for their request
 * with a verified price put on it in the browser, to check what the page then shows.
 */

// A tab without the account's session gets 401 from the API on purpose.
test.use({ allowedConsoleErrors: [/status of 401/] });

const PASSWORD = 'Sunny-Harbour-Kite-42!';
const newEmail = (label: string): string =>
  `${label}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

async function register(page: Page, label: string): Promise<void> {
  await page.goto('/register');
  await page.getByTestId('register-email').fill(newEmail(label));
  await page.getByTestId('register-password').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  await page.waitForURL((url) => url.pathname === '/account');
}

test('a visitor is told to sign in before asking for a price', async ({ page }) => {
  await page.goto('/quotes');
  await expect(page.getByRole('heading', { level: 1, name: t('quotes.heading') })).toBeVisible();
  await expect(page.getByText(t('quotes.signIn'))).toBeVisible();
  await expect(page.getByTestId('quote-ask')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expectNoAxeViolations(page);
});

test('a traveller asks for a price, sees it waiting, reads an offer and withdraws', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await register(page, 'web-quotes');
  await page.goto('/quotes');
  await expect(page.getByText(t('quotes.empty'))).toBeVisible();
  await expectNoAxeViolations(page);

  const form = page.getByTestId('quote-ask');
  await form.getByLabel(t('quotes.ask.product')).selectOption('hotel');
  await form.getByLabel(t('quotes.ask.what')).fill('Lagoon View Hotel, sea view room');
  await form.getByLabel(t('quotes.ask.destination')).fill('Lagos');
  await form.getByLabel(t('quotes.ask.startDate')).fill(isoDaysFromToday(30));
  await form.getByLabel(t('quotes.ask.endDate')).fill(isoDaysFromToday(33));
  await form.getByTestId('quote-ask-submit').click();
  await expect(form.getByText(t('quotes.ask.sent'))).toBeVisible();

  // It waits for a person; nothing is priced or bookable yet.
  const row = page.getByTestId('quote-list').getByRole('listitem').first();
  await expect(row).toContainText('Lagoon View Hotel, sea view room');
  await expect(row).toContainText(t('quotes.statuses.requested'));
  await row.getByRole('link', { name: /Q-[A-Z0-9]{6}/ }).click();
  await page.waitForURL(/\/quotes\/[0-9a-f-]{36}$/);
  const detail = page.getByTestId('quote-detail');
  await expect(detail.getByTestId('quote-status')).toHaveText(t('quotes.statuses.requested'));
  await expect(detail).toContainText('Lagos');
  await expect(detail.getByTestId('quote-book')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expectNoAxeViolations(page);

  // Once a person has verified the price, the page shows the offer and where to book it.
  const offerQuoteId = '018f3a5c-7b1e-7c3a-9d2f-5a6b7c8d9e0f';
  await page.route(/\/v1\/quotes\/assisted\/[0-9a-f-]{36}$/, async (route) => {
    const response = await route.fetch();
    const quote = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...quote,
        status: 'offered',
        offer: {
          quoteId: offerQuoteId,
          total: { amountMinor: 18_500_000, currency: 'NGN' },
          details: {
            title: 'Lagoon View Hotel, sea view room',
            summary: 'Three nights with breakfast. Free cancellation until seven days before.',
            startDate: isoDaysFromToday(30),
            endDate: isoDaysFromToday(33),
            cityName: 'Lagos',
            countryCode: 'NG',
            refundable: true,
          },
          expiresAt: new Date(Date.now() + 90 * 60_000).toISOString(),
        },
      },
    });
  });
  await page.reload();
  await expect(detail.getByTestId('quote-status')).toHaveText(t('quotes.statuses.offered'));
  await expect(detail).toContainText('Three nights with breakfast');
  await expect(detail).toContainText(t('quotes.offer.verified'));
  await expect(detail).toContainText(t('quotes.offer.afterPayment'));
  await expect(detail.getByTestId('quote-total')).toContainText('185,000');
  await expect(detail.getByTestId('quote-book')).toHaveAttribute(
    'href',
    `/checkout/${offerQuoteId}`,
  );
  await expectNoAxeViolations(page);
  await page.unroute(/\/v1\/quotes\/assisted\/[0-9a-f-]{36}$/);

  // Back to what the API holds: the traveller withdraws the request.
  await page.reload();
  await detail.getByTestId('quote-withdraw').click();
  await expect(detail.getByTestId('quote-status')).toHaveText(t('quotes.statuses.withdrawn'));
  await expect(detail.getByTestId('quote-withdraw')).toHaveCount(0);

  // Another account cannot open it.
  const url = page.url();
  await page.context().clearCookies();
  await page.goto(url);
  await expect(page.getByTestId('quote-missing')).toContainText(t('quotes.notFound'));
});
