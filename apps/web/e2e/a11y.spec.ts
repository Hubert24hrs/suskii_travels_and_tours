import type { Page } from '@playwright/test';

import {
  expect,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  isoDaysFromToday,
  t,
  test,
} from './fixtures';

/**
 * The WCAG 2.2 AA sweep (docs/accessibility/wcag-2.2-aa.md). Journeys check their own pages and
 * dialogs with axe; this visits every public page at phone and desktop widths and checks what
 * axe cannot: reflow at 320 CSS pixels (1.4.10), target sizes (2.5.8, and the spec's 44 px for
 * search and checkout controls), a visible focus indicator on every stop of the tab order
 * (2.4.7, 2.4.11) and a search done with the keyboard alone (2.1.1).
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

const PAGES: [name: string, path: (cityId: string, depart: string, back: string) => string][] = [
  ['home', () => '/'],
  ['flights', () => '/flights'],
  ['hotels', () => '/hotels'],
  [
    'flight results',
    (_, depart, back) =>
      `/flights/search?trip=round_trip&from=LOS&to=DXB&depart=${depart}&return=${back}&adults=1`,
  ],
  [
    'hotel results',
    (cityId, depart, back) =>
      `/hotels/search?dest=${cityId}&checkin=${depart}&checkout=${back}&room=2`,
  ],
  ['packages', () => '/packages'],
  ['tours', () => '/tours'],
  ['visa', () => '/visa'],
  ['travel add-ons', () => '/travel-add-ons'],
  ['deals', () => '/deals'],
  ['route page', () => '/flights/lagos-to-london'],
  ['suskii prime', () => '/prime'],
  ['cars', () => '/cars'],
  ['buses', () => '/buses'],
  ['rentals', () => '/rentals'],
  ['help and support', () => '/support'],
  ['service status', () => '/status'],
  ['sign in', () => '/sign-in'],
  ['register', () => '/register'],
  ['forgot password', () => '/forgot-password'],
  ['manage booking', () => '/manage-booking'],
  ['not found', () => '/no-such-page'],
];

/** The not-found page answers 404 by design; the browser logs that status as an error. */
const EXPECTED_CONSOLE: Record<string, RegExp[]> = { 'not found': [/status of 404/] };

/**
 * One test per page, each in its own group so a page's expected console errors stay its own.
 * `check` gets the page's URL (search pages use dates a month out and Dubai's city).
 */
function perPage(title: string, check: (page: Page, url: string) => Promise<void>): void {
  for (const [name, path] of PAGES) {
    test.describe(name, () => {
      test.use({ allowedConsoleErrors: EXPECTED_CONSOLE[name] ?? [] });
      test(`${name} ${title}`, async ({ page, request }) => {
        const cityId = await cityOfDubai(request);
        await check(page, path(cityId, isoDaysFromToday(30), isoDaysFromToday(37)));
      });
    });
  }
}

const WIDTHS = [
  { name: 'phone', width: 360, height: 740 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

async function cityOfDubai(request: {
  get: (url: string) => Promise<{ json: () => Promise<unknown> }>;
}) {
  const airport = (await (await request.get(`${API}/v1/catalog/airports/DXB`)).json()) as {
    cityId: string;
  };
  return airport.cityId;
}

/** Waits until the page has settled: hydrated forms and no "loading" status left. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
}

/**
 * Interactive elements smaller than `min` CSS pixels in either direction, except links inside a
 * sentence (2.5.8's inline exception) and visually hidden controls. A checkbox or radio counts
 * with its label, which activates it too.
 */
async function smallTargets(page: Page, min: number, scope = 'body'): Promise<string[]> {
  return page.evaluate(
    ({ min, scope }) => {
      const selector = [
        'button',
        'a[href]',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        'summary',
        '[role="button"]',
        '[role="tab"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="combobox"]',
      ].join(',');
      const root = document.querySelector(scope) ?? document.body;
      const found: string[] = [];
      for (const element of root.querySelectorAll<HTMLElement>(selector)) {
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        let rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue; // visually hidden (sr-only)
        if (element.closest('[aria-hidden="true"], [inert]')) continue;
        // A stretched link (`after:absolute after:inset-0`) is as big as the card it covers.
        const after = getComputedStyle(element, '::after');
        if (after.position === 'absolute' && after.content !== 'none' && element.offsetParent) {
          rect = element.offsetParent.getBoundingClientRect();
        }
        const input = element as HTMLInputElement;
        if (input.type === 'checkbox' || input.type === 'radio') {
          const label =
            element.closest('label') ?? document.querySelector(`label[for="${input.id}"]`);
          if (label) rect = label.getBoundingClientRect();
        }
        const inline =
          element.tagName === 'A' &&
          style.display === 'inline' &&
          element.parentElement !== null &&
          /^(P|SPAN|LI|DD|TD|LABEL|SMALL|STRONG|EM)$/.test(element.parentElement.tagName) &&
          (element.parentElement.textContent ?? '').trim().length >
            (element.textContent ?? '').trim().length;
        if (inline) continue;
        if (rect.width < min || rect.height < min) {
          const name =
            element.getAttribute('aria-label') ??
            element.textContent?.trim().slice(0, 40) ??
            element.id;
          found.push(
            `${element.tagName.toLowerCase()} "${name}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          );
        }
      }
      return found;
    },
    { min, scope },
  );
}

for (const viewport of WIDTHS) {
  test.describe(`every public page at ${viewport.name} width`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    perPage('axe and target sizes', async (page, url) => {
      await page.goto(url);
      await settle(page);
      await expectNoAxeViolations(page);
      expect(await smallTargets(page, 24), 'targets under 24 x 24 px (WCAG 2.5.8)').toEqual([]);
    });
  });
}

test.describe('reflow at 320 CSS pixels (WCAG 1.4.10)', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  perPage('needs no horizontal scrolling', async (page, url) => {
    await page.goto(url);
    await settle(page);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('text spacing (WCAG 1.4.12)', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  // The criterion's own values: a reader's style sheet may set them and nothing may break.
  const SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }`;

  for (const [name, path] of PAGES.filter(([candidate]) =>
    ['home', 'flight results', 'hotel results', 'sign in', 'help and support'].includes(candidate),
  )) {
    test(`${name} reflows with wider text spacing`, async ({ page, request }) => {
      const cityId = await cityOfDubai(request);
      await page.goto(path(cityId, isoDaysFromToday(30), isoDaysFromToday(37)));
      await settle(page);
      await page.addStyleTag({ content: SPACING });
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe('search and checkout controls', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the search form controls are at least 44 px tall (spec)', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    expect(await smallTargets(page, 44, 'main form')).toEqual([]);
  });
});

test.describe('keyboard', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('every stop in the homepage tab order shows a focus indicator (WCAG 2.4.7)', async ({
    page,
  }) => {
    await page.goto('/');
    await settle(page);
    const missing: string[] = [];
    for (let stop = 0; stop < 40; stop += 1) {
      await page.keyboard.press('Tab');
      const result = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return null;
        const style = getComputedStyle(element);
        const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const ring = style.boxShadow !== 'none' && style.boxShadow !== '';
        const name =
          element.getAttribute('aria-label') ??
          element.textContent?.trim().slice(0, 40) ??
          element.tagName;
        return { visible: outline || ring, name: `${element.tagName.toLowerCase()} "${name}"` };
      });
      if (result && !result.visible) missing.push(result.name);
    }
    expect(missing).toEqual([]);
  });

  test('the sticky header never hides the focused element (WCAG 2.4.11)', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    // Start at the footer and walk back up, so the page scrolls up under the sticky header.
    await page.locator('footer a').last().focus();
    const hidden: string[] = [];
    for (let stop = 0; stop < 40; stop += 1) {
      await page.keyboard.press('Shift+Tab');
      const result = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        const header = document.querySelector('header');
        if (!element || !header || header.contains(element)) return null;
        const rect = element.getBoundingClientRect();
        const covered = rect.bottom <= header.getBoundingClientRect().bottom;
        const name = element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40);
        return covered ? `${element.tagName.toLowerCase()} "${name ?? ''}"` : null;
      });
      if (result) hidden.push(result);
    }
    expect(hidden).toEqual([]);
  });

  test('a flight search can be made with the keyboard alone (WCAG 2.1.1)', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    const origin = page.locator('#flight-origin-input');
    await origin.focus();
    await page.keyboard.type('LOS');
    await expect(page.getByRole('option', { name: /Lagos/ }).first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(origin).toHaveValue(/LOS/);

    const destination = page.locator('#flight-destination-input');
    await destination.focus();
    await page.keyboard.type('LHR');
    await expect(page.getByRole('option', { name: /LHR/ }).first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(destination).toHaveValue(/LHR/);

    // Dates: open the picker from its trigger, move with the arrow keys, choose with Enter.
    await page.locator('#flight-departureDate').focus();
    await page.keyboard.press('Enter');
    const picker = page.getByRole('dialog').last();
    await expect(picker.getByRole('grid').first()).toBeVisible();
    await expect(picker.locator(':focus')).toHaveCount(1);
    for (let week = 0; week < 3; week += 1) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    for (let day = 0; day < 7; day += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await picker.getByRole('button', { name: t('search.datePicker.done') }).focus();
    await page.keyboard.press('Enter');
    await expect(picker).toBeHidden();
    await expect(page.locator('#flight-departureDate')).toBeFocused();

    await page.getByRole('button', { name: t('search.flights.submit') }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/flights\/search\?/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
