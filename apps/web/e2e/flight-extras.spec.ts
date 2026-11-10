import type { Page } from '@playwright/test';
import { GROUP_MAX_TRAVELLERS, GROUP_MIN_TRAVELLERS } from '@suskii/shared/lite';

import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';
import { choose, pickDates } from './helpers';

/**
 * Ways to a better flight and requests that go with one (ADR-093): prices on the days around a
 * search, airports near each end, a special meal where the fare takes one, and flights for ten
 * travellers or more as a request the team answers. The rules themselves are covered against
 * the API (`apps/api/test/flight-extras.e2e-spec.ts`).
 */

const search = (origin: string, destination: string, extra = '') =>
  `/flights/search?trip=one_way&from=${origin}&to=${destination}&depart=${isoDaysFromToday(30)}&adults=1${extra}`;

const firstFare = (page: Page) => page.getByTestId('flight-offer').first();

test.describe('flexible dates', () => {
  test('prices the days around a search only when asked, and searches the day chosen', async ({
    page,
  }) => {
    let priced = 0;
    page.on('request', (request) => {
      if (request.url().includes('/v1/flights/date-prices')) priced += 1;
    });
    await page.goto(search('LOS', 'ABV'));
    await expect(firstFare(page)).toBeVisible({ timeout: 30_000 });
    // A plain search prices no other day: each one is a supplier search unless cached.
    await expect(page.getByTestId('flexible-dates')).toHaveCount(0);
    expect(priced).toBe(0);

    await page.getByTestId('flexible-dates-show').click();
    await expect(page).toHaveURL(/flex=1/);
    const strip = page.getByTestId('flexible-dates');
    const today = strip.getByTestId('flexible-day-0');
    await expect(today).toHaveAttribute('aria-current', 'date', { timeout: 30_000 });
    await expect(today).toContainText('₦');
    // Three days each side, and exactly one of the seven is marked as the lowest.
    await expect(strip.getByRole('link')).toHaveCount(7);
    await expect(strip.getByText(t('results.flexible.lowest'), { exact: true })).toHaveCount(1);
    await expect(strip).toContainText(t('results.flexible.note'));
    await expectNoAxeViolations(page);

    await strip.getByTestId('flexible-day-2').click();
    await expect(page).toHaveURL(new RegExp(`depart=${isoDaysFromToday(32)}`));
    await expect(page).toHaveURL(/flex=1/);
    await expect(firstFare(page)).toBeVisible({ timeout: 30_000 });
    // The strip now centres on the day chosen.
    await expect(page.getByTestId('flexible-day-0')).toContainText('₦', { timeout: 30_000 });
  });

  test('moves both dates of a return trip together', async ({ page }) => {
    await page.goto(
      `/flights/search?trip=round_trip&from=LOS&to=ABV&depart=${isoDaysFromToday(30)}&return=${isoDaysFromToday(37)}&adults=1&flex=1`,
    );
    const strip = page.getByTestId('flexible-dates');
    await expect(strip.getByTestId('flexible-day-1')).toBeVisible({ timeout: 30_000 });
    await expect(strip).toContainText(t('results.flexible.returnNote'));
    await strip.getByTestId('flexible-day-1').click();
    await expect(page).toHaveURL(new RegExp(`depart=${isoDaysFromToday(31)}`));
    await expect(page).toHaveURL(new RegExp(`return=${isoDaysFromToday(38)}`));
  });
});

test.describe('nearby airports', () => {
  test('offers the same search to an airport near the destination', async ({ page }) => {
    await page.goto(search('LOS', 'LHR'));
    await expect(firstFare(page)).toBeVisible({ timeout: 30_000 });

    const nearby = page.getByTestId('nearby-airports');
    await expect(nearby).toBeVisible({ timeout: 30_000 });
    // London has other airports with scheduled flights within reach of Heathrow.
    const gatwick = nearby.getByTestId('nearby-to-LGW');
    await expect(gatwick).toContainText('(LGW)');
    await expect(gatwick).toContainText(/\d+ km/);
    await expectNoAxeViolations(page);

    await gatwick.click();
    await expect(page).toHaveURL(/to=LGW/);
    await expect(page).toHaveURL(/from=LOS/);
  });
});

test.describe('meal requests', () => {
  test('takes a special meal where the fare allows one and shows it on the booking', async ({
    page,
  }) => {
    await page.goto(search('LOS', 'LHR'));
    await firstFare(page)
      .getByRole('button', { name: /^Select/ })
      .click({ timeout: 30_000 });
    await page.waitForURL(/\/checkout\//);

    const meal = page.locator('#passenger-0-meal');
    await expect(meal).toBeVisible();
    await expect(page.getByText(t('checkout.meal.help'))).toBeVisible();
    // A child's meal is for a child traveller.
    await expect(meal.locator('option[value="child"]')).toHaveCount(0);
    await expect(page.getByTestId('meal-unavailable')).toHaveCount(0);
    await expectNoAxeViolations(page);

    await page.locator('#passenger-0-title').selectOption('ms');
    await page.locator('#passenger-0-gender').selectOption('f');
    await page.locator('#passenger-0-givenNames').fill('Halima');
    await page.locator('#passenger-0-surname').fill('Bello');
    await page.locator('#passenger-0-dateOfBirth').fill('1990-04-01');
    await page.locator('#passenger-0-nationality').selectOption('NG');
    await page.locator('#passenger-0-passportNumber').fill('B1234567');
    await page.locator('#passenger-0-issuingCountry').selectOption('NG');
    await page.locator('#passenger-0-passportExpiry').fill(isoDaysFromToday(3000));
    await meal.selectOption('halal');
    await page.locator('#contact-email').fill('halima@example.com');
    await page.locator('#contact-phone').fill('+234 801 234 5678');
    await page.getByLabel(t('checkout.terms')).check();
    await page.getByRole('button', { name: t('checkout.pay') }).click();

    await page.waitForURL(/\/checkout\/mock-payment\//);
    await page.getByRole('button', { name: /^Pay / }).click();
    await page.waitForURL(/\/bookings\//);
    await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
      timeout: 30_000,
    });
    await expect(page.getByTestId('meal-request')).toHaveText(
      t('booking.mealRequest', { meal: t('checkout.meal.options.halal') }),
    );
  });

  test('says to ask the airline where the fare takes no meal request', async ({ page }) => {
    // The stack's domestic flights serve no special meals.
    await page.goto(search('LOS', 'ABV'));
    await firstFare(page)
      .getByRole('button', { name: /^Select/ })
      .click({ timeout: 30_000 });
    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('meal-unavailable')).toHaveText(t('checkout.meal.unavailable'));
    await expect(page.locator('#passenger-0-meal')).toHaveCount(0);
  });
});

test.describe('group flights', () => {
  test('takes a request for ten travellers or more and opens the conversation', async ({
    page,
  }) => {
    await page.goto('/flights');
    await page.getByTestId('group-request-link').click();
    await page.waitForURL(/\/flights\/groups$/);
    await expect(page.getByRole('heading', { level: 1, name: t('groups.heading') })).toBeVisible();
    await expectNoAxeViolations(page);

    const form = page.getByTestId('group-request');
    // Nine travellers fit an ordinary booking: the form says what a group is before sending.
    await form.getByTestId('group-travellers').fill('9');
    await form.getByTestId('group-submit').click();
    await expect(
      form.getByText(
        t('groups.errors.travellers', { min: GROUP_MIN_TRAVELLERS, max: GROUP_MAX_TRAVELLERS }),
      ),
    ).toBeVisible();
    await expect(page.locator('#group-origin-input')).toBeFocused();
    await expectNoAxeViolations(page);

    await choose(page, 'group-origin', 'Lagos', /LOS/);
    await choose(page, 'group-destination', 'Abuja', /ABV/);
    await pickDates(page, 'group-departureDate', isoDaysFromToday(40), isoDaysFromToday(47));
    await form.getByTestId('group-travellers').fill('25');
    await form.getByLabel(t('groups.organisation')).fill('Unity Choir');
    await form.getByTestId('group-notes').fill('Two wheelchair users.');
    await form.getByTestId('group-email').fill('choir@example.com');
    await form.getByTestId('group-submit').click();

    await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/);
    const conversation = page.getByTestId('support-conversation');
    await expect(conversation.getByTestId('support-topic')).toHaveText(
      t('support.topics.group_booking'),
    );
    const request = conversation.getByTestId('support-message-customer');
    await expect(request).toContainText('Lagos (LOS) to Abuja (ABV)');
    await expect(request).toContainText('Travellers: 25');
    await expect(request).toContainText('Unity Choir');
    await expect(request).toContainText('Two wheelchair users.');
    // A person answers a group request; that the after-hours assistant stays out of it is
    // checked against the API.
    await expectNoAxeViolations(page);
  });
});
