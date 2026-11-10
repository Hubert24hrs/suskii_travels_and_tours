import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';

/**
 * Live flight status on the booking page (ADR-095). The stack follows flights that leave within
 * three days and its mock flight data runs Lagos to Kano 45 minutes late. The rules (when a
 * flight is followed, what the traveller is told and how often) are covered against the API
 * (`apps/api/test/flight-status.e2e-spec.ts`).
 */

test('shows a delay, the new time and the gate on a booking that leaves tomorrow', async ({
  page,
}) => {
  await page.goto(
    `/flights/search?trip=one_way&from=LOS&to=KAN&depart=${isoDaysFromToday(1)}&adults=1&direct=1`,
  );
  await page
    .getByTestId('flight-offer')
    .first()
    .getByRole('button', { name: /^Select/ })
    .click({ timeout: 30_000 });
  await page.waitForURL(/\/checkout\//);

  await page.locator('#passenger-0-title').selectOption('mr');
  await page.locator('#passenger-0-gender').selectOption('m');
  await page.locator('#passenger-0-givenNames').fill('Musa');
  await page.locator('#passenger-0-surname').fill('Danjuma');
  await page.locator('#passenger-0-dateOfBirth').fill('1985-07-19');
  await page.locator('#passenger-0-nationality').selectOption('NG');
  await page.locator('#contact-email').fill('musa@example.com');
  await page.locator('#contact-phone').fill('+234 801 234 5678');
  await page.getByLabel(t('checkout.terms')).check();
  await page.getByRole('button', { name: t('checkout.pay') }).click();

  await page.waitForURL(/\/checkout\/mock-payment\//);
  await page.getByRole('button', { name: /^Pay / }).click();
  await page.waitForURL(/\/bookings\//);
  await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
    timeout: 30_000,
  });

  const status = page.getByTestId('flight-status');
  await expect(status).toBeVisible({ timeout: 30_000 });
  await expect(
    status.getByRole('heading', { name: t('booking.flightStatus.heading') }),
  ).toBeVisible();
  const flight = status.getByTestId('flight-status-0');
  await expect(flight).toContainText('LOS');
  await expect(flight).toContainText('KAN');
  await expect(flight.getByTestId('flight-state')).toHaveText(
    t('booking.flightStatus.states.delayed'),
  );
  // The expected time, how late that is, and the time it was booked for.
  const late = t('booking.flightStatus.late', {
    duration: t('booking.flightStatus.minutes', { minutes: 45 }),
  });
  await expect(flight.getByTestId('flight-departure')).toContainText(late);
  await expect(flight.getByTestId('flight-departure')).toContainText(
    /Now expected \d{2}:\d{2}.*Scheduled \d{2}:\d{2}/,
  );
  await expect(flight.getByTestId('flight-gate')).toContainText(/Terminal \d · Gate [A-D]\d+/);
  await expect(status).toContainText(t('booking.flightStatus.note'));
  await expectNoAxeViolations(page);
});

test('shows no status on a booking whose flight is weeks away', async ({ page }) => {
  let reads = 0;
  page.on('response', (response) => {
    if (response.url().includes('/flight-status')) reads += 1;
  });
  await page.goto(
    `/flights/search?trip=one_way&from=LOS&to=ABV&depart=${isoDaysFromToday(30)}&adults=1`,
  );
  await page
    .getByTestId('flight-offer')
    .first()
    .getByRole('button', { name: /^Select/ })
    .click({ timeout: 30_000 });
  await page.waitForURL(/\/checkout\//);
  await page.locator('#passenger-0-title').selectOption('ms');
  await page.locator('#passenger-0-gender').selectOption('f');
  await page.locator('#passenger-0-givenNames').fill('Zainab');
  await page.locator('#passenger-0-surname').fill('Aliyu');
  await page.locator('#passenger-0-dateOfBirth').fill('1992-03-08');
  await page.locator('#passenger-0-nationality').selectOption('NG');
  await page.locator('#contact-email').fill('zainab@example.com');
  await page.locator('#contact-phone').fill('+234 801 234 5678');
  await page.getByLabel(t('checkout.terms')).check();
  await page.getByRole('button', { name: t('checkout.pay') }).click();
  await page.waitForURL(/\/checkout\/mock-payment\//);
  await page.getByRole('button', { name: /^Pay / }).click();
  await page.waitForURL(/\/bookings\//);
  await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
    timeout: 30_000,
  });

  // The page asks once, learns that nothing is followed yet, and shows nothing.
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.getByTestId('flight-status')).toHaveCount(0);
});
