import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * The public status page (ADR-087). Incidents, measured states and the cache are covered against
 * the API (`apps/api/test/status.e2e-spec.ts`) and the console journey; here a traveller finds
 * the page from the footer and every part of the service reads as working, with no banner.
 */
test('the footer leads to the status page, all working and without a banner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status-banner')).toHaveCount(0);
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: t('status.link') })
    .click();
  await page.waitForURL(/\/status$/);
  await expect(page.getByRole('heading', { level: 1, name: t('status.heading') })).toBeVisible();
  await expect(page.getByTestId('status-overall')).toContainText(t('status.overall.operational'));
  for (const component of ['search', 'bookings', 'payments', 'accounts', 'support'] as const) {
    await expect(page.getByTestId(`status-${component}`)).toHaveText(
      t('status.states.operational'),
    );
  }
  await expect(page.getByText(t('status.noIncidents'))).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/status$/);
  await expectNoAxeViolations(page);
});
