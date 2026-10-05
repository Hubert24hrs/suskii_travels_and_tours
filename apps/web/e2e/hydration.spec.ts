import type { Page } from '@playwright/test';

import { isoDaysFromToday, test } from './fixtures';

/**
 * The server (Node) and the visitor's browser ship different ICU/CLDR data, so the same
 * `Intl` call can return different text on each side (a comma, a space, a currency symbol).
 * Server-rendered client components must still hydrate without a mismatch. The browser's Intl
 * output is altered here in ways a real CLDR update does; the console guard fails the test on
 * any hydration error.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

async function divergeBrowserIntl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nbsp = (text: string) => text.replace(/ /g, '\u00a0');
    class DateFormat extends Intl.DateTimeFormat {
      override format(date?: Date | number): string {
        return nbsp(super.format(date));
      }
      override formatRange(start: Date | number | bigint, end: Date | number | bigint): string {
        return nbsp(super.formatRange(start, end));
      }
    }
    class NumberFormat extends Intl.NumberFormat {
      override format(value: number | bigint | Intl.StringNumericLiteral): string {
        return super.format(value).replace(/,/g, '\u202f');
      }
    }
    Object.defineProperty(Intl, 'DateTimeFormat', { value: DateFormat });
    Object.defineProperty(Intl, 'NumberFormat', { value: NumberFormat });
  });
}

/** Resolves once React has hydrated every form and button on the page. */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const elements = [...document.querySelectorAll('main form, main button')];
    return (
      elements.length > 0 &&
      elements.every((element) =>
        Object.keys(element).some((key) => key.startsWith('__reactProps$')),
      )
    );
  });
}

const PAGES: [name: string, path: (cityId: string, depart: string, back: string) => string][] = [
  ['home', () => '/'],
  [
    'round-trip flight search',
    (_, depart, back) =>
      `/flights/search?trip=round_trip&from=LOS&to=DXB&depart=${depart}&return=${back}&adults=1`,
  ],
  [
    'hotel search',
    (cityId, depart, back) =>
      `/hotels/search?dest=${cityId}&checkin=${depart}&checkout=${back}&room=2&room=1`,
  ],
  ['packages by month', (cityId, _, back) => `/packages?dest=${cityId}&month=${back.slice(0, 7)}`],
  [
    'packages by dates',
    (cityId, depart, back) => `/packages?dest=${cityId}&from=${depart}&to=${back}`,
  ],
  ['tours', (_, depart) => `/tours?q=Zanzibar&date=${depart}`],
  ['visa', (_, depart) => `/visa?nationality=NG&destination=GB&purpose=tourism&date=${depart}`],
  ['package detail', () => '/packages/sample-zanzibar-beach-break?adults=2'],
  ['tour detail', () => '/tours/sample-dubai-desert-evening?adults=1'],
  ['visa product', (_, depart) => `/visa/sample-uae-tourist-visa?nationality=NG&date=${depart}`],
  [
    'standalone add-ons',
    (cityId, depart, back) =>
      `/travel-add-ons?type=insurance&dest=${cityId}&start=${depart}&end=${back}&adults=1`,
  ],
  ['sign in', () => '/sign-in'],
  ['register', () => '/register?ref=ABCDEFGH'],
];

test.describe('hydration with different Intl data in the browser', () => {
  for (const [name, path] of PAGES) {
    test(`${name} hydrates without a mismatch`, async ({ page, request }) => {
      const airport = (await (await request.get(`${API}/v1/catalog/airports/DXB`)).json()) as {
        cityId: string;
      };
      await divergeBrowserIntl(page);
      await page.goto(path(airport.cityId, isoDaysFromToday(30), isoDaysFromToday(37)));
      await waitForHydration(page);
    });
  }
});
