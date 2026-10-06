import { API_URL } from './stack';
import { alertWith, expect, expectNoAxeViolations, navLabels, signIn, t, test } from './fixtures';

async function publicTrustSignals(): Promise<string[]> {
  const response = await fetch(`${API_URL}/v1/content/site?locale=en-NG`);
  const body = (await response.json()) as { trustSignals: { key: string }[] };
  return body.trustSignals.map((signal) => signal.key);
}

/**
 * Regulated trust claims stay hidden until a super admin verifies them with evidence; the
 * public content API then serves them (ADR-035).
 */
test('a super admin verifies a trust signal with evidence and the site shows it', async ({
  page,
  stack,
}) => {
  expect(await publicTrustSignals()).not.toContain('iata_accredited');

  await signIn(page, stack, 'verifier');
  await page.goto('/trust-signals');
  await page.getByTestId('verify-signal-iata_accredited').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByTestId('evidence-url').fill('https://example.com/iata-certificate.pdf');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('trust.verify') })
    .click();
  await expect(
    page.getByRole('row', { name: /IATA/ }).getByText(t('trust.verified'), { exact: true }),
  ).toBeVisible();

  expect(await publicTrustSignals()).toContain('iata_accredited');
});

test('operations staff create a promo code but cannot open pricing', async ({ page, stack }) => {
  await signIn(page, stack, 'operations');
  // Operations run bookings and deals; pricing, content, the audit log and visa work are not theirs.
  expect(await navLabels(page)).toEqual([
    t('nav.dashboard'),
    t('nav.bookings'),
    t('nav.refunds'),
    t('nav.vouchers'),
    t('nav.catalog'),
    t('nav.promos'),
    t('nav.deals'),
    t('nav.users'),
    t('nav.referrals'),
  ]);
  await page.goto('/pricing');
  await expect(alertWith(page, t('common.forbidden'))).toBeVisible();

  await page.goto('/promos');
  await page.getByTestId('new-promo').click();
  await page.getByTestId('promo-code').fill('e2esave10');
  await page.getByTestId('promo-value').fill('10');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('common.save') })
    .click();
  // Codes are stored upper case.
  await expect(page.getByRole('row', { name: /E2ESAVE10/ })).toContainText('10%');
});
