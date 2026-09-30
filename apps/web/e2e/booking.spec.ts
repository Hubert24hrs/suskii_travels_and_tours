import type { Page } from '@playwright/test';

import {
  expect,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  isoDaysFromToday,
  t,
  test,
} from './fixtures';
import { PRICE_CHANGE_ROUTE } from './stack';

/**
 * Phase 5 acceptance: search to confirmation with the mock payment provider, the price-change
 * consent path, and the hotel flow to a voucher. Phase 6: reserve now and pay later, and
 * installments from the schedule shown before commitment to a cancelled, refunded plan. Every page
 * is axe-checked on the way.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

const flightSearch = (origin: string, destination: string) =>
  `/flights/search?trip=one_way&from=${origin}&to=${destination}&depart=${isoDaysFromToday(30)}&adults=1`;

async function fillTraveller(page: Page, withPassport: boolean): Promise<void> {
  await page.locator('#passenger-0-title').selectOption('ms');
  await page.locator('#passenger-0-gender').selectOption('f');
  await page.locator('#passenger-0-givenNames').fill('Adébáyọ̀ Chioma');
  await page.locator('#passenger-0-surname').fill('Okafor');
  // The name is shown in its passport (machine-readable) form before booking.
  await expect(
    page.getByText(t('checkout.namePreview', { name: 'OKAFOR/ADEBAYO CHIOMA' })),
  ).toBeVisible();
  await page.locator('#passenger-0-dateOfBirth').fill('1990-04-01');
  await page.locator('#passenger-0-nationality').selectOption('NG');
  if (withPassport) {
    await page.locator('#passenger-0-passportNumber').fill('b 123-4567');
    await page.locator('#passenger-0-issuingCountry').selectOption('NG');
    await page.locator('#passenger-0-passportExpiry').fill(isoDaysFromToday(3000));
  }
}

async function fillContactAndAccept(page: Page, email: string): Promise<void> {
  await page.locator('#contact-email').fill(email);
  await page.locator('#contact-phone').fill('+234 801 234 5678');
  await page.getByLabel(t('checkout.terms')).check();
}

async function payWithMock(page: Page): Promise<string> {
  await page.waitForURL(/\/checkout\/mock-payment\//);
  await expect(page.getByText(t('payment.notice'))).toBeVisible();
  const pay = page.getByRole('button', { name: /^Pay / });
  const amount = (await pay.textContent())?.replace(/^Pay\s+/, '') ?? '';
  await expectNoAxeViolations(page);
  await pay.click();
  await page.waitForURL(/\/bookings\//);
  return amount;
}

/** Opens each result's details until one shows the fare `brand`, then selects it. */
async function selectFare(page: Page, brand: string): Promise<void> {
  const offers = page.getByTestId('flight-offer');
  await expect(offers.first()).toBeVisible({ timeout: 30_000 });
  for (const card of await offers.all()) {
    await card.getByRole('button', { name: t('results.flights.details') }).click();
    if (await card.getByText(t('results.flights.fareBrand', { brand })).first().isVisible()) {
      await card.getByRole('button', { name: /^Select/ }).click();
      await page.waitForURL(/\/checkout\//);
      return;
    }
  }
  throw new Error(`No ${brand} fare in the results`);
}

async function fillPassport(page: Page): Promise<void> {
  await page.locator('#passenger-0-passportNumber').fill('B1234567');
  await page.locator('#passenger-0-issuingCountry').selectOption('NG');
  await page.locator('#passenger-0-passportExpiry').fill(isoDaysFromToday(3000));
}

async function expectConfirmed(page: Page): Promise<void> {
  await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
    timeout: 30_000,
  });
}

test.describe('flight booking', () => {
  test('goes from search results to a confirmed, ticketed booking', async ({ page }) => {
    await page.goto(flightSearch('LOS', 'ABV'));
    const offers = page.getByTestId('flight-offer');
    await expect(offers.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(t('results.demoSupplier'))).toBeVisible();
    await expectNoAxeViolations(page);

    // Filters and sort live in the URL and narrow the list on the API.
    const count = page.locator('#flight-results-count');
    const before = await count.textContent();
    await page.getByLabel(new RegExp(`^${t('results.filters.stopOptions.direct')} ·`)).check();
    await expect(page).toHaveURL(/stops=0/);
    await page.locator('#flight-sort').selectOption('cheapest');
    await expect(page).toHaveURL(/sort=cheapest/);
    await expect(offers.first()).toBeVisible();
    await expect(count).not.toHaveText('');
    expect(before).toBeTruthy();
    for (const card of await offers.all()) {
      await expect(card).toContainText(t('results.flights.direct'));
    }

    // Fare details: segments, baggage and conditions.
    const first = offers.first();
    await first.getByRole('button', { name: t('results.flights.details') }).click();
    await expect(first.getByText(t('results.flights.carryOn'))).toBeVisible();
    await first.getByRole('button', { name: /^Select/ }).click();

    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('passenger-0')).toBeVisible();
    await expect(page.getByText(t('checkout.passportOptional'))).toBeVisible();
    await expectNoAxeViolations(page);

    // Missing details are caught before anything is sent.
    await page.getByRole('button', { name: t('checkout.pay') }).click();
    await expect(page.getByRole('alert').first()).toContainText(t('checkout.issues.summary'));
    await expect(page.locator('#passenger-0-givenNames')).toHaveAttribute('aria-invalid', 'true');

    await fillTraveller(page, false);
    await page.locator('#passenger-0-bags').selectOption('1');
    await fillContactAndAccept(page, 'chioma@example.com');
    const total = await page.getByTestId('checkout-total').textContent();
    await page.getByRole('button', { name: t('checkout.pay') }).click();

    const paid = await payWithMock(page);
    expect(paid).toBe(total);
    await expectConfirmed(page);
    await expect(page.getByTestId('airline-reference')).toHaveText(/^[A-Z]{6}$/);
    await expect(page.getByTestId('ticket-number')).toHaveText(/\d{13}/);
    await expect(page.getByText(t('booking.extraBags', { count: 1 }))).toBeVisible();
    await expectNoAxeViolations(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: t('booking.download.e_ticket') }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^Suskii-e-ticket-[A-Z0-9]{6}\.pdf$/);

    // Without the guest token (another browser), the booking stays private.
    const bookingUrl = page.url();
    const stranger = await page.context().browser()?.newPage();
    if (stranger) {
      await stranger.goto(bookingUrl);
      await expect(stranger.getByText(t('booking.notFound.heading'))).toBeVisible();
      await stranger.close();
    }
  });

  test.describe('price re-check before payment', () => {
    // The payment start answers 409 with the new price; Chrome logs that response.
    test.use({ allowedConsoleErrors: [/status of 409/] });

    test('asks for consent to a changed price, then charges the new total', async ({ page }) => {
      await page.goto(flightSearch(PRICE_CHANGE_ROUTE.origin, PRICE_CHANGE_ROUTE.destination));
      await page
        .getByTestId('flight-offer')
        .first()
        .getByRole('button', { name: /^Select/ })
        .click();
      await page.waitForURL(/\/checkout\//);
      await expect(page.getByText(t('checkout.passportRequired'))).toBeVisible();

      // International trips need a passport.
      await fillTraveller(page, false);
      await fillContactAndAccept(page, 'ngozi@example.com');
      await page.getByRole('button', { name: t('checkout.pay') }).click();
      await expect(page.getByText(t('checkout.issues.passport_required')).first()).toBeVisible();

      await page.locator('#passenger-0-passportNumber').fill('B1234567');
      await page.locator('#passenger-0-issuingCountry').selectOption('NG');
      await page.locator('#passenger-0-passportExpiry').fill(isoDaysFromToday(3000));
      const quoted = await page.getByTestId('checkout-total').textContent();
      await page.getByRole('button', { name: t('checkout.pay') }).click();

      const dialog = page.getByRole('dialog', { name: t('checkout.priceChange.title') });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await expect(dialog).toContainText(quoted ?? '');
      const newTotal = (await dialog.getByTestId('new-total').textContent()) ?? '';
      expect(newTotal).not.toBe(quoted);
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: t('checkout.priceChange.accept') }).click();

      const paid = await payWithMock(page);
      expect(paid).toBe(newTotal);
      await expectConfirmed(page);
      await expect(page.getByText(newTotal).first()).toBeVisible();
    });
  });
});

test.describe('flexible payment', () => {
  // Refundable international fares three or more weeks out can be held (mock supplier rules).
  const refundableSearch = `${flightSearch('LOS', 'LHR')}&refundable=1`;

  test('reserves the seats, then pays in full before the deadline', async ({ page }) => {
    await page.goto(refundableSearch);
    await selectFare(page, 'Economy Flex');
    await expect(page.getByLabel(t('checkout.plan.full'))).toBeChecked();
    await page.getByLabel(t('checkout.plan.hold')).check();

    await fillTraveller(page, false);
    await fillPassport(page);
    await fillContactAndAccept(page, 'amaka@example.com');
    const total = (await page.getByTestId('checkout-total').textContent()) ?? '';
    await page.getByRole('button', { name: t('checkout.plan.reserve') }).click();

    // Nothing is charged: the booking page shows the reservation and its deadline.
    await page.waitForURL(/\/bookings\//);
    await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.HELD'));
    await expect(page.getByText(t('booking.statusHelp.held'))).toBeVisible();
    const plan = page.getByTestId('payment-plan');
    await expect(plan.getByRole('heading', { name: t('booking.plan.holdHeading') })).toBeVisible();
    await expect(page.getByTestId('booking-paid')).toHaveCount(0);
    await expectNoAxeViolations(page);

    await plan.getByRole('button', { name: t('booking.plan.payNext', { amount: total }) }).click();
    const paid = await payWithMock(page);
    expect(paid).toBe(total);
    await expectConfirmed(page);
    await expect(page.getByTestId('ticket-number')).toHaveText(/\d{13}/);
    await expect(page.getByTestId('booking-paid')).toHaveText(total);
  });

  test('shows the installment schedule before commitment, then refunds a cancelled plan', async ({
    page,
  }) => {
    await page.goto(refundableSearch);
    await selectFare(page, 'Economy Flex');
    await fillTraveller(page, false);
    await fillPassport(page);

    // Paid extras cannot go on a plan.
    await page.locator('#passenger-0-bags').selectOption('1');
    await expect(page.getByLabel(t('checkout.plan.installments'))).toHaveCount(0);
    await expect(page.getByText(t('checkout.plan.notWithExtras'))).toBeVisible();
    await page.locator('#passenger-0-bags').selectOption('0');

    // The schedule, fee and missed-payment policy show before anything is committed.
    await expect(page.getByTestId('installment-schedule')).toHaveCount(0);
    await page.getByLabel(t('checkout.plan.installments')).check();
    const schedule = page.getByTestId('installment-schedule');
    await expect(schedule).toBeVisible();
    const rows = schedule.getByRole('listitem');
    expect(await rows.count()).toBeGreaterThan(1);
    await expect(rows.first()).toContainText(t('checkout.plan.depositDue'));
    const deposit = (await rows.first().locator('span').last().textContent()) ?? '';
    const second = (await rows.nth(1).locator('span').last().textContent()) ?? '';
    await expect(schedule).toContainText(t('checkout.plan.noFee'));
    await expect(schedule).toContainText(t('checkout.plan.policyRefund'));
    await expectNoAxeViolations(page);

    await fillContactAndAccept(page, 'emeka@example.com');
    await page.getByRole('button', { name: t('checkout.plan.setUp') }).click();
    await page.waitForURL(/\/bookings\//);
    const plan = page.getByTestId('payment-plan');
    await expect(
      plan.getByRole('heading', { name: t('booking.plan.installmentsHeading') }),
    ).toBeVisible();
    await expect(plan.getByText(t('booking.plan.depositNow'))).toBeVisible();

    await plan
      .getByRole('button', { name: t('booking.plan.payNext', { amount: deposit }) })
      .click();
    expect(await payWithMock(page)).toBe(deposit);
    await expect(page.getByTestId('booking-status')).toHaveText(
      t('booking.status.PARTIALLY_PAID'),
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('plan-paid')).toContainText(deposit);
    // The next installment and its due date replace the deposit prompt.
    const nextDue = t('booking.plan.nextDue', { amount: second, date: '' }).split(' by ')[0] ?? '';
    await expect(plan).toContainText(nextDue);
    await expect(plan.getByText(t('booking.plan.states.paid'), { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    // Cancelling under the plan's policy refunds what was paid (no fee by default).
    await plan.getByRole('button', { name: t('booking.plan.cancel') }).click();
    const dialog = page.getByRole('dialog', { name: t('booking.plan.cancelTitle') });
    await expect(dialog).toContainText(t('booking.plan.cancelRefund', { amount: deposit }));
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: t('booking.plan.cancelConfirm') }).click();

    await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.REFUNDED'), {
      timeout: 30_000,
    });
    const refunds = page.getByTestId('refunds');
    await expect(refunds).toContainText(
      t('booking.refunds.line', {
        amount: deposit,
        destination: t('booking.refunds.destinations.original'),
      }),
    );
    await expect(refunds).toContainText(t('booking.refunds.states.completed'));
    await expect(page.getByText(t('booking.statusHelp.refunded'))).toBeVisible();
  });
});

test.describe('hotel booking', () => {
  test('goes from hotel results to a confirmed stay with a voucher', async ({ page, request }) => {
    const airport = (await (await request.get(`${API}/v1/catalog/airports/LOS`)).json()) as {
      cityId: string;
    };
    await page.goto(
      `/hotels/search?dest=${airport.cityId}&checkin=${isoDaysFromToday(30)}&checkout=${isoDaysFromToday(33)}&room=2&room=1`,
    );
    const hotels = page.getByTestId('hotel-result');
    await expect(hotels.first()).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);

    await page.locator('#hotel-sort').selectOption('price');
    await expect(page).toHaveURL(/sort=price/);
    await page.getByLabel(t('results.filters.freeCancellation'), { exact: true }).check();
    await expect(page).toHaveURL(/freeCancel=1/);
    await expect(hotels.first()).toBeVisible();
    await hotels
      .first()
      .getByRole('link', { name: /^See rooms/ })
      .click();

    const rates = page.getByTestId('hotel-rate');
    await expect(rates.first()).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
    // Back to results keeps the search and the filters.
    await expect(
      page.getByRole('link', { name: t('results.hotels.backToResults') }),
    ).toHaveAttribute('href', /freeCancel=1/);
    await rates
      .first()
      .getByRole('button', { name: /^Select/ })
      .click();

    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('guest-1')).toBeVisible();
    for (const [index, name] of [
      ['0', 'Ngozi'],
      ['1', 'Tunde'],
    ] as const) {
      await page.locator(`#guest-${index}-givenNames`).fill(name);
      await page.locator(`#guest-${index}-surname`).fill('Eze');
    }
    await fillContactAndAccept(page, 'ngozi@example.com');
    await page.getByRole('button', { name: t('checkout.pay') }).click();

    await payWithMock(page);
    await expectConfirmed(page);
    await expect(page.getByTestId('hotel-confirmation')).toHaveText(/^MH[A-Z0-9]{8}$/);
    await expect(
      page.getByRole('button', { name: t('booking.download.hotel_voucher') }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('booking pages on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('results and checkout fit the screen', async ({ page }) => {
    await page.goto(flightSearch('LOS', 'ABV'));
    await expect(page.getByTestId('flight-offer').first()).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page);
    // Filters fold away on small screens.
    await expect(page.locator('#flight-filters')).toBeHidden();
    await page.getByRole('button', { name: t('results.filters.show') }).click();
    await expect(page.locator('#flight-filters')).toBeVisible();

    await page
      .getByTestId('flight-offer')
      .first()
      .getByRole('button', { name: /^Select/ })
      .click();
    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('passenger-0')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
  });
});
