import type { Locator, Page } from '@playwright/test';
import { createFormatters } from '@suskii/i18n';

import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';
import { choose, pickDates } from './helpers';

/**
 * Combined trips (ADR-099): a traveller plans Lagos to London, chooses a flight, a hotel, a
 * rental car, an airport transfer and travel insurance on the ordinary pages, reviews a price per
 * part with one total and pays for everything once. A trip may also be only one or two parts.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const PASSWORD = 'a perfectly long passphrase';
const format = createFormatters('en-NG');

const newEmail = (label: string): string =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

interface Trip {
  id: string;
  state: string;
  total: { amountMinor: number; currency: string };
  due: { amountMinor: number; currency: string };
  parts: {
    component: string;
    state: string;
    booking: { id: string; total: { amountMinor: number; currency: string } };
  }[];
}

async function register(page: Page, label: string): Promise<void> {
  await page.goto('/register');
  await page.getByTestId('register-email').fill(newEmail(label));
  await page.getByTestId('register-password').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  await page.waitForURL((url) => url.pathname === '/account');
  await expect(page.getByTestId('header-account')).toHaveText(t('header.account'));
}

async function fillPlan(page: Page, depart: string, back: string): Promise<void> {
  await choose(page, 'trip-origin', 'Lagos', /LOS/);
  await choose(page, 'trip-destination', 'London Heathrow', /LHR/);
  await pickDates(page, 'trip-dates', depart, back);
}

async function fillTraveller(page: Page, passport: boolean): Promise<void> {
  await page.locator('#passenger-0-title').selectOption('ms');
  await page.locator('#passenger-0-gender').selectOption('f');
  await page.locator('#passenger-0-givenNames').fill('Ada');
  await page.locator('#passenger-0-surname').fill('Okafor');
  await page.locator('#passenger-0-dateOfBirth').fill('1990-04-01');
  await page.locator('#passenger-0-nationality').selectOption('NG');
  if (passport) {
    await page.locator('#passenger-0-passportNumber').fill('B1234567');
    await page.locator('#passenger-0-issuingCountry').selectOption('NG');
    await page.locator('#passenger-0-passportExpiry').fill(isoDaysFromToday(3000));
  }
}

async function fillGuest(page: Page): Promise<void> {
  await page.locator('#guest-0-givenNames').fill('Ada');
  await page.locator('#guest-0-surname').fill('Okafor');
}

async function contactAndTerms(page: Page): Promise<void> {
  await page.locator('#contact-email').fill('ada.trip@example.com');
  await page.locator('#contact-phone').fill('+234 801 234 5678');
  await page.getByLabel(t('checkout.terms')).check();
}

const part = (page: Page, component: string): Locator => page.getByTestId(`trip-part-${component}`);

/** From the trip page to the ordinary search for one part. */
async function startPart(page: Page, component: string, url: RegExp): Promise<void> {
  await part(page, component)
    .getByRole('link', {
      name: t(`trips.page.choose.${component}` as 'trips.page.choose.flight'),
    })
    .click();
  await page.waitForURL(url);
}

/** Checkout in trip mode: no payment here, the booking goes back to the trip. */
async function addToTrip(page: Page, tripId: string, component: string): Promise<void> {
  await expect(page.getByTestId('trip-banner')).toBeVisible();
  // One payment for the whole trip: this page offers no way to pay or to reserve.
  await expect(page.getByRole('button', { name: t('checkout.pay') })).toHaveCount(0);
  await page.getByRole('button', { name: t('checkout.tripBuilder.submit') }).click();
  await page.waitForURL(new RegExp(`/trips/${tripId}$`));
  await expect(part(page, component).getByText(t('trips.partStates.to_pay'))).toBeVisible();
}

async function tripFromApi(page: Page, tripId: string): Promise<Trip> {
  const response = await page.request.get(`${API}/v1/trips/${tripId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as Trip;
}

test.describe('trip builder (ADR-099)', () => {
  test('builds Lagos to London from a flight, a hotel, a car, a transfer and insurance, and pays once', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const depart = isoDaysFromToday(30);
    const back = isoDaysFromToday(37);
    await register(page, 'web-trip');

    // The plan: where from and to, when, who and the parts wanted (all five by default).
    await page.goto('/trips');
    await expect(page.getByRole('heading', { level: 1, name: t('trips.title') })).toBeVisible();
    await expectNoAxeViolations(page);
    // Nothing is sent before the plan is complete.
    await page.getByRole('button', { name: t('trips.plan.submit') }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: t('trips.plan.errors.origin') }),
    ).toBeVisible();
    await fillPlan(page, depart, back);
    for (const component of ['flight', 'hotel', 'car', 'transfer', 'insurance'] as const) {
      await expect(
        page.getByLabel(t(`trips.components.${component}`), { exact: true }),
      ).toBeChecked();
    }
    const [created] = await Promise.all([
      page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith('/v1/trips'),
      ),
      page.getByRole('button', { name: t('trips.plan.submit') }).click(),
    ]);
    // The trip is in the visitor's currency, the one every search then quotes in.
    expect(created.postDataJSON()).toMatchObject({
      currency: 'NGN',
      plan: {
        origin: { code: 'LOS' },
        destination: { code: 'LHR' },
        departDate: depart,
        returnDate: back,
        adults: 1,
        children: 0,
        components: ['flight', 'hotel', 'car', 'transfer', 'insurance'],
      },
    });
    await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/);
    const tripId = page.url().split('/').pop() ?? '';
    await expect(page.getByTestId('trip-currency-note')).toHaveCount(0);

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: t('trips.route', { from: 'Lagos', to: 'London' }),
      }),
    ).toBeVisible();
    await expect(page.getByTestId('trip-state')).toHaveText(t('trips.states.empty'));
    await expect(page.getByText(t('trips.page.notAdded'))).toHaveCount(5);
    await expect(page.getByText(t('trips.page.nothingYet'))).toBeVisible();
    await expectNoAxeViolations(page);

    // 1. The flight: the ordinary search, prefilled with the plan.
    await startPart(page, 'flight', /\/flights\/search\?/);
    const flightQuery = new URL(page.url()).searchParams;
    expect(Object.fromEntries(flightQuery)).toMatchObject({
      trip: 'round_trip',
      from: 'LOS',
      to: 'LHR',
      depart,
      return: back,
      adults: '1',
    });
    const offers = page.getByTestId('flight-offer');
    await expect(offers.first()).toBeVisible({ timeout: 30_000 });
    await offers
      .first()
      .getByRole('button', { name: /^Select/ })
      .click();
    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('passenger-0')).toBeVisible();
    await expect(page.getByTestId('trip-banner')).toBeVisible();
    await expectNoAxeViolations(page);
    await fillTraveller(page, true);
    await contactAndTerms(page);
    await addToTrip(page, tripId, 'flight');

    // 2. The hotel: the destination's city and the trip's dates.
    await startPart(page, 'hotel', /\/hotels\/search\?/);
    const hotelQuery = new URL(page.url()).searchParams;
    expect(hotelQuery.get('checkin')).toBe(depart);
    expect(hotelQuery.get('checkout')).toBe(back);
    const hotels = page.getByTestId('hotel-result');
    await expect(hotels.first()).toBeVisible({ timeout: 30_000 });
    await hotels
      .first()
      .getByRole('link', { name: /^See rooms/ })
      .click();
    const rates = page.getByTestId('hotel-rate');
    await expect(rates.first()).toBeVisible({ timeout: 30_000 });
    await rates
      .first()
      .getByRole('button', { name: /^Select/ })
      .click();
    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('guest-0')).toBeVisible();
    await fillGuest(page);
    await contactAndTerms(page);
    await addToTrip(page, tripId, 'hotel');

    // 3. The car, in the destination city for the same days.
    await startPart(page, 'car', /\/rentals\?/);
    const carQuery = new URL(page.url()).searchParams;
    expect(carQuery.get('city')).toBe('London');
    expect(carQuery.get('pickupAt')).toBe(`${depart}T10:00`);
    expect(carQuery.get('returnAt')).toBe(`${back}T10:00`);
    await page.getByTestId('rental-cars').getByRole('link').first().click();
    await page.waitForURL(/\/rentals\/sample-london-/);
    await page.locator('#book-driver-age').fill('30');
    await page.getByTestId('book-rental').click();
    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('cars-details')).toBeVisible();
    await fillGuest(page);
    await contactAndTerms(page);
    await addToTrip(page, tripId, 'car');

    // 4. The airport transfer at the destination.
    await startPart(page, 'transfer', /\/travel-add-ons\?/);
    expect(new URL(page.url()).searchParams.get('type')).toBe('airport_transfer');
    await page
      .getByRole('button', {
        name: t('addons.add', { title: 'Airport transfer at your destination (sample)' }),
      })
      .click();
    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('passenger-0')).toBeVisible();
    await fillTraveller(page, false);
    await contactAndTerms(page);
    await page.locator('#addonDetails-flightNumber').fill('BA 74');
    await page.locator('#addonDetails-arrivalTime').fill(`${depart}T14:30`);
    await page.locator('#addonDetails-pickupAddress').fill('Heathrow Terminal 5, London');
    await addToTrip(page, tripId, 'transfer');

    // 5. Travel insurance for the trip's days.
    await startPart(page, 'insurance', /\/travel-add-ons\?/);
    expect(new URL(page.url()).searchParams.get('type')).toBe('insurance');
    await page
      .getByRole('button', { name: t('addons.add', { title: 'Travel insurance (sample)' }) })
      .click();
    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('passenger-0')).toBeVisible();
    await fillTraveller(page, false);
    await contactAndTerms(page);
    await addToTrip(page, tripId, 'insurance');

    // The review: a price for each part, and one total that is their sum.
    const trip = await tripFromApi(page, tripId);
    expect(trip.parts.map((item) => item.component)).toEqual([
      'flight',
      'hotel',
      'car',
      'transfer',
      'insurance',
    ]);
    const sum = trip.parts.reduce((total, item) => total + item.booking.total.amountMinor, 0);
    expect(trip.total.amountMinor).toBe(sum);
    for (const item of trip.parts) {
      expect(item.booking.total.amountMinor).toBeGreaterThan(0);
      await expect(page.getByTestId(`trip-price-${item.component}`)).toHaveText(
        format.money(item.booking.total),
      );
    }
    const total = format.money(trip.total);
    await expect(page.getByTestId('trip-total')).toHaveText(total);
    await expect(page.getByTestId('trip-state')).toHaveText(t('trips.states.open'));
    await expect(page.getByText(t('trips.page.notAdded'))).toHaveCount(0);
    await expectNoAxeViolations(page);

    // One payment for the whole trip, for exactly the total shown.
    await page.getByTestId('trip-pay').click();
    await page.waitForURL(/\/checkout\/mock-payment\//);
    const pay = page.getByRole('button', { name: /^Pay / });
    expect((await pay.textContent())?.replace(/^Pay\s+/, '')).toBe(total);
    await pay.click();
    await page.waitForURL(new RegExp(`/trips/${tripId}$`));

    // The webhook settles every booking; each one is confirmed on its own.
    await expect(page.getByTestId('trip-state')).toHaveText(t('trips.states.paid'), {
      timeout: 60_000,
    });
    for (const component of ['flight', 'hotel', 'car', 'transfer', 'insurance']) {
      await expect(part(page, component).getByText(t('trips.partStates.confirmed'))).toBeVisible({
        timeout: 60_000,
      });
    }
    await expect(page.getByText(t('trips.page.paid'))).toBeVisible();
    await expect(page.getByTestId('trip-pay')).toHaveCount(0);
    // Nothing is left to pay, and a paid trip stays.
    const paid = await tripFromApi(page, tripId);
    expect(paid.due.amountMinor).toBe(0);
    await expect(page.getByRole('button', { name: t('trips.page.delete') })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // Each part is an ordinary booking with its own page.
    await part(page, 'flight')
      .getByRole('link', { name: /^View booking/ })
      .click();
    await page.waitForURL(/\/bookings\//);
    await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
      timeout: 30_000,
    });
    // And it leads back to the trip it is a part of.
    await page
      .getByTestId('booking-trip')
      .getByRole('link', { name: t('booking.builtTrip.open') })
      .click();
    await page.waitForURL(new RegExp(`/trips/${tripId}$`));
  });

  test('keeps a plan through sign-up, takes only the parts wanted and can be deleted', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const depart = isoDaysFromToday(40);
    const back = isoDaysFromToday(43);
    // A visitor plans first: only a flight and a hotel.
    await page.goto('/trips');
    await expect(page.getByText(t('trips.plan.signIn'))).toBeVisible();
    await fillPlan(page, depart, back);
    for (const component of ['car', 'transfer', 'insurance'] as const) {
      await page.getByLabel(t(`trips.components.${component}`), { exact: true }).uncheck();
    }
    await page.getByRole('button', { name: t('trips.plan.submit') }).click();
    await page.waitForURL(/\/sign-in\?next=%2Ftrips/);

    // They make an account and find the plan as they left it.
    await page.goto(`/register?next=${encodeURIComponent('/trips')}`);
    await page.getByTestId('register-email').fill(newEmail('web-trip-plan'));
    await page.getByTestId('register-password').fill(PASSWORD);
    await page.getByTestId('register-submit').click();
    await page.waitForURL((url) => url.pathname === '/trips');
    await expect(page.locator('#trip-origin-input')).toHaveValue('Lagos (LOS)');
    await expect(page.getByLabel(t('trips.components.car'), { exact: true })).not.toBeChecked();
    await expect(page.getByLabel(t('trips.components.hotel'), { exact: true })).toBeChecked();
    await page.getByRole('button', { name: t('trips.plan.submit') }).click();
    await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/);
    const tripId = page.url().split('/').pop() ?? '';

    // Only the two parts asked for.
    await expect(part(page, 'flight')).toBeVisible();
    await expect(part(page, 'hotel')).toBeVisible();
    await expect(part(page, 'car')).toHaveCount(0);
    await expect(part(page, 'insurance')).toHaveCount(0);

    // One part is a trip too: the flight alone can be paid.
    await startPart(page, 'flight', /\/flights\/search\?/);
    const offers = page.getByTestId('flight-offer');
    await expect(offers.first()).toBeVisible({ timeout: 30_000 });
    await offers
      .first()
      .getByRole('button', { name: /^Select/ })
      .click();
    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('passenger-0')).toBeVisible();
    await fillTraveller(page, true);
    await contactAndTerms(page);
    await addToTrip(page, tripId, 'flight');
    const trip = await tripFromApi(page, tripId);
    await expect(page.getByTestId('trip-pay')).toHaveText(
      t('trips.page.pay', { amount: format.money(trip.due) }),
    );

    // The trip is listed, and removing the flight leaves its booking alone.
    await part(page, 'flight')
      .getByRole('button', {
        name: t('trips.page.removeLabel', { part: t('trips.components.flight') }),
      })
      .click();
    await expect(page.getByText(t('trips.page.notAdded'))).toHaveCount(2);
    await page.goto('/trips');
    const listed = page.getByRole('link', {
      name: t('trips.route', { from: 'Lagos', to: 'London' }),
    });
    await expect(listed).toBeVisible();
    await listed.click();
    await page.waitForURL(new RegExp(`/trips/${tripId}$`));

    // Deleting asks first, then returns to the plan form.
    await page.getByRole('button', { name: t('trips.page.delete') }).click();
    await page.getByRole('button', { name: t('trips.page.deleteYes') }).click();
    await page.waitForURL((url) => url.pathname === '/trips');
    await expect(listed).toHaveCount(0);
    const gone = await page.request.get(`${API}/v1/trips/${tripId}`);
    expect(gone.status()).toBe(404);
  });
});
