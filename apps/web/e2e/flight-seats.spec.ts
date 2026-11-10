import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';

/**
 * Seat selection at checkout (ADR-094): the airline's seat map is loaded only when the traveller
 * asks for it, a chosen seat is added to the total at the airline's price and shown on the
 * booking. The rules (who may sit where, the checks before booking and before payment) are
 * covered against the API (`apps/api/test/flight-seats.e2e-spec.ts`).
 */

const search = (extra = '') =>
  `/flights/search?trip=one_way&from=LOS&to=ABV&depart=${isoDaysFromToday(30)}${extra}`;

async function toCheckout(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page
    .getByTestId('flight-offer')
    .first()
    .getByRole('button', { name: /^Select/ })
    .click({ timeout: 30_000 });
  await page.waitForURL(/\/checkout\//);
}

/** Whole naira in a formatted amount such as "₦85,000.00". */
const naira = (text: string | null): number =>
  Number((/₦\s?([\d,]+)/.exec(text ?? '')?.[1] ?? 'x').replaceAll(',', ''));

test('adds a chosen seat to the total and shows it on the booking', async ({ page }) => {
  let mapsLoaded = 0;
  page.on('request', (request) => {
    if (request.url().includes('/seat-maps')) mapsLoaded += 1;
  });
  await toCheckout(page, search('&adults=1'));
  const total = page.getByTestId('checkout-total');
  await expect(total).toContainText('₦');
  const before = naira(await total.textContent());
  // The map costs a supplier call: it is not read until the traveller wants a seat.
  expect(mapsLoaded).toBe(0);
  await expect(page.getByTestId('seats-line')).toHaveCount(0);

  await page.getByTestId('choose-seats').click();
  const picker = page.getByTestId('seat-picker');
  await expect(picker).toBeVisible({ timeout: 30_000 });
  expect(mapsLoaded).toBe(1);
  // Taken seats cannot be chosen, and some of this flight's seats are.
  await expect(picker.locator('button:disabled').first()).toBeVisible();
  await expectNoAxeViolations(page);

  // A free seat that the airline charges for names its place and price.
  const priced = picker.getByRole('button', { name: /₦/ }).first();
  const label = (await priced.getAttribute('aria-label')) ?? '';
  const designator = /\b(\d{1,3}[A-Z])\b/.exec(label)?.[1] ?? '';
  expect(designator).not.toBe('');
  const seatPrice = naira(label);
  expect(seatPrice).toBeGreaterThan(0);
  await priced.click();

  const chosen = page.getByTestId(`seat-0-${designator}`);
  await expect(chosen).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('seat-summary')).toContainText(designator);
  expect(naira(await page.getByTestId('seats-line').textContent())).toBe(seatPrice);
  expect(naira(await total.textContent())).toBe(before + seatPrice);
  await expectNoAxeViolations(page);

  // Their own seat hands it back, and the total follows.
  await chosen.click();
  await expect(page.getByTestId('seats-line')).toHaveCount(0);
  expect(naira(await total.textContent())).toBe(before);
  await page.getByTestId(`seat-0-${designator}`).click();
  expect(naira(await total.textContent())).toBe(before + seatPrice);

  await page.locator('#passenger-0-title').selectOption('ms');
  await page.locator('#passenger-0-gender').selectOption('f');
  await page.locator('#passenger-0-givenNames').fill('Ngozi');
  await page.locator('#passenger-0-surname').fill('Eze');
  await page.locator('#passenger-0-dateOfBirth').fill('1988-02-11');
  await page.locator('#passenger-0-nationality').selectOption('NG');
  await page.locator('#contact-email').fill('ngozi@example.com');
  await page.locator('#contact-phone').fill('+234 801 234 5678');
  await page.getByLabel(t('checkout.terms')).check();
  await page.getByRole('button', { name: t('checkout.pay') }).click();

  await page.waitForURL(/\/checkout\/mock-payment\//);
  // The payment is for the fare and the seat together.
  const pay = page.getByRole('button', { name: /^Pay / });
  expect(naira(await pay.textContent())).toBe(before + seatPrice);
  await pay.click();
  await page.waitForURL(/\/bookings\//);
  await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('seats')).toHaveText(t('booking.seats', { seats: designator }));
  await expectNoAxeViolations(page);
});

test('gives each traveller with a seat one of their own, and none to a lap infant', async ({
  page,
}) => {
  await toCheckout(page, search('&adults=2&infants=1'));
  await expect(page.getByText(t('checkout.seats.infant'))).toBeVisible();
  await page.getByTestId('choose-seats').click();
  const picker = page.getByTestId('seat-picker');
  await expect(picker).toBeVisible({ timeout: 30_000 });

  // Two travellers have a seat; the infant on a lap is not offered one.
  await expect(picker.getByTestId('seat-traveller-0')).toBeChecked();
  await expect(picker.getByTestId('seat-traveller-1')).toBeVisible();
  await expect(picker.getByTestId('seat-traveller-2')).toHaveCount(0);

  const free = picker.locator('button[aria-pressed="false"]');
  const first = (await free.nth(0).getAttribute('data-testid')) ?? '';
  const second = (await free.nth(1).getAttribute('data-testid')) ?? '';
  await page.getByTestId(first).click();
  // The picker moves on to the traveller who has no seat yet.
  await expect(picker.getByTestId('seat-traveller-1')).toBeChecked();
  await page.getByTestId(second).click();
  await expect(page.getByTestId(first)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(second)).toHaveAttribute('aria-pressed', 'true');
  const summary = page.getByTestId('seat-summary');
  await expect(summary).toContainText(first.replace('seat-0-', ''));
  await expect(summary).toContainText(second.replace('seat-0-', ''));
});

test('offers no reserving or installments once a seat is chosen', async ({ page }) => {
  // Refundable international fares three or more weeks out can be held (mock supplier rules).
  await page.goto(
    `/flights/search?trip=one_way&from=LOS&to=LHR&depart=${isoDaysFromToday(30)}&adults=1&refundable=1`,
  );
  const offers = page.getByTestId('flight-offer');
  await expect(offers.first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => offers.count()).toBeGreaterThan(4);
  let found = false;
  for (const card of await offers.all()) {
    await card.getByRole('button', { name: t('results.flights.details') }).click();
    const flex = card.getByText(t('results.flights.fareBrand', { brand: 'Economy Flex' }));
    if (await flex.first().isVisible()) {
      await card.getByRole('button', { name: /^Select/ }).click();
      found = true;
      break;
    }
  }
  expect(found, 'an Economy Flex fare in the results').toBe(true);
  await page.waitForURL(/\/checkout\//);
  await expect(page.getByLabel(t('checkout.plan.hold'))).toBeVisible();

  await page.getByTestId('choose-seats').click();
  const picker = page.getByTestId('seat-picker');
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.locator('button[aria-pressed="false"]').first().click();

  await expect(page.getByLabel(t('checkout.plan.hold'))).toHaveCount(0);
  await expect(page.getByText(t('checkout.seats.notWithPlans'))).toBeVisible();
  await expectNoAxeViolations(page);
});
