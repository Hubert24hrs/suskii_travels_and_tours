import type { Page } from '@playwright/test';
import { createFormatters } from '@suskii/i18n';

import { expect, t, test } from './fixtures';

/**
 * Suskii Prime priced per country (ADR-082). The demo plan costs USD 25, and USD 18 for visitors
 * from Ghana; the website passes the visitor's edge country (`cf-ipcountry` on the stack, as
 * behind Cloudflare) with its plans request.
 */
const format = createFormatters('en-NG');

async function primeInDollars(page: Page): Promise<void> {
  await page.goto('/prime');
  await page
    .getByRole('navigation', { name: t('header.utilityNav') })
    .getByLabel(t('header.currency'))
    .selectOption('USD');
}

test.describe('Prime prices per country', () => {
  test("shows the visitor's country price, else the price for everywhere", async ({ browser }) => {
    const ghana = await browser.newContext({ extraHTTPHeaders: { 'cf-ipcountry': 'GH' } });
    const fromGhana = await ghana.newPage();
    await primeInDollars(fromGhana);
    await expect(fromGhana.getByTestId('plan-suskii-prime-sample')).toContainText(
      format.money({ amountMinor: 1_800, currency: 'USD' }),
    );
    await ghana.close();

    const kenya = await browser.newContext({ extraHTTPHeaders: { 'cf-ipcountry': 'KE' } });
    const fromKenya = await kenya.newPage();
    await primeInDollars(fromKenya);
    const card = fromKenya.getByTestId('plan-suskii-prime-sample');
    await expect(card).toContainText(format.money({ amountMinor: 2_500, currency: 'USD' }));
    await expect(card).not.toContainText(format.money({ amountMinor: 1_800, currency: 'USD' }));
    await kenya.close();
  });
});
