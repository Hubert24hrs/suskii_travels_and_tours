import {
  alertWith,
  expect,
  expectNoAxeViolations,
  navLabels,
  submitPassword,
  t,
  test,
} from './fixtures';
import { totp } from './totp';

/**
 * Staff sign-in (ADR-033): password, then the authenticator; staff without one enrol before
 * they get a console session; accounts without a staff role are turned away; the navigation
 * only offers what the roles allow.
 */

test('a staff member without an authenticator enrols on first sign-in', async ({ page, stack }) => {
  await submitPassword(page, stack, 'enrol');
  await expect(page.getByRole('heading', { name: t('auth.enrol.heading') })).toBeVisible();
  await page.getByRole('button', { name: t('auth.enrol.start') }).click();
  await expect(page.getByRole('img', { name: t('auth.enrol.qrLabel') })).toBeVisible();
  await expectNoAxeViolations(page);

  const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s+/g, '');
  await page.getByTestId('totp-code').fill(totp(secret));
  await page.getByRole('button', { name: t('auth.enrol.submit') }).click();
  await expect(page.getByTestId('recovery-codes').getByRole('listitem')).toHaveCount(10);
  await page.getByRole('button', { name: t('auth.enrol.continue') }).click();

  // A content manager runs the catalog and site content, nothing financial, and has no
  // dashboard: the console opens their first section.
  await expect(page.getByRole('navigation', { name: t('nav.label') })).toBeVisible();
  await expect(page).toHaveURL(/\/catalog$/);
  expect(await navLabels(page)).toEqual([
    t('nav.catalog'),
    t('nav.promos'),
    t('nav.deals'),
    t('nav.content'),
    t('nav.trustSignals'),
  ]);
  await page.goto('/refunds');
  await expect(alertWith(page, t('common.forbidden'))).toBeVisible();
});

test.describe('authenticator codes', () => {
  // The refused code is a 401 from the API, which the browser logs.
  test.use({ allowedConsoleErrors: [/status of 401/] });

  test('a wrong code is refused, the right one signs in and signing out ends the session', async ({
    page,
    stack,
  }) => {
    const { secret } = stack.personas.mfa;
    if (!secret) throw new Error('mfa persona has no authenticator');
    // A `next` that a browser would resolve to another host is ignored after sign-in.
    await submitPassword(page, stack, 'mfa', '/\\example.com/phish');
    await expect(page.getByRole('heading', { name: t('auth.mfaHeading') })).toBeVisible();
    await expectNoAxeViolations(page);

    // A code from five steps ahead is outside the accepted window.
    await page.getByTestId('mfa-code').fill(totp(secret, 5));
    await page.getByRole('button', { name: t('auth.verify') }).click();
    await expect(alertWith(page, t('auth.errors.code'))).toBeVisible();

    await page.getByTestId('mfa-code').fill(totp(secret, 1));
    await page.getByRole('button', { name: t('auth.verify') }).click();
    await expect(page.getByRole('navigation', { name: t('nav.label') })).toBeVisible();
    expect(new URL(page.url()).host).toBe('localhost:3001');
    await expect(
      page.getByText(t('nav.signedInAs', { name: stack.personas.mfa.email })),
    ).toBeVisible();

    await page.getByTestId('sign-out').click();
    await expect(page.getByRole('heading', { name: t('auth.title') })).toBeVisible();
    await page.goto('/bookings');
    await expect(page.getByRole('heading', { name: t('auth.title') })).toBeVisible();
  });
});

test('an account without a staff role cannot open the console', async ({ page, stack }) => {
  await page.goto('/sign-in');
  await expectNoAxeViolations(page);
  await submitPassword(page, stack, 'customer');
  await expect(page.getByRole('heading', { name: t('auth.notStaff.heading') })).toBeVisible();
  await expect(page.getByRole('navigation', { name: t('nav.label') })).toHaveCount(0);
});

test('the console sends its security headers', async ({ request }) => {
  const response = await request.get('/sign-in');
  const headers = response.headers();
  expect(headers['strict-transport-security']).toContain('max-age=63072000');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  const csp = headers['content-security-policy'] ?? '';
  for (const directive of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
    expect(csp).toContain(directive);
  }
  expect(csp).toMatch(/script-src [^;]*'nonce-/);
});
