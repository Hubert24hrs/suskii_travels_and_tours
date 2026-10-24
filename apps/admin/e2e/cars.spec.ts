import { expect, expectNoAxeViolations, expectToast, navLabels, signIn, t, test } from './fixtures';

/**
 * Cars (ADR-050): an operations reviewer takes the provisioned driver application through the
 * console. Every document and the vehicle are approved one by one, a document is downloaded
 * (the API audits the read), and the approval itself needs the authenticator check the fresh
 * sign-in gives (step-up, ADR-037).
 */
const DOCUMENTS = [
  'licence',
  'vehicle_registration',
  'insurance',
  'roadworthiness',
  'selfie',
] as const;

test('operations approves a driver application', async ({ page, stack }) => {
  const { driver } = stack;
  await signIn(page, stack, 'driverReviewer');
  // Operations runs the ground network and reviews drivers; payouts stay with finance.
  const nav = await navLabels(page);
  for (const key of ['ground', 'drivers', 'rides', 'rentals'] as const) {
    expect(nav).toContain(t(`nav.${key}`));
  }
  expect(nav).not.toContain(t('nav.finance'));
  await page.goto('/drivers');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('drivers.title'));
  const row = page.getByRole('row', { name: new RegExp(driver.name) });
  await expect(row).toContainText(t('drivers.statuses.pending'));
  await expect(row).toContainText(t('drivers.awaitingCount', { documents: 5, vehicles: 1 }));
  await expectNoAxeViolations(page);

  await row.getByRole('link', { name: t('drivers.openFor', { name: driver.name }) }).click();
  await page.waitForURL(new RegExp(`/drivers/${driver.id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(driver.name);
  await expectNoAxeViolations(page);

  const licence = t('drivers.documentKinds.licence');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: t('drivers.downloadFor', { kind: licence }) }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^licence-[0-9a-f]{8}\.png$/);

  const review = `${t('drivers.approveItem')} / ${t('drivers.rejectItem')}`;
  for (const kind of DOCUMENTS) {
    const name = t(`drivers.documentKinds.${kind}`);
    await page.getByRole('button', { name: `${review}: ${name}` }).click();
    const dialog = page.getByRole('dialog', { name });
    await dialog.getByRole('button', { name: t('common.save') }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('row', { name: new RegExp(`^${name}`) })).toContainText(
      t('drivers.documentStatuses.approved'),
    );
  }
  await page.getByRole('button', { name: new RegExp(`^${review}: Toyota Camry`) }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('common.save') })
    .click();
  await expect(page.getByRole('row', { name: /Toyota Camry/ })).toContainText(
    t('drivers.vehicleStatuses.approved'),
  );

  await page.getByTestId('approve-driver').click();
  const approve = page.getByRole('dialog', { name: t('drivers.approve') });
  await expect(approve).toContainText(t('drivers.approveQuestion'));
  await expectNoAxeViolations(page);
  await approve.getByRole('button', { name: t('drivers.approve') }).click();
  await expectToast(page, t('drivers.approved'));
  await expect(page.getByText(t('drivers.statuses.approved')).first()).toBeVisible();
  await expect(page.getByTestId('approve-driver')).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('drivers.suspend') })).toBeVisible();
});
