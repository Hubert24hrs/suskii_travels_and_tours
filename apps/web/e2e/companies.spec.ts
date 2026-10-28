import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, t, test } from './fixtures';

/**
 * Company accounts (ADR-078) on the website: a visitor creates a company, sets a policy where
 * every trip needs an approver, books a tour for the company and sees it wait for approval; the
 * booking cannot be paid, and nobody approves their own trip.
 */

const PASSWORD = 'a perfectly long passphrase';
const newEmail = (label: string): string =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  await page.waitForURL(/\/account$/);
  await expect(page.getByTestId('account-profile')).toBeVisible();
}

test.describe('company accounts', () => {
  test('creates a company, books a trip for it and waits for an approver', async ({ page }) => {
    const email = newEmail('web-company');
    await register(page, email);

    await page
      .getByRole('navigation', { name: t('account.nav.label') })
      .getByRole('link', { name: t('account.nav.company') })
      .click();
    await page.waitForURL(/\/account\/company$/);
    const create = page.getByTestId('company-create');
    await expect(create).toContainText(t('account.company.none'));
    await expectNoAxeViolations(page);
    await page.locator('#company-name').fill('Acme Logistics');
    await page.locator('#company-billing-email').fill('accounts@acme.example');
    await create.getByRole('button', { name: t('account.company.create') }).click();

    await expect(page.getByTestId('company-role')).toHaveText(
      t('account.company.yourRole', { role: t('account.company.roles.admin') }),
    );
    const policy = page.getByTestId('company-policy');
    await policy.locator('#policy-approval').selectOption('always');
    await policy.getByRole('button', { name: t('account.company.save') }).click();
    await expect(policy.getByRole('status')).toHaveText(t('account.company.saved'));
    await expect(page.getByTestId('company-members')).toContainText(
      t('account.company.members.you', { name: email }),
    );
    await expect(page.getByTestId('company-spend')).toContainText(
      t('account.company.report.empty'),
    );
    await expectNoAxeViolations(page);

    // Book a tour for the company: it waits for an approver instead of going to payment.
    await page.goto('/tours/sample-dubai-desert-evening?adults=1');
    await page.getByRole('button', { name: t('inhouse.book.submit') }).click();
    await page.waitForURL(/\/checkout\//);
    await page.getByTestId('checkout-company').check();
    await page.locator('#passenger-0-title').selectOption('mr');
    await page.locator('#passenger-0-gender').selectOption('m');
    await page.locator('#passenger-0-givenNames').fill('Chidi');
    await page.locator('#passenger-0-surname').fill('Okafor');
    await page.locator('#passenger-0-dateOfBirth').fill('1988-02-01');
    await page.locator('#passenger-0-nationality').selectOption('NG');
    await page.locator('#contact-email').fill(email);
    await page.locator('#contact-phone').fill('+234 801 234 5678');
    await page.getByLabel(t('checkout.terms')).check();
    await page.getByRole('button', { name: t('checkout.pay') }).click();

    await page.waitForURL(/\/bookings\//);
    await expect(page.getByTestId('booking-company')).toHaveText(t('booking.company.pending'));
    await expect(page.getByRole('button', { name: t('booking.retryPayment') })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // The company lists the trip; its booker cannot approve it.
    await page.goto('/account/company');
    const trips = page.getByTestId('company-trips');
    await expect(trips).toContainText('Dubai desert evening');
    await expect(trips).toContainText(t('booking.company.status.pending'));
    await expect(
      page
        .getByTestId('company-approvals')
        .getByRole('button', { name: t('account.company.approvals.approve') }),
    ).toHaveCount(0);
  });

  test('an invitation page without a link explains what to open', async ({ page }) => {
    await page.goto('/company/join');
    await expect(page.getByText(t('account.company.join.missing'))).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
