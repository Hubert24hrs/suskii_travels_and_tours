import { API_URL } from './stack';
import { expect, expectNoAxeViolations, signIn, t, test } from './fixtures';

interface PublicPlan {
  slug: string;
  price: { amountMinor: number; currency: string } | null;
}

/** The plan's US dollar price as a visitor sees it, by the edge's country or the display one. */
async function usdPrice(
  slug: string,
  options: { edge?: string; country?: string } = {},
): Promise<number | null> {
  const query = new URLSearchParams({ currency: 'USD' });
  if (options.country) query.set('country', options.country);
  const response = await fetch(`${API_URL}/v1/prime/plans?${query.toString()}`, {
    headers: options.edge ? { 'cf-ipcountry': options.edge } : {},
  });
  const body = (await response.json()) as { plans: PublicPlan[] };
  return body.plans.find((plan) => plan.slug === slug)?.price?.amountMinor ?? null;
}

/**
 * Suskii Prime priced per country (ADR-082): a price line may name a country; visitors from it
 * see that price, everyone else the currency's line without a country.
 */
test('finance adds a Prime plan with a Ghana price', async ({ page, stack }) => {
  const slug = 'prime-e2e-countries';
  await signIn(page, stack, 'prime');
  await page.goto('/prime');
  await expect(page.getByRole('heading', { level: 1, name: t('prime.title') })).toBeVisible();

  await page.getByTestId('new-plan').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(t('prime.slug')).fill(slug);
  await dialog.getByLabel(t('prime.name')).fill('Prime E2E');
  await dialog.getByLabel(t('prime.summary')).fill('Member fares for a year.');
  const prices = dialog.getByLabel(t('prime.prices'));

  // The same currency and country twice is refused before anything is sent.
  await prices.fill('USD 25\nUSD 18 GH\nUSD 17 gh');
  await dialog.getByRole('button', { name: t('common.save') }).click();
  await expect(dialog).toContainText(t('prime.pricesInvalid'));
  await expectNoAxeViolations(page);

  await prices.fill('NGN 25000\nUSD 25\nUSD 18 gh');
  await dialog.getByRole('button', { name: t('common.save') }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole('row', { name: /Prime E2E/ });
  await expect(row).toContainText(/\$18 in Ghana/);
  await expect(row).toContainText(t('prime.statuses.draft'));

  // Published, the API resolves the price per country.
  await row.getByTestId(`edit-plan-${slug}`).click();
  await expect(prices).toHaveValue('NGN 25000.00\nUSD 25.00\nUSD 18.00 GH');
  await dialog.getByLabel(t('common.status')).selectOption('published');
  await dialog.getByRole('button', { name: t('common.save') }).click();
  await expect(row).toContainText(t('prime.statuses.published'));

  await expect.poll(() => usdPrice(slug, { edge: 'GH' })).toBe(1_800);
  expect(await usdPrice(slug, { edge: 'KE' })).toBe(2_500);
  expect(await usdPrice(slug, { country: 'GH' })).toBe(1_800);
  expect(await usdPrice(slug)).toBe(2_500);
});
