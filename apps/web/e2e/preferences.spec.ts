import { expect, t, test } from './fixtures';

test.describe('preferences and sign-ups', () => {
  test('switching currency re-prices the offers', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.locator('#deals article').first()).toContainText('₦');
    await page
      .getByRole('navigation', { name: t('header.utilityNav') })
      .getByLabel(t('header.currency'))
      .selectOption('USD');
    await expect(page.locator('#deals article').first()).toContainText('$');
    await expect(page.locator('#deals article').first()).not.toContainText('₦');
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === 'suskii_currency')?.value).toBe('USD');
  });

  test('switching language changes the document locale', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('combobox').selectOption('en-US');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  });

  test('deal alerts need a valid email and consent, then ask for confirmation', async ({
    page,
  }) => {
    await page.goto('/');
    const section = page.locator('#newsletter');
    await section.getByRole('button', { name: t('sections.newsletter.submit') }).click();
    await expect(section.getByText(t('sections.newsletter.invalidEmail'))).toBeVisible();
    await expect(section.getByText(t('sections.newsletter.consentRequired'))).toBeVisible();

    await section.getByLabel(t('sections.newsletter.email')).fill(`e2e-${Date.now()}@example.com`);
    await section.getByRole('checkbox', { name: /I agree to receive deal alerts/ }).check();
    await section.getByRole('button', { name: t('sections.newsletter.submit') }).click();
    await expect(section.getByRole('status')).toHaveText(t('sections.newsletter.success'));
  });
});
