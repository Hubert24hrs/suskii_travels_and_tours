import { expect, isoDaysFromToday, t, test } from './fixtures';

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
    expect(cookies.find((cookie) => cookie.name === '__Host-suskii_currency')?.value).toBe('USD');
  });

  test('switching language changes the document locale', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByLabel(t('footer.language')).selectOption('en-US');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  });

  test('data saver asks for fewer results, from the footer or the phone (ADR-075)', async ({
    page,
    context,
  }) => {
    const results = `/flights/search?trip=one_way&from=LOS&to=ABV&depart=${isoDaysFromToday(32)}&adults=1`;
    const searchLimit = async (): Promise<string | null> => {
      const request = page.waitForRequest(
        (candidate) =>
          candidate.method() === 'POST' &&
          new URL(candidate.url()).pathname === '/v1/flights/searches',
      );
      await page.goto(results);
      return new URL((await request).url()).searchParams.get('limit');
    };
    expect(await searchLimit()).toBe('20');

    await page.getByRole('contentinfo').getByLabel(t('footer.dataSaver')).selectOption('on');
    await expect(page.getByRole('contentinfo').getByLabel(t('footer.dataSaver'))).toHaveValue('on');
    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === '__Host-suskii_data_saver')?.value).toBe('on');
    expect(await searchLimit()).toBe('10');
    await expect(page.getByTestId('flight-offer').first()).toBeVisible({ timeout: 30_000 });
    expect(await page.getByTestId('flight-offer').count()).toBeLessThanOrEqual(10);

    // Without a choice, the phone's own data saver (the Save-Data signal) turns it on.
    await context.clearCookies({ name: '__Host-suskii_data_saver' });
    const resultsPage = (url: URL): boolean => url.pathname === '/flights/search';
    await page.route(resultsPage, (route) =>
      route.continue({ headers: { ...route.request().headers(), 'save-data': 'on' } }),
    );
    expect(await searchLimit()).toBe('10');
    await page.unroute(resultsPage);
    expect(await searchLimit()).toBe('20');
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
