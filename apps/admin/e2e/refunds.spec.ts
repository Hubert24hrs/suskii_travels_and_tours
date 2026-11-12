import { expect, expectNoAxeViolations, expectToast, signIn, t, test } from './fixtures';

/**
 * Maker-checker refunds (ADR-019): support requests a refund on a paid booking, which waits for
 * a second staff member with `refunds:approve`; finance approves it and it is paid out through
 * the (mock) provider.
 */
test('a refund requested by support is approved by finance', async ({ page, browser, stack }) => {
  const { id, reference } = stack.tourBooking;

  await signIn(page, stack, 'support');
  await page.goto(`/bookings/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(reference);
  const form = page.getByRole('form', { name: t('bookings.detail.requestRefund') });
  await form.getByTestId('refund-amount').fill('1000');
  await form.getByLabel(t('bookings.detail.refundNote')).fill('Goodwill after a late pickup');
  await form.getByRole('button', { name: t('bookings.detail.requestRefund') }).click();
  await expectToast(page, t('bookings.detail.refundRequested'));
  await expectNoAxeViolations(page);

  // Support may request but not approve.
  await page.goto('/refunds');
  const supportRow = page.getByRole('row', { name: new RegExp(reference) });
  await expect(supportRow).toContainText(t('refunds.statuses.pending_approval'));
  await expect(supportRow.getByRole('button', { name: t('refunds.approve') })).toHaveCount(0);

  const financeContext = await browser.newContext();
  const finance = await financeContext.newPage();
  try {
    await signIn(finance, stack, 'finance');
    await finance.goto('/refunds');
    const row = finance.getByRole('row', { name: new RegExp(reference) });
    await expect(row).toContainText('₦1,000');
    await expectNoAxeViolations(finance);
    await row.getByRole('button', { name: t('refunds.approve') }).click();
    await expectToast(finance, t('refunds.approved'));
    // It leaves the approval queue and is paid out.
    await expect(row).toHaveCount(0);
    await finance.getByLabel(t('refunds.status')).selectOption('');
    await expect(finance.getByRole('row', { name: new RegExp(reference) })).toContainText(
      new RegExp(`${t('refunds.statuses.succeeded')}|${t('refunds.statuses.processing')}`),
    );
  } finally {
    await financeContext.close();
  }
});
