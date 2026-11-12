import { PRIVACY_RULES } from '@suskii/shared';

import {
  alertWith,
  expect,
  expectNoAxeViolations,
  expectToast,
  navLabels,
  signIn,
  t,
  test,
} from './fixtures';

/**
 * ADR-089: the privacy officer records a data rights request received by phone and refuses it
 * with a reason, then opens a breach, records each regulator's notice and closes it. Beside the
 * registers the role reads users, companies and the audit log, and nothing else.
 */
// Closing the breach before every regulator has a notice answers 409 `notices-pending`.
test.use({ allowedConsoleErrors: [/status of 409/] });

test('the privacy officer keeps the request and breach registers', async ({ page, stack }) => {
  await signIn(page, stack, 'privacyOfficer');
  expect(await navLabels(page)).toEqual([
    t('nav.users'),
    t('nav.audit'),
    t('nav.privacy'),
    t('nav.companies'),
  ]);
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('privacy.title'));
  await expectNoAxeViolations(page);

  // A Kenyan erasure request by phone: the address is shown masked, the deadline set by law.
  await page.getByTestId('record-request').click();
  const recordDialog = page.getByRole('dialog');
  await recordDialog.getByLabel(t('privacy.kind')).selectOption('erasure');
  await recordDialog.getByLabel(t('privacy.jurisdiction')).selectOption('KE');
  await recordDialog.getByLabel(t('privacy.channel')).selectOption('phone');
  await recordDialog
    .getByLabel(t('form.optional', { label: t('privacy.email') }))
    .fill('wanjiru.e2e@example.com');
  await expectNoAxeViolations(page);
  await recordDialog.getByRole('button', { name: t('privacy.record') }).click();
  await expectToast(page, t('privacy.recorded'));
  const requests = page.getByRole('table', { name: t('privacy.requests') });
  const row = requests.getByRole('row', { name: /w\*\*\*@example\.com/ });
  await expect(row).toContainText(t('privacy.kinds.erasure'));
  await expect(row).toContainText(t('privacy.statutory'));

  const kind = t('privacy.kinds.erasure');
  await row.getByRole('button', { name: t('privacy.refuseLabel', { kind }) }).click();
  const refuseDialog = page.getByRole('dialog');
  await refuseDialog.getByLabel(t('privacy.reason')).selectOption('identity_not_verified');
  await refuseDialog.getByRole('button', { name: t('privacy.refuse') }).click();
  await expectToast(page, t('privacy.refused'));
  await page.getByLabel(t('privacy.filter')).selectOption('closed');
  const closedRow = requests.getByRole('row', { name: /w\*\*\*@example\.com/ });
  await expect(closedRow).toContainText(t('privacy.statuses.refused'));
  await expect(closedRow).toContainText(t('privacy.refusalReasons.identity_not_verified'));

  // A breach under Nigerian and South African law: one notice per regulator.
  const title = 'Export emailed to a mistyped address';
  await page.getByTestId('open-breach').click();
  const breachDialog = page.getByRole('dialog');
  await breachDialog.getByLabel(t('privacy.breachTitle')).fill(title);
  await breachDialog.getByLabel(t('privacy.details')).fill('One booking export, one traveller.');
  await breachDialog
    .getByLabel(t('form.optional', { label: t('privacy.subjectsAffected') }))
    .fill('1');
  await breachDialog.getByLabel(t('privacy.categoryNames.contact')).check();
  await breachDialog.getByLabel(t('privacy.jurisdictions.NG')).check();
  await breachDialog.getByLabel(t('privacy.jurisdictions.ZA')).check();
  await breachDialog.getByRole('button', { name: t('privacy.openBreach') }).click();
  await expectToast(page, t('privacy.opened'));

  const breach = page.getByRole('region', { name: title });
  const notices = breach.getByRole('table', { name: t('privacy.notices') });
  await expect(notices.getByRole('row')).toHaveCount(3);
  await expect(notices).toContainText(PRIVACY_RULES.NG.regulator);
  await expect(notices).toContainText(PRIVACY_RULES.ZA.regulator);
  await expectNoAxeViolations(page);

  await breach.getByRole('button', { name: t('privacy.viewDetailsLabel', { title }) }).click();
  await expect(page.getByRole('dialog')).toContainText('One booking export, one traveller.');
  await page.keyboard.press('Escape');

  // Closing waits for every regulator.
  await breach.getByRole('button', { name: t('privacy.closeBreachLabel', { title }) }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expect(alertWith(page, t('problems.notices-pending'))).toBeVisible();
  await page.keyboard.press('Escape');

  await breach.getByTestId('record-notice-NG').click();
  const ngDialog = page.getByRole('dialog');
  await ngDialog
    .getByLabel(t('form.optional', { label: t('privacy.regulatorReference') }))
    .fill('NDPC-E2E-1');
  await ngDialog.getByRole('button', { name: t('common.save') }).click();
  await expectToast(page, t('privacy.noticeRecorded'));
  await expect(notices).toContainText(t('privacy.reference', { reference: 'NDPC-E2E-1' }));

  await breach.getByTestId('record-notice-ZA').click();
  const zaDialog = page.getByRole('dialog');
  await zaDialog.getByLabel(t('privacy.decision')).selectOption('not_required');
  await zaDialog.getByRole('button', { name: t('common.save') }).click();
  await expect(notices).toContainText(t('privacy.decisions.not_required'));

  await breach.getByRole('button', { name: t('privacy.closeBreachLabel', { title }) }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('privacy.breachClosed'));
  await expect(breach).toContainText(t('privacy.breachStatuses.closed'));
});
