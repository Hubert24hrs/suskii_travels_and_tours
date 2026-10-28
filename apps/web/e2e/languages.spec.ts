import { createTranslator, getMessages, type Messages, type Translator } from '@suskii/i18n';

import {
  expect,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  isoDaysFromToday,
  t,
  test,
  VIEWPORTS,
} from './fixtures';

/**
 * Languages and right to left (ADR-076): the footer choice, else the browser's languages, picks
 * the catalog; Arabic pages run right to left and keep Latin digits.
 */
const translate = (locale: 'fr' | 'ar'): Translator<Messages>['t'] =>
  createTranslator(getMessages(locale), locale).t;
const fr = translate('fr');
const ar = translate('ar');

test.describe('languages', () => {
  test.describe('a French browser', () => {
    test.use({ locale: 'fr-FR' });

    test('gets French pages, left to right', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
      await expect(page.getByRole('link', { name: fr('common.skipToContent') })).toBeAttached();
      await expect(page.getByRole('contentinfo').getByLabel(fr('footer.language'))).toHaveValue(
        'fr',
      );
      await expectNoAxeViolations(page);
    });

    test('keeps a language chosen in the footer over the browser', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('contentinfo').getByLabel(fr('footer.language')).selectOption('en-NG');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-NG');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-NG');
    });

    test('fits every breakpoint in French', async ({ page }) => {
      await page.goto('/');
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await expectNoHorizontalOverflow(page);
      }
    });
  });

  test('Arabic runs right to left with Latin digits and fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await page.getByRole('contentinfo').getByLabel(t('footer.language')).selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('contentinfo').getByLabel(ar('footer.language'))).toHaveValue('ar');
    // Every language names itself in the picker.
    await expect(page.getByRole('contentinfo').locator('option[value="fr"]')).toHaveText(
      'Français',
    );

    // Prices keep Latin digits; Arabic shows the currency code where it has no local symbol (CLDR).
    const deal = page.locator('#deals article').first();
    await expect(deal).toContainText(/[0-9],[0-9]{3}\sNGN/);
    await expect(deal).not.toContainText(/[\u0660-\u0669\u06f0-\u06f9]/);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
  });

  test('Arabic flight results run right to left', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByLabel(t('footer.language')).selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.goto(
      `/flights/search?trip=one_way&from=LOS&to=ABV&depart=${isoDaysFromToday(30)}&adults=1`,
    );
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const offer = page.getByTestId('flight-offer').first();
    await expect(offer).toBeVisible({ timeout: 30_000 });
    await expect(offer).not.toContainText(/[\u0660-\u0669\u06f0-\u06f9]/);
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
  });
});
