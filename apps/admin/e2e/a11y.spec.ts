import { NAV_ITEMS } from '../lib/permissions';

import { expect, expectNoAxeViolations, signIn, t, test } from './fixtures';

/**
 * axe on every console page (the sign-in, MFA and enrolment steps and the dialogs are checked in
 * the journeys). A super admin sees every section; detail pages use the provisioned records.
 */
test('every console page passes axe', async ({ page, stack }) => {
  await signIn(page, stack, 'axe');
  const paths = [
    ...NAV_ITEMS.map((item) => item.href),
    `/bookings/${stack.tourBooking.id}`,
    `/users/${stack.personas.customer.id}`,
    `/visa/${stack.visa.applicationId}`,
  ];
  for (const path of paths) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: t('common.loading') })).toHaveCount(
        0,
      );
      await expect(page.getByRole('alert').filter({ hasText: t('common.forbidden') })).toHaveCount(
        0,
      );
      await expectNoAxeViolations(page);
    });
  }
});

test('the console works at phone width', async ({ page, stack }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, stack, 'phone');
  const nav = page.getByRole('navigation', { name: t('nav.label') });
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: t('nav.menu') }).click();
  await nav.getByRole('link', { name: t('nav.bookings') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('bookings.title') })).toBeVisible();
  await expect(nav).toBeHidden();
  await expectNoAxeViolations(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
