import { API_URL } from './stack';
import { expect, expectNoAxeViolations, signIn, t, test } from './fixtures';

const inDays = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const partnerFlights = (key: string): Promise<Response> =>
  fetch(`${API_URL}/v1/metasearch/flights?origin=LOS&destination=ABV&departureDate=${inDays(30)}`, {
    headers: { 'X-Api-Key': key },
  });

/**
 * Metasearch partners (ADR-081): the key appears once, in a dialog, and works against the
 * partner API at once; replacing it stops the old one. Both changes need a recent authenticator
 * check, which signing in provides.
 */
test('finance adds a metasearch partner, copies its key once and replaces it', async ({
  page,
  stack,
}) => {
  await signIn(page, stack, 'metasearch');
  await page.goto('/metasearch');
  await expect(page.getByRole('heading', { level: 1, name: t('metasearch.title') })).toBeVisible();
  await expect(page.getByText(t('metasearch.empty'))).toBeVisible();

  await page.getByTestId('new-partner').click();
  const form = page.getByRole('dialog');
  await form.getByLabel(t('metasearch.name')).fill('Skyscanner E2E');
  await form.getByLabel(t('metasearch.code')).fill('skyscanner-e2e');
  await form.getByLabel(t('metasearch.perMinute')).fill('30');
  await form.getByRole('button', { name: t('common.save') }).click();

  const shown = page.getByRole('dialog', {
    name: t('metasearch.keyTitle', { name: 'Skyscanner E2E' }),
  });
  await expect(shown).toContainText(t('metasearch.keyOnce'));
  const key = await shown.getByTestId('metasearch-key').inputValue();
  expect(key).toMatch(/^smk_[A-Za-z0-9_-]{43}$/);
  await expectNoAxeViolations(page);
  expect((await partnerFlights(key)).status).toBe(200);
  await shown.getByRole('button', { name: t('common.close') }).click();

  const row = page.getByRole('row', { name: /Skyscanner E2E/ });
  await expect(row).toContainText(key.slice(0, 12));
  await expect(row).not.toContainText(key);
  await expect(row).toContainText('30 / 20,000');

  await row
    .getByRole('button', { name: t('metasearch.rotateFor', { name: 'Skyscanner E2E' }) })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('common.yes') })
    .click();
  const replaced = await page.getByTestId('metasearch-key').inputValue();
  expect(replaced).not.toBe(key);
  expect((await partnerFlights(key)).status).toBe(401);
  expect((await partnerFlights(replaced)).status).toBe(200);
});
