import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * Phase 9: the account area on the web. A visitor registers, signs in (the header switches to
 * the account link), manages notifications, joins Suskii Prime through the normal booking and
 * mock payment flow, downloads their data, and finally deletes the account (ADR-029, ADR-030).
 */

const PASSWORD = 'a perfectly long passphrase';

/** A unique address per test run, so reruns against a long-lived stack never collide. */
const newEmail = (label: string): string =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

/** A message with one placeholder as a regex, e.g. "You are a member until (.+)." */
const pattern = (text: string): RegExp =>
  new RegExp(
    text
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+'),
  );

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await expectNoAxeViolations(page);
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('register-done')).toHaveText(t('auth.register.done'));
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in?next=/account');
  await expect(page.getByTestId('header-account')).toHaveText(t('header.signIn'));
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL(/\/account$/);
  await expect(page.getByTestId('account-profile')).toBeVisible();
  await expect(page.getByTestId('header-account')).toHaveText(t('header.account'));
}

test.describe('account', () => {
  test('registers, signs in, sets notifications, joins Prime and exports the data', async ({
    page,
  }) => {
    const email = newEmail('web-account');
    await register(page, email);
    await signIn(page, email);
    await expect(page.getByText(t('account.signedInAs', { name: email }))).toBeVisible();
    await expectNoAxeViolations(page);

    // Every section loads for a new account.
    const sections: [path: string, card: string][] = [
      ['trips', 'account-trips'],
      ['travellers', 'account-travellers'],
      ['security', 'account-sessions'],
      ['referrals', 'account-referrals'],
      ['alerts', 'account-alerts'],
      ['wallet', 'account-wallet'],
    ];
    for (const [path, card] of sections) {
      await page
        .getByRole('navigation', { name: t('account.nav.label') })
        .getByRole('link', { name: t(`account.nav.${path}` as 'account.nav.trips') })
        .click();
      await page.waitForURL(new RegExp(`/account/${path}$`));
      await expect(page.getByTestId(card)).toBeVisible();
    }
    await page.goto('/account/referrals');
    await expect(page.getByTestId('referral-code')).toHaveText(/^[A-Z2-9]{8}$/);
    await expectNoAxeViolations(page);

    // Notifications: booking emails are mandatory; an optional channel saves at once.
    await page.goto('/account/notifications');
    await expect(page.getByTestId('notify-booking-email')).toBeDisabled();
    await expect(page.getByTestId('notify-booking-email')).toBeChecked();
    await page.getByTestId('notify-price_alert-whatsapp').check();
    await expect(page.getByText(t('account.saved'))).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('notify-price_alert-whatsapp')).toBeChecked();
    await expectNoAxeViolations(page);

    // Prime: the sample plan is a normal booking paid on the mock provider's page.
    await page.goto('/account/prime');
    await expect(page.getByTestId('prime-status')).toHaveText(t('account.prime.notMember'));
    await page.goto('/prime');
    await expect(page.getByText(t('prime.sample')).first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByTestId('join-suskii-prime-sample').click();
    await expect(page.getByTestId('prime-email')).toHaveValue(email);
    await page.getByTestId('prime-given-names').fill('Ngozi');
    await page.getByTestId('prime-surname').fill('Eze');
    await page.getByTestId('prime-phone').fill('+234 801 234 5678');
    await expect(page.getByTestId('prime-continue')).toBeDisabled();
    await page.getByTestId('prime-terms').check();
    await page.getByTestId('prime-continue').click();
    await page.waitForURL(/\/bookings\//);
    await expect(page.getByTestId('booking-membership')).toContainText(
      t('booking.membership.pending'),
    );
    await page.getByRole('button', { name: t('booking.retryPayment') }).click();
    await page.waitForURL(/\/checkout\/mock-payment\//);
    await page.getByRole('button', { name: /^Pay / }).click();
    await page.waitForURL(/\/bookings\//);
    await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
      timeout: 30_000,
    });
    await expect(page.getByTestId('booking-membership')).toContainText(
      pattern(t('booking.membership.term')),
    );
    await page.goto('/account/prime');
    await expect(page.getByTestId('prime-status')).toHaveText(pattern(t('account.prime.member')));
    await expect(
      page.getByTestId('account-prime').getByRole('link', { name: /Suskii Prime/ }),
    ).toHaveAttribute('href', /^\/bookings\//);
    // A membership is not a trip: it shows under Prime only.
    await page.goto('/account/trips');
    await expect(page.getByTestId('account-trips')).toContainText(t('account.trips.empty'));

    // Data export: the password unlocks a JSON download with every section.
    await page.goto('/account/privacy');
    await page.getByTestId('export-password').fill(PASSWORD);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-submit').click(),
    ]);
    expect(download.suggestedFilename()).toBe('suskii-data-export.json');
    const exported = JSON.parse(await readFile(await download.path(), 'utf8')) as {
      format: string;
      data: Record<string, unknown>;
    };
    expect(exported.format).toBe('suskii-data-export');
    expect(Object.keys(exported.data)).toEqual(
      expect.arrayContaining(['profile', 'bookings', 'memberships', 'notificationPreferences']),
    );
    await expect(page.getByText(t('account.privacy.exportReady'))).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test.describe('deletion', () => {
    // The last sign-in attempt is refused, which the browser logs.
    test.use({ allowedConsoleErrors: [/status of 401/] });

    test('deletes an account after re-authentication; the sign-in then fails', async ({ page }) => {
      const email = newEmail('web-delete');
      await register(page, email);
      await signIn(page, email);

      await page.goto('/account/privacy');
      const card = page.getByTestId('account-delete');
      await expect(card).toBeVisible();
      await card.getByTestId('delete-password').fill(PASSWORD);
      await expect(page.getByTestId('delete-submit')).toBeDisabled();
      await page.getByTestId('delete-confirm').fill('DELETE');
      await page.getByTestId('delete-submit').click();
      await expect(card).toContainText(t('account.privacy.deleted'));
      await page.waitForURL((url) => url.pathname === '/');
      await expect(page.getByTestId('header-account')).toHaveText(t('header.signIn'));

      await page.goto('/sign-in');
      await page.getByTestId('sign-in-email').fill(email);
      await page.getByTestId('sign-in-password').fill(PASSWORD);
      await page.getByTestId('sign-in-submit').click();
      await expect(page.getByText(t('auth.signIn.errors.invalid'))).toBeVisible();
    });
  });

  test('signs out and forgets the guest booking tokens of this tab', async ({ page }) => {
    const email = newEmail('web-sign-out');
    await register(page, email);
    await signIn(page, email);
    // A guest checkout earlier in this tab left its booking token behind.
    await page.evaluate(() => {
      sessionStorage.setItem('suskii.booking.0192d3a0-7c1e-7b2a-9f00-00000000b001', 'guest-token');
      sessionStorage.setItem('suskii.unrelated', 'kept');
    });

    await page.getByTestId('sign-out').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('header-account')).toHaveText(t('header.signIn'));
    const stored = await page.evaluate(() => Object.keys(sessionStorage));
    expect(stored.filter((name) => name.startsWith('suskii.booking.'))).toEqual([]);
    expect(stored).toContain('suskii.unrelated');
  });

  test('sends visitors to sign in and back to the page they asked for', async ({ page }) => {
    await page.goto('/account/wallet');
    await page.waitForURL(/\/sign-in\?next=%2Faccount%2Fwallet$/);
    await expect(page.getByTestId('sign-in-email')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
