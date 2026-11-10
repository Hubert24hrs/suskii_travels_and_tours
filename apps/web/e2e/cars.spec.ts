import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';

/**
 * Cars P7 (ADR-049 to ADR-053): buses, rides and car rental on the website, booked end to end
 * on the sample inventory the e2e stack seeds (`db:seed:demo`) and paid with the mock provider.
 * A guest holds two bus seats and gets two QR boarding passes; a signed-in rider books a ride,
 * follows it live and shares it; a signed-in renter books a self-drive car and gives a licence.
 */

const PASSWORD = 'a perfectly long passphrase';
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63f8ffff3f0005fe02fe0dd8a8820000000049454e44ae426082',
  'hex',
);

const newEmail = (label: string): string =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function signedIn(page: Page, label: string): Promise<void> {
  const email = newEmail(label);
  await page.goto('/register');
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill(PASSWORD);
  await page.getByTestId('register-submit').click();
  // A new account signs straight in and lands on the account page.
  await page.waitForURL((url) => url.pathname === '/account');
  await expect(page.getByTestId('header-account')).toHaveText(t('header.account'));
}

async function contactAndTerms(page: Page, email: string): Promise<void> {
  await page.locator('#contact-email').fill(email);
  await page.locator('#contact-phone').fill('+234 801 234 5678');
  await page.getByLabel(t('checkout.terms')).check();
}

/** Pays on the mock provider's page and waits for the confirmed booking page. */
async function payAndConfirm(page: Page): Promise<void> {
  await page.getByRole('button', { name: t('checkout.pay') }).click();
  await page.waitForURL(/\/checkout\/mock-payment\//);
  await page.getByRole('button', { name: /^Pay / }).click();
  await page.waitForURL(/\/bookings\//);
  await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
    timeout: 30_000,
  });
}

test.describe('cars hub', () => {
  test('lists the switched-on products and links them from the header', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: t('header.primaryNav') })
      .getByRole('link', { name: t('header.cars') })
      .click();
    await page.waitForURL(/\/cars$/);
    for (const key of ['buses', 'rides', 'rentals'] as const) {
      await expect(
        page.getByRole('main').getByRole('link', { name: t(`cars.hub.${key}.title`) }),
      ).toBeVisible();
    }
    // Car rental and transfers from partners (ADR-069), through the API's tracked links.
    const partners = page.getByTestId('partner-offers-hub');
    await expect(partners).toContainText(t('partners.disclosure'));
    const car = partners.getByTestId('partner-offer-discovercars').getByRole('link');
    await expect(car).toHaveText(t('partners.open', { partner: 'DiscoverCars' }));
    await expect(car).toHaveAttribute('target', '_blank');
    await expect(car).toHaveAttribute('rel', /sponsored/);
    const followed = await page.request.get((await car.getAttribute('href')) ?? '', {
      maxRedirects: 0,
    });
    expect(followed.status()).toBe(302);
    expect(followed.headers().location).toMatch(/^https:\/\/www\.discovercars\.com\/\?sub_id=/);
    await expect(partners.getByTestId('partner-offer-viator')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('buses', () => {
  test('a guest holds two seats, pays and gets two QR boarding passes', async ({ page }) => {
    await page.goto('/buses');
    await page.locator('#bus-from').selectOption('Lagos');
    await page.locator('#bus-to').selectOption('Ibadan');
    await page.locator('#bus-date').fill(isoDaysFromToday(3));
    await page.locator('#bus-seats').selectOption('2');
    await page.getByRole('button', { name: t('cars.buses.search') }).click();
    await page.waitForURL(/\/buses\?/);
    const trips = page.getByTestId('bus-trips');
    await expect(trips.getByText(t('cars.sample')).first()).toBeVisible();
    await expectNoAxeViolations(page);
    await trips.getByRole('link').first().click();

    await page.waitForURL(/\/buses\/trips\//);
    await expect(page.getByRole('heading', { level: 1, name: /Lagos to Ibadan/ })).toBeVisible();
    await expectNoAxeViolations(page);
    const free = page.locator('[data-testid^="seat-"]:enabled');
    await free.nth(0).click();
    await free.nth(1).click();
    await expect(page.getByText(t('cars.buses.trip.selected', { count: 2 }))).toBeVisible();
    await page.getByTestId('hold-seats').click();

    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('cars-details')).toContainText('Lagoon Express');
    for (const [index, given] of [
      [0, 'Ada'],
      [1, 'Bola'],
    ] as const) {
      await page.locator(`#passenger-${index}-title`).selectOption('ms');
      await page.locator(`#passenger-${index}-gender`).selectOption('f');
      await page.locator(`#passenger-${index}-givenNames`).fill(given);
      await page.locator(`#passenger-${index}-surname`).fill('Okafor');
      await page.locator(`#passenger-${index}-dateOfBirth`).fill('1990-04-01');
      await page.locator(`#passenger-${index}-nationality`).selectOption('NG');
      // Domestic buses ask for no passport.
      await expect(page.locator(`#passenger-${index}-passportNumber`)).toHaveCount(0);
    }
    await expectNoAxeViolations(page);
    await contactAndTerms(page, 'bus-guest@example.com');
    await payAndConfirm(page);

    await expect(page.locator('[data-testid^="ticket-qr-"]')).toHaveCount(2);
    await expect(page.getByTestId('boarding-passes')).toContainText(
      t('booking.cars.bus.ticketStates.valid'),
    );
    await expectNoAxeViolations(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: t('booking.download.bus_ticket') }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });
});

test.describe('rides', () => {
  test('a signed-in rider books a ride, follows it live and shares it', async ({ page }) => {
    // Signed out, the request form asks for an account first.
    await page.goto('/rides');
    await expect(page.getByRole('link', { name: t('cars.signInFirst') })).toBeVisible();

    await signedIn(page, 'web-rider');
    await page.goto('/rides');
    await page.getByTestId('ride-pickup').selectOption({ label: 'Yaba' });
    await page.getByTestId('ride-dropoff').selectOption({ label: 'Victoria Island' });
    await expectNoAxeViolations(page);
    await page.getByTestId('ride-quote').click();

    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('cars-details')).toContainText('Yaba');
    await page.locator('#guest-0-givenNames').fill('Ada');
    await page.locator('#guest-0-surname').fill('Okafor');
    await contactAndTerms(page, 'rider@example.com');
    await payAndConfirm(page);

    await page.getByTestId('track-ride').click();
    await page.waitForURL(/\/rides\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('ride-status')).toHaveText(
      new RegExp(
        [t('cars.rides.live.status.searching'), t('cars.rides.live.status.assigned')].join('|'),
      ),
    );
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: t('cars.rides.live.share') }).click();
    const link = await page.locator('#share-url').inputValue();
    expect(link).toMatch(/\/trip\/[A-Za-z0-9_-]{20,}$/);
    // The shared view shows the trip, nothing about the rider.
    const shared = await page.context().newPage();
    await shared.goto(link);
    await expect(shared.getByText(/Live trip in Lagos/)).toBeVisible();
    await expect(shared.getByText('Ada')).toHaveCount(0);
    await shared.close();

    // Cancelling before a driver accepts is free.
    await page.getByRole('button', { name: t('cars.rides.live.cancel') }).click();
    const dialog = page.getByRole('dialog', { name: t('cars.rides.live.cancelTitle') });
    await expect(dialog).toContainText(t('cars.rides.live.cancelFree'));
    await dialog.getByRole('button', { name: t('cars.rides.live.cancelConfirm') }).click();
    await expect(page.getByTestId('ride-status')).toHaveText(
      t('cars.rides.live.status.cancelled'),
      { timeout: 15_000 },
    );
  });
});

test.describe('car rental', () => {
  test('a signed-in renter books a self-drive car and gives a licence', async ({ page }) => {
    await signedIn(page, 'web-renter');
    const pickupAt = `${isoDaysFromToday(5)}T10:00`;
    const returnAt = `${isoDaysFromToday(7)}T10:00`;
    await page.goto('/rentals');
    await page.locator('#rental-pickup').fill(pickupAt);
    await page.locator('#rental-return').fill(returnAt);
    await page.getByRole('button', { name: t('cars.rentals.search') }).click();
    await page.waitForURL(/\/rentals\?/);
    const cars = page.getByTestId('rental-cars');
    await expect(cars.getByText(t('cars.rentals.days', { count: 2 })).first()).toBeVisible();
    await expectNoAxeViolations(page);
    const results = page.url();
    await cars.getByRole('link').first().click();

    await page.waitForURL(/\/rentals\/sample-/);
    const chosen = new URL(page.url()).pathname;
    await expect(page.locator('#book-pickup')).toHaveValue(pickupAt);
    await expectNoAxeViolations(page);
    // A self-drive rental asks for the driver's age before anything is quoted (ADR-098).
    await page.getByTestId('book-rental').click();
    await expect(
      page.getByRole('alert').filter({ hasText: t('cars.rentals.book.errors.driverAgeRequired') }),
    ).toBeVisible();
    await page.locator('#book-driver-age').fill('30');
    await page.getByTestId('book-rental').click();

    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('checkout-deposit')).toBeVisible();
    // The model year reads as a year, not as a number with a thousands separator.
    await expect(page.getByTestId('cars-details')).toContainText(/\((19|20)\d{2}\)/);
    // Unified price breakdown (Cars P9): the car's days as its own line.
    await expect(page.getByTestId('price-line').first()).toHaveText(
      new RegExp(t('checkout.breakdown.rental_vehicle', { count: 2 })),
    );
    await page.locator('#guest-0-givenNames').fill('Ada');
    await page.locator('#guest-0-surname').fill('Okafor');
    await contactAndTerms(page, 'renter@example.com');
    await payAndConfirm(page);

    const licence = page.getByTestId('rental-licence');
    await expect(licence).toBeVisible();
    await page.locator('#licence-number').fill('LAG12345AB67');
    await page.locator('#licence-expiry').fill(isoDaysFromToday(900));
    await licence.getByRole('button', { name: t('booking.cars.rental.licence.save') }).click();
    await expect(page.getByTestId('licence-status')).toHaveText(
      t('booking.cars.rental.licence.states.pending_upload'),
    );
    await page.getByTestId('licence-file').setInputFiles({
      name: 'licence.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.getByTestId('licence-status')).toHaveText(
      t('booking.cars.rental.licence.states.pending_review'),
      { timeout: 15_000 },
    );
    await expectNoAxeViolations(page);

    // The car is taken for those days now: the same search no longer offers it, while the other
    // cars stay listed.
    await page.goto(results);
    await expect(page.getByTestId('rental-cars').getByRole('link').first()).toBeVisible();
    await expect(page.locator(`[data-testid="rental-cars"] a[href^="${chosen}?"]`)).toHaveCount(0);
  });

  test('finds airport cars, prices ten days by the week and books extras, another return branch and cross-border cover', async ({
    page,
  }) => {
    await signedIn(page, 'web-renter-options');
    const pickupAt = `${isoDaysFromToday(8)}T10:00`;
    const returnAt = `${isoDaysFromToday(18)}T10:00`;
    await page.goto('/rentals');
    await page.locator('#rental-pickup').fill(pickupAt);
    await page.locator('#rental-return').fill(returnAt);
    await page.locator('#rental-transmission').selectOption('automatic');
    await page.locator('#rental-driver-age').fill('30');
    await page.getByLabel(t('cars.rentals.airportOnly')).check();
    await page.getByRole('button', { name: t('cars.rentals.search') }).click();
    await page.waitForURL(/airport=true/);

    // Two sample cars live at the airport branch; each says so and how ten days were priced.
    const cars = page.getByTestId('rental-cars');
    await expect(cars.getByRole('listitem')).toHaveCount(2);
    await expect(cars.getByTestId('rental-airport')).toHaveCount(2);
    await expect(cars.getByTestId('rental-airport').first()).toHaveText(
      t('cars.rentals.atAirport', { code: 'LOS' }),
    );
    await expect(cars.getByTestId('rental-priced-as').first()).toHaveText(/1 week.+3 days/);
    await expectNoAxeViolations(page);
    // A driver of 22 cannot take the luxury car, which asks for 25.
    const young = new URL(page.url());
    young.searchParams.set('driverAge', '22');
    await page.goto(`${young.pathname}${young.search}`);
    await expect(page.getByTestId('rental-cars').getByRole('listitem')).toHaveCount(1);
    await page.goBack();

    await cars.getByRole('link', { name: /RAV4/ }).click();
    await page.waitForURL(/\/rentals\/sample-toyota-rav4/);
    await expect(page.getByTestId('rental-weekly')).toBeVisible();
    await expect(page.getByTestId('rental-monthly')).toBeVisible();
    await expect(page.getByTestId('rental-airport')).toHaveText(
      t('cars.rentals.detail.airportBranch', { code: 'LOS' }),
    );
    await expect(page.getByTestId('rental-min-age')).toHaveText(
      t('cars.rentals.detail.minDriverAge', { age: 21 }),
    );
    await expect(page.getByTestId('rental-extras').getByRole('listitem')).toHaveCount(3);
    await expect(page.getByTestId('rental-cross-border')).toContainText(/Benin.+Togo.+Ghana/);
    await expect(page.getByTestId('rental-return-branches').getByRole('listitem')).toHaveCount(2);

    // The age came with the search; the options are chosen here and priced by the API.
    await expect(page.locator('#book-driver-age')).toHaveValue('30');
    await page.locator('#book-extra-child_seat').selectOption('2');
    await page.locator('#book-return-branch').selectOption('sample-lekki');
    await page.getByRole('checkbox', { name: /Benin/ }).check();
    await expectNoAxeViolations(page);
    await page.getByTestId('book-rental').click();

    await page.waitForURL(/\/checkout\//);
    const details = page.getByTestId('cars-details');
    await expect(details).toContainText(t('booking.cars.rental.airport', { code: 'LOS' }));
    await expect(details).toContainText(
      t('booking.cars.rental.extra', {
        name: t('booking.cars.rental.extraNames.child_seat'),
        count: 2,
      }),
    );
    await expect(details).toContainText(/Lekki branch/);
    await expect(details).toContainText(/Benin.+Togo.+Ghana/);
    const lines = page.getByTestId('price-line');
    for (const code of ['rental_extras', 'rental_one_way', 'rental_cross_border'] as const) {
      await expect(lines.filter({ hasText: t(`checkout.breakdown.${code}`) })).toHaveCount(1);
    }
    await page.locator('#guest-0-givenNames').fill('Ada');
    await page.locator('#guest-0-surname').fill('Okafor');
    await contactAndTerms(page, 'renter-options@example.com');
    await payAndConfirm(page);
    // The confirmed booking keeps what was chosen.
    await expect(page.getByTestId('cars-details')).toContainText(/Lekki branch/);
    await expect(page.getByTestId('cars-details')).toContainText(/Benin.+Togo.+Ghana/);
    await expectNoAxeViolations(page);
  });
});

test.describe('emergency contacts', () => {
  test('a rider saves an emergency contact for SOS', async ({ page }) => {
    await signedIn(page, 'web-contacts');
    await page.goto('/account/security');
    const card = page.getByTestId('emergency-contacts');
    await card.getByRole('button', { name: t('account.emergency.add') }).click();
    await page.locator('#emergency-0-name').fill('Chidi Okafor');
    await page.locator('#emergency-0-phone').fill('+2348031234567');
    await card.getByRole('button', { name: t('account.emergency.save') }).click();
    await expect(card.getByText(t('account.emergency.saved'))).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
