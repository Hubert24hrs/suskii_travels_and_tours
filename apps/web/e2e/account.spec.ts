import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, t, test } from './fixtures';
import { totp } from './totp';

/**
 * Phase 9: the account area on the web. A visitor registers, signs in (the header switches to
 * the account link), manages notifications, joins Suskii Prime through the normal booking and
 * mock payment flow, downloads their data, and finally deletes the account (ADR-029, ADR-030).
 */

const PASSWORD = 'a perfectly long passphrase';
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

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

/** Creates the account, which signs straight in and opens the account page. */
async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await expectNoAxeViolations(page);
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  await page.waitForURL(/\/account$/);
  await expect(page.getByTestId('account-profile')).toBeVisible();
  await expect(page.getByTestId('header-account')).toHaveText(t('header.account'));
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
    // Sign out and in again with the password.
    await page.getByTestId('sign-out').click();
    await page.waitForURL((url) => url.pathname === '/');
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

  test('says when the email already had an account, instead of signing in', async ({ page }) => {
    const email = newEmail('web-existing');
    await register(page, email);
    await page.getByTestId('sign-out').click();
    await page.waitForURL((url) => url.pathname === '/');

    await page.goto('/register');
    await page.getByTestId('register-email').fill(email);
    await page.getByTestId('register-password').fill('another perfectly long passphrase');
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-done')).toHaveText(t('auth.register.existing'));
    await expect(page.getByTestId('header-account')).toHaveText(t('header.signIn'));
  });

  test('signs up with Google on the test stack, and signs in again as the same account', async ({
    page,
  }) => {
    const email = newEmail('web-google');
    const google = async () => {
      await page.getByTestId('social-google').click();
      const dialog = page.getByRole('dialog', { name: t('auth.social.mockTitle') });
      await expect(dialog).toBeVisible();
      await expectNoAxeViolations(page);
      await dialog.getByTestId('social-mock-email').fill(email);
      await dialog.getByTestId('social-mock-name').fill('Ada Okafor');
      await dialog.getByTestId('social-mock-submit').click();
      await page.waitForURL(/\/account$/);
      await expect(page.getByTestId('account-profile')).toBeVisible();
    };
    await page.goto('/register');
    await google();
    await expect(page.getByText(t('account.signedInAs', { name: 'Ada Okafor' }))).toBeVisible();

    await page.getByTestId('sign-out').click();
    await page.waitForURL((url) => url.pathname === '/');
    await page.goto('/sign-in?next=/account');
    await expect(page.getByTestId('social-apple')).toBeVisible();
    await google();
    await expect(page.getByText(t('account.signedInAs', { name: 'Ada Okafor' }))).toBeVisible();
  });

  test("finishes a Google return with the account's second factor on the callback page", async ({
    page,
    request,
  }) => {
    // Google's return trip as the provider makes it: the ID token in the fragment, for the nonce
    // and state this tab saved before leaving (ADR-067). The mock signs the token.
    const email = newEmail('web-google-mfa');
    const nonce = async (): Promise<string> => {
      const response = await request.post(`${API}/v1/auth/social/nonce`, { data: {} });
      return ((await response.json()) as { nonce: string }).nonce;
    };
    const idToken = async (forNonce: string): Promise<string> => {
      const response = await request.post(`${API}/v1/auth/social/mock-token`, {
        data: { provider: 'google', email, name: 'Ada Okafor', nonce: forNonce },
      });
      return ((await response.json()) as { idToken: string }).idToken;
    };
    // The account already exists, with an authenticator.
    const first = await nonce();
    const created = await request.post(`${API}/v1/auth/google`, {
      data: { idToken: await idToken(first), nonce: first, transport: 'token' },
    });
    const { accessToken } = (await created.json()) as { accessToken: string };
    const headers = { authorization: `Bearer ${accessToken}` };
    const setup = await request.post(`${API}/v1/me/mfa/totp`, { headers, data: {} });
    const { secret } = (await setup.json()) as { secret: string };
    const confirmed = await request.post(`${API}/v1/me/mfa/totp/confirm`, {
      headers,
      data: { code: totp(secret) },
    });
    expect(confirmed.ok()).toBe(true);

    const second = await nonce();
    const state = randomBytes(24).toString('base64url');
    const pending = JSON.stringify({
      provider: 'google',
      state,
      nonce: second,
      next: '/account',
      referralCode: null,
      appState: null,
    });
    await page.addInitScript((value) => {
      if (window.location.pathname === '/sign-in/callback')
        sessionStorage.setItem('suskii:social-sign-in', value);
    }, pending);
    const fragment = new URLSearchParams({ id_token: await idToken(second), state });
    await page.goto(`/sign-in/callback#${fragment.toString()}`);

    await expect(page.getByText(t('auth.signIn.mfaHeading'))).toBeVisible();
    // The token never stays in the address bar.
    expect(new URL(page.url()).hash).toBe('');
    await page.getByTestId('mfa-code').fill(totp(secret, 1));
    await page.getByRole('button', { name: t('auth.signIn.submitMfa') }).click();
    await page.waitForURL(/\/account$/);
    await expect(page.getByText(t('account.signedInAs', { name: 'Ada Okafor' }))).toBeVisible();
  });

  test('sends visitors to sign in and back to the page they asked for', async ({ page }) => {
    await page.goto('/account/wallet');
    await page.waitForURL(/\/sign-in\?next=%2Faccount%2Fwallet$/);
    await expect(page.getByTestId('sign-in-email')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
