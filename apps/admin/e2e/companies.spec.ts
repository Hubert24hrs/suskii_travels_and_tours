import { expect, expectNoAxeViolations, expectToast, signIn, t, test } from './fixtures';

/**
 * ADR-078: staff find a company, see its members and policy, and suspend it (after a fresh
 * authenticator check) and reinstate it.
 */
test('staff suspend and reinstate a company', async ({ page, stack }) => {
  const { name } = stack.company;
  await signIn(page, stack, 'companyStaff');
  await page.goto('/companies');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('companies.title'));
  await page.getByLabel(t('companies.search')).fill('Acme');
  await page.getByRole('button', { name: t('common.search') }).click();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText(t('companies.statuses.active'));
  await row.getByRole('button', { name: t('companies.open', { name }) }).click();

  const detail = page.getByRole('region', { name });
  await expect(detail).toContainText(t('companies.roles.admin'));
  // Emails are stored in lower case.
  await expect(detail).toContainText(stack.personas.companyOwner.email.toLowerCase());
  await expect(detail).toContainText(t('companies.approvalModes.never'));
  await expectNoAxeViolations(page);

  await detail.getByRole('button', { name: t('companies.suspendFor', { name }) }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('companies.suspended'));
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText(
    t('companies.statuses.suspended'),
  );

  await detail.getByRole('button', { name: t('companies.reinstateFor', { name }) }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('companies.reinstated'));
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText(
    t('companies.statuses.active'),
  );
});
