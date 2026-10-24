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
  await expect(page.getByTestId('register-done')).toHaveText(t('auth.register.done'));
  await page.goto('/sign-in?next=/account');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  // The sign-in URL itself ends in `next=/account`: wait for the account page proper.
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
    await cars.getByRole('link').first().click();

    await page.waitForURL(/\/rentals\/sample-/);
    await expect(page.locator('#book-pickup')).toHaveValue(pickupAt);
    await expectNoAxeViolations(page);
    await page.getByTestId('book-rental').click();

    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('checkout-deposit')).toBeVisible();
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
