import {
  alertWith,
  expect,
  expectNoAxeViolations,
  expectToast,
  expireStepUp,
  signIn,
  t,
  test,
} from './fixtures';
import { totp } from './totp';

/**
 * ADR-037: staff sign an account out everywhere without disabling it; disabling it is a step-up
 * action, so once the sign-in's authenticator check is old the console asks for a fresh code and
 * then repeats the request.
 */
test.use({ allowedConsoleErrors: [/status of 40[13]/] });

test('risky account changes ask for a fresh authenticator code', async ({ page, stack }) => {
  const target = stack.personas.target;
  const secret = stack.personas.stepUp.secret ?? '';
  await signIn(page, stack, 'stepUp');
  await page.goto(`/users/${target.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(target.email);

  // Ending the target's sessions needs no step-up.
  await page.getByRole('button', { name: t('users.detail.signOutEverywhere') }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  await expectToast(page, t('users.detail.signedOut', { count: 1 }));

  await expireStepUp(stack, 'stepUp');
  await page.getByRole('button', { name: t('users.detail.disable') }).click();
  await page.getByRole('button', { name: t('common.yes') }).click();
  const prompt = page.getByRole('dialog', { name: t('auth.stepUp.heading') });
  await expect(prompt).toBeVisible();
  await expectNoAxeViolations(page);

  const current = totp(secret);
  await prompt.getByTestId('step-up-code').fill(current === '000000' ? '111111' : '000000');
  await prompt.getByRole('button', { name: t('auth.stepUp.submit') }).click();
  await expect(alertWith(page, t('auth.errors.code'))).toBeVisible();

  await prompt.getByTestId('step-up-code').fill(current);
  await prompt.getByRole('button', { name: t('auth.stepUp.submit') }).click();
  await expect(prompt).toHaveCount(0);
  await expectToast(page, t('users.detail.done'));
  await expect(page.getByText(t('users.statuses.disabled'), { exact: true })).toBeVisible();
});
