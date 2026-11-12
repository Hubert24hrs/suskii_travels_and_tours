import { expect, expectNoAxeViolations, expectToast, signIn, t, test } from './fixtures';

/**
 * ADR-077: a guest's review of a finished tour waits in the queue with what the automatic check
 * flagged; a content manager publishes it as written.
 */
test('a moderator publishes a waiting review as written', async ({ page, stack }) => {
  const { bookingReference, subject } = stack.review;
  await signIn(page, stack, 'reviewModerator');
  await page.goto('/reviews');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('reviews.title'));
  const row = page.getByRole('row', { name: new RegExp(bookingReference) });
  await expect(row).toContainText(subject);
  await expect(row).toContainText('Sunset over the dunes');
  await expect(row).toContainText(t('reviews.flagNames.contact_details'));
  // The lead traveller, Ada Eze, chose to show a first name and last initial.
  await expect(row).toContainText('Ada E.');
  await expectNoAxeViolations(page);

  await row.getByRole('button', { name: t('reviews.publishFor', { subject }) }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('reviews.published'));
  await expect(page.getByRole('row', { name: new RegExp(bookingReference) })).toHaveCount(0);

  await page.getByLabel(t('reviews.status')).selectOption('published');
  await expect(page.getByRole('row', { name: new RegExp(bookingReference) })).toContainText(
    t('reviews.statuses.published'),
  );
});
