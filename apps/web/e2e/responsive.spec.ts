import {
  expect,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  t,
  test,
  VIEWPORTS,
} from './fixtures';

const PAGES = [
  '/flights',
  '/flights/lagos-to-london',
  '/hotels/dubai',
  '/travel-add-ons',
  '/deals',
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('homepage fits the screen, navigates and passes axe', async ({ page }) => {
      await page.goto('/');
      await expectNoHorizontalOverflow(page);

      const primaryNav = page.getByRole('navigation', { name: t('header.primaryNav') });
      if (viewport.width >= 1024) {
        await expect(primaryNav).toBeVisible();
        await expect(primaryNav.getByRole('link', { name: t('verticals.hotels') })).toBeVisible();
      } else {
        await expect(primaryNav).toBeHidden();
        await page.getByRole('button', { name: t('header.openMenu') }).click();
        const menu = page.getByRole('dialog', { name: t('header.menuTitle') });
        await expect(menu.getByRole('link', { name: t('verticals.hotels') })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
      }

      // Narrow screens scroll the offers sideways inside the section, never the page.
      if (viewport.width < 1024) {
        const scroller = page.locator('#deals ul').first();
        const scrollable = await scroller.evaluate((node) => node.scrollWidth > node.clientWidth);
        expect(scrollable).toBe(true);
      }

      await expectNoAxeViolations(page);
    });

    test('landing, route and city pages fit the screen', async ({ page }) => {
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
    });
  });
}

test('route and city pages pass axe', async ({ page }) => {
  for (const path of ['/flights/lagos-to-london', '/hotels/dubai', '/packages']) {
    await page.goto(path);
    await expectNoAxeViolations(page);
  }
});
