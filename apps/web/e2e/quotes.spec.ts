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

  // The request as a PDF to keep or pass on, read with the session and named by us.
  const [saved] = await Promise.all([
    page.waitForEvent('download'),
    detail.getByTestId('quote-pdf').click(),
  ]);
  expect(saved.suggestedFilename()).toMatch(/^suskii-price-request-Q-[A-Z0-9]{6}\.pdf$/);

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

test('the checkout of an offer shows what a person verified, and that a person books it', async ({
  page,
  request,
}) => {
  // Verifying a price needs staff, so the offer's quote here is a real quote of the stack
  // (a sample tour) with the assisted item put on it in the browser: what is checked is the
  // page, with the shape the API answers for an assisted offer.
  const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
  const tour = (await (
    await request.get(`${API}/v1/tours/sample-dubai-desert-evening?adults=1`)
  ).json()) as { departures: { id: string; bookable: boolean }[] };
  const departure = tour.departures.find((candidate) => candidate.bookable);
  expect(departure, 'a bookable sample departure').toBeDefined();
  const { quoteId } = (await (
    await request.post(`${API}/v1/inhouse-quotes`, {
      data: {
        kind: 'tour',
        departureId: departure?.id,
        travellers: { adults: 1, children: 0, infants: 0 },
      },
    })
  ).json()) as { quoteId: string };

  await page.route(`**/v1/quotes/${quoteId}`, async (route) => {
    const response = await route.fetch();
    const quote = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...quote,
        vertical: 'assisted',
        tour: null,
        assisted: {
          product: {
            id: quoteId,
            slug: 'q-7k2m4x',
            title: 'Lagoon View Hotel, sea view room',
            sample: false,
            artKey: null,
          },
          kind: 'hotel',
          summary: 'Three nights with breakfast. Free cancellation until seven days before.',
          startDate: isoDaysFromToday(30),
          endDate: isoDaysFromToday(33),
          cityName: 'Lagos',
          countryCode: 'NG',
          travellers: { adults: 1, children: 0, infants: 0 },
          refundable: true,
          quoteId,
          supplierReference: null,
        },
      },
    });
  });
  await page.goto(`/checkout/${quoteId}`);

  const summary = page.getByTestId('assisted-summary');
  await expect(summary).toContainText('Lagoon View Hotel, sea view room');
  await expect(summary).toContainText('Lagos');
  await expect(summary).toContainText('Three nights with breakfast');
  await expect(summary).toContainText(t('quotes.offer.refundable'));
  await expect(summary).toContainText(t('quotes.offer.verified'));
  // Said before anything is paid: a person books it, and it is refunded if they cannot.
  await expect(summary).toContainText(t('quotes.offer.afterPayment'));
  // One traveller to name, as the offer was verified for.
  await expect(page.getByTestId('passenger-0')).toBeVisible();
  await expect(page.getByTestId('passenger-1')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expectNoAxeViolations(page);
});
