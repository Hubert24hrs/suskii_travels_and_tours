import { expect, expectNoAxeViolations, expectToast, signIn, t, test } from './fixtures';

/**
 * ADR-040: a payment the risk checks held waits in the queue; finance releases it, and the
 * booking goes on to fulfilment.
 */
test('finance releases a payment held by the risk review', async ({ page, stack }) => {
  const { id, reference } = stack.heldBooking;
  await signIn(page, stack, 'riskReviewer');
  await page.goto('/payment-reviews');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('paymentReviews.title'));
  const row = page.getByRole('row', { name: new RegExp(reference) });
  await expect(row).toContainText(t('paymentReviews.signalNames.card_country_mismatch'));
  await expectNoAxeViolations(page);

  await row.getByRole('button', { name: t('paymentReviews.approveFor', { reference }) }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('paymentReviews.approved'));
  await expect(page.getByRole('row', { name: new RegExp(reference) })).toHaveCount(0);

  // Fulfilment runs in the background after the approval.
  await page.goto(`/bookings/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(reference);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(t('bookingStatus.CONFIRMED'), { exact: true }).first()).toBeVisible(
      { timeout: 1_000 },
    );
  }).toPass({ timeout: 15_000 });
});
