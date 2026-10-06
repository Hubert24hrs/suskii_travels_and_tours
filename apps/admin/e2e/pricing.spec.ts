import { API_URL } from './stack';
import { expect, expectNoAxeViolations, signIn, t, test } from './fixtures';

interface TourCard {
  slug: string;
  fromPrice: { amountMinor: number; currency: string } | null;
}

async function publicTourPrice(slug: string): Promise<number> {
  const response = await fetch(`${API_URL}/v1/tours?adults=1`);
  const body = (await response.json()) as { tours: TourCard[] };
  const price = body.tours.find((tour) => tour.slug === slug)?.fromPrice;
  if (!price) throw new Error(`No public price for ${slug}`);
  return price.amountMinor;
}

/** Markup rules (ADR-035) apply to new prices at once: the pricing cache is invalidated. */
test('a markup rule raises the public price of a tour', async ({ page, stack }) => {
  const before = await publicTourPrice(stack.tourSlug);

  await signIn(page, stack, 'pricing');
  await page.goto('/pricing');
  await page.getByTestId('new-markup').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page);
  await dialog.getByLabel(t('pricing.name')).fill('E2E tours markup');
  await dialog.getByLabel(t('pricing.vertical')).selectOption('tours');
  await dialog.getByTestId('rule-value').fill('10');
  await dialog.getByRole('button', { name: t('common.save') }).click();
  await expect(page.getByRole('row', { name: /E2E tours markup/ })).toContainText('10%');

  // 10% on the supplier cost; fees and rounding make the exact figure the pricing engine's job.
  await expect.poll(() => publicTourPrice(stack.tourSlug)).toBeGreaterThan(before);
  const after = await publicTourPrice(stack.tourSlug);
  expect(after).toBeLessThanOrEqual(Math.ceil(before * 1.1) + 100);
});
