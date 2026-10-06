import type { Page } from '@playwright/test';

import { catalogEntryFor, COOKIE_CATALOG } from '../lib/cookie-catalog';

import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * ADR-042: the cookie settings dialog lists everything the site stores, and an optional category
 * is only stored as chosen once the API has recorded the choice.
 */

const PASSWORD = 'a perfectly long passphrase';
const CONSENT =
  /^1\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(\d)(\d)$/;

async function openCookieSettings(page: Page) {
  await page
    .getByRole('contentinfo')
    .getByRole('button', { name: t('footer.cookieSettings') })
    .click();
  const dialog = page.getByRole('dialog', { name: t('cookies.title') });
  await expect(dialog.getByTestId('cookie-save')).toBeVisible();
  return dialog;
}

const consentCookie = async (page: Page) =>
  (await page.context().cookies()).find((cookie) => cookie.name === 'suskii_consent')?.value;

test.describe('cookies', () => {
  test('lists every cookie and storage key the site sets', async ({ page }) => {
    await page.goto('/');
    const dialog = await openCookieSettings(page);
    for (const entry of COOKIE_CATALOG) await expect(dialog).toContainText(entry.name);
    await expect(dialog).toContainText(t('cookies.notInUse'));
    await expectNoAxeViolations(page);
    await dialog.getByTestId('cookie-save').click();
    await expect(dialog.getByRole('status')).toHaveText(t('cookies.saved'));
    await page.keyboard.press('Escape');

    // A visit that touches every kind of storage: currency, a flight search, an account.
    await page
      .getByRole('navigation', { name: t('header.utilityNav') })
      .getByLabel(t('header.currency'))
      .selectOption('USD');
    const email = `cookies-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByTestId('register-email').fill(email);
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-done')).toBeVisible();
    await page.goto('/sign-in?next=/account');
    await page.getByTestId('sign-in-email').fill(email);
    await page.getByTestId('sign-in-password').fill(PASSWORD);
    await page.getByTestId('sign-in-submit').click();
    await page.waitForURL(/\/account$/);

    await expect(page.getByTestId('account-profile')).toBeVisible();
    const cookies = (await page.context().cookies()).map((cookie) => cookie.name);
    const purposes = cookies.map((name) => catalogEntryFor(name, 'cookie')?.purpose);
    expect(purposes).toEqual(
      expect.arrayContaining(['access', 'refresh', 'csrf', 'currency', 'consent']),
    );
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    const missing = [
      ...cookies.filter((name) => !catalogEntryFor(name, 'cookie')),
      ...storage.local.filter((name) => !catalogEntryFor(name, 'localStorage')),
      ...storage.session.filter((name) => !catalogEntryFor(name, 'sessionStorage')),
    ];
    expect(missing, 'stored but not listed in lib/cookie-catalog.ts').toEqual([]);
    // Nothing optional is in use yet; the first optional entry needs the first-visit prompt.
    expect(COOKIE_CATALOG.filter((entry) => entry.category !== 'necessary')).toEqual([]);
  });

  test.describe('choices', () => {
    // The refused save below is logged by the browser.
    test.use({ allowedConsoleErrors: [/status of 503/] });

    test('stores a choice only after the API recorded it', async ({ page }) => {
      await page.goto('/');
      let dialog = await openCookieSettings(page);
      await expect(dialog.getByTestId('cookie-choice-analytics')).not.toBeChecked();
      await expect(dialog.getByTestId('cookie-choice-marketing')).not.toBeChecked();

      // The record fails: nothing is stored and the visitor is told.
      await page.route('**/v1/privacy/cookie-consents', (route) =>
        route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{}' }),
      );
      await dialog.getByTestId('cookie-choice-analytics').check();
      await dialog.getByTestId('cookie-save').click();
      await expect(dialog.getByRole('alert')).toHaveText(t('cookies.error'));
      expect(await consentCookie(page)).toBeUndefined();

      await page.unroute('**/v1/privacy/cookie-consents');
      const [recorded] = await Promise.all([
        page.waitForResponse((response) => response.url().endsWith('/v1/privacy/cookie-consents')),
        dialog.getByTestId('cookie-save').click(),
      ]);
      expect(recorded.status()).toBe(201);
      await expect(dialog.getByRole('status')).toHaveText(t('cookies.saved'));
      const first = CONSENT.exec((await consentCookie(page)) ?? '');
      expect(first?.slice(1)).toEqual(['1', '0']);

      // The choice survives a reload, and changing it keeps the same consent id.
      await page.reload();
      dialog = await openCookieSettings(page);
      await expect(dialog.getByTestId('cookie-choice-analytics')).toBeChecked();
      await dialog.getByTestId('cookie-choice-analytics').uncheck();
      await dialog.getByTestId('cookie-save').click();
      await expect(dialog.getByRole('status')).toHaveText(t('cookies.saved'));
      const second = (await consentCookie(page)) ?? '';
      expect(CONSENT.exec(second)?.slice(1)).toEqual(['0', '0']);
      expect(second.split('.')[1]).toBe(first?.[0].split('.')[1]);
    });
  });
});
