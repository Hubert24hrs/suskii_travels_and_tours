import type { Page } from '@playwright/test';

import { expect, expectNoAxeViolations, isoDaysFromToday, t, test } from './fixtures';

/**
 * Phase 8 acceptance: each in-house vertical booked end to end with the mock payment provider,
 * on the sample inventory the e2e stack seeds (`db:seed:demo`). Packages and tours go from the
 * catalog to a voucher and a cancellation under the policy; visa assistance to an application
 * with an encrypted, virus-checked upload behind a signed link; add-ons attach to a trip.
 */

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

interface Traveller {
  title: string;
  gender: string;
  given: string;
  surname: string;
  dateOfBirth: string;
}

const ADA: Traveller = {
  title: 'ms',
  gender: 'f',
  given: 'Ada',
  surname: 'Okafor',
  dateOfBirth: '1990-04-01',
};

async function fillTraveller(
  page: Page,
  index: number,
  person: Traveller,
  passport: boolean,
): Promise<void> {
  await page.locator(`#passenger-${index}-title`).selectOption(person.title);
  await page.locator(`#passenger-${index}-gender`).selectOption(person.gender);
  await page.locator(`#passenger-${index}-givenNames`).fill(person.given);
  await page.locator(`#passenger-${index}-surname`).fill(person.surname);
  await page.locator(`#passenger-${index}-dateOfBirth`).fill(person.dateOfBirth);
  await page.locator(`#passenger-${index}-nationality`).selectOption('NG');
  if (passport) {
    await page.locator(`#passenger-${index}-passportNumber`).fill(`B123456${index}`);
    await page.locator(`#passenger-${index}-issuingCountry`).selectOption('NG');
    await page.locator(`#passenger-${index}-passportExpiry`).fill(isoDaysFromToday(3000));
  } else {
    await expect(page.locator(`#passenger-${index}-passportNumber`)).toHaveCount(0);
  }
}

async function fillContactAndAccept(page: Page, email: string): Promise<void> {
  await page.locator('#contact-email').fill(email);
  await page.locator('#contact-phone').fill('+234 801 234 5678');
  await page.getByLabel(t('checkout.terms')).check();
}

/** Pays on the mock provider's page and lands on the confirmed booking. */
async function payAndConfirm(page: Page): Promise<string> {
  const total = (await page.getByTestId('checkout-total').textContent()) ?? '';
  await page.getByRole('button', { name: t('checkout.pay') }).click();
  await page.waitForURL(/\/checkout\/mock-payment\//);
  const pay = page.getByRole('button', { name: /^Pay / });
  expect((await pay.textContent())?.replace(/^Pay\s+/, '')).toBe(total);
  await pay.click();
  await page.waitForURL(/\/bookings\//);
  await expect(page.getByTestId('booking-status')).toHaveText(t('booking.status.CONFIRMED'), {
    timeout: 30_000,
  });
  return total;
}

/** From a catalog detail page: the first open date for the group, then checkout. */
async function chooseFirstDate(page: Page): Promise<void> {
  await page.getByRole('button', { name: t('inhouse.book.submit') }).click();
  await page.waitForURL(/\/checkout\//);
  await expect(page.getByTestId('passenger-0')).toBeVisible();
}

test.describe('packages', () => {
  test('goes from the catalog to a voucher, then cancels under the policy', async ({ page }) => {
    await page.goto('/packages');
    const cards = page.getByTestId('package-cards');
    await expect(cards.getByText(t('inhouse.sample')).first()).toBeVisible();
    await expectNoAxeViolations(page);
    await cards.getByRole('link', { name: 'Zanzibar beach break' }).click();

    await page.waitForURL(/\/packages\/sample-zanzibar-beach-break/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Zanzibar beach break' }),
    ).toBeVisible();
    await expect(page.getByText(t('inhouse.detail.passportRequired'))).toBeVisible();
    await expect(
      page.getByText(t('inhouse.detail.tier', { percent: '100', count: 30 })),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await chooseFirstDate(page);

    // Packages abroad need passports; the summary names the product and its policy.
    await expect(page.getByText(t('checkout.passportRequired'))).toBeVisible();
    await expect(page.getByTestId('inhouse-package')).toContainText('Zanzibar beach break');
    await expect(page.getByLabel(t('checkout.plan.hold'))).toBeVisible();
    await expectNoAxeViolations(page);
    await fillTraveller(page, 0, ADA, true);
    await fillContactAndAccept(page, 'ada@example.com');
    const paid = await payAndConfirm(page);

    await expect(page.getByTestId('voucher-code')).toHaveText(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    await expect(page.getByTestId('booking-paid')).toHaveText(paid);
    await expectNoAxeViolations(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: t('booking.download.package_voucher') }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    // More than 30 days out: everything comes back.
    await page.getByRole('button', { name: t('booking.inhouse.cancel') }).click();
    const dialog = page.getByRole('dialog', { name: t('booking.inhouse.cancelTitle') });
    await expect(dialog).toContainText(
      t('booking.inhouse.cancelRefund', { amount: paid, percent: '100' }),
    );
    await dialog.getByRole('button', { name: t('booking.inhouse.cancelConfirm') }).click();
    await expect(page.getByTestId('booking-status')).toHaveText(
      new RegExp(`${t('booking.status.REFUND_PENDING')}|${t('booking.status.REFUNDED')}`),
      { timeout: 30_000 },
    );
    await expect(page.getByRole('heading', { name: t('booking.refunds.heading') })).toBeVisible();
  });
});

test.describe('tours and add-ons', () => {
  test('books a tour without passports, then attaches an add-on from the trip', async ({
    page,
  }) => {
    await page.goto('/tours');
    await page
      .getByTestId('tour-cards')
      .getByRole('link', { name: 'Dubai desert evening' })
      .click();
    await page.waitForURL(/\/tours\/sample-dubai-desert-evening/);
    await expect(
      page.getByRole('heading', { name: t('inhouse.detail.meetingPoint') }),
    ).toBeVisible();
    await chooseFirstDate(page);

    await expect(page.getByTestId('inhouse-tour')).toBeVisible();
    await fillTraveller(page, 0, ADA, false);
    await fillContactAndAccept(page, 'ada.tour@example.com');
    await payAndConfirm(page);
    await expect(page.getByTestId('voucher-code')).toBeVisible();
    const tripUrl = page.url();
    const reference = (await page.getByRole('heading', { level: 1 }).textContent())?.replace(
      /^Booking\s+/,
      '',
    );

    await page.getByRole('link', { name: t('booking.inhouse.addExtras') }).click();
    await page.waitForURL(/\/travel-add-ons\?for=/);
    await expect(page.getByTestId('addon-trip')).toContainText(reference ?? '');
    await expectNoAxeViolations(page);
    await page
      .getByRole('button', { name: t('addons.add', { title: 'Travel insurance (sample)' }) })
      .click();

    await page.waitForURL(/\/checkout\//);
    await expect(page.getByTestId('inhouse-addon')).toContainText(
      t('booking.inhouse.linkedTo', { reference: reference ?? '' }),
    );
    await fillTraveller(page, 0, ADA, false);
    await fillContactAndAccept(page, 'ada.tour@example.com');
    await payAndConfirm(page);
    await expect(page.getByTestId('inhouse-addon')).toBeVisible();

    // The trip lists the add-on bought for it.
    await page.goto(tripUrl);
    await expect(page.getByRole('link', { name: /Travel insurance \(sample\)/ })).toBeVisible();
  });

  test('collects transfer details for a standalone airport transfer', async ({ page, request }) => {
    const lagos = (await (await request.get(`${API}/v1/catalog/airports/LOS`)).json()) as {
      cityId: string;
    };
    const start = isoDaysFromToday(20);
    await page.goto(
      `/travel-add-ons?type=airport_transfer&dest=${lagos.cityId}&start=${start}&end=${start}&adults=1`,
    );
    await page
      .getByRole('button', { name: t('addons.add', { title: 'Lagos airport transfer (sample)' }) })
      .click();
    await page.waitForURL(/\/checkout\//);

    await fillTraveller(page, 0, ADA, false);
    await fillContactAndAccept(page, 'ada.transfer@example.com');
    await page.locator('#addonDetails-flightNumber').fill('flight');
    await page.getByRole('button', { name: t('checkout.pay') }).click();
    await expect(page.getByText(t('checkout.addonDetails.invalidFlightNumber'))).toBeVisible();

    await page.locator('#addonDetails-flightNumber').fill('p4 7121');
    await page.locator('#addonDetails-arrivalTime').fill(`${start}T14:30`);
    await page.locator('#addonDetails-pickupAddress').fill('12 Admiralty Way, Lekki, Lagos');
    await payAndConfirm(page);
    await expect(page.getByTestId('inhouse-addon')).toContainText(
      t('booking.inhouse.types.airport_transfer'),
    );
  });
});

test.describe('visa assistance', () => {
  test('checks eligibility, books, uploads documents behind signed links and submits', async ({
    page,
  }) => {
    await page.goto(
      `/visa?nationality=NG&destination=AE&purpose=tourism&date=${isoDaysFromToday(40)}`,
    );
    const result = page.getByTestId('visa-eligibility');
    await expect(result).toContainText(t('visa.result.requirements.e_visa'));
    await expect(result).toContainText(t('visa.result.sample'));
    await expectNoAxeViolations(page);
    await page.getByTestId('visa-products').getByRole('link').first().click();

    await page.waitForURL(/\/visa\/sample-uae-tourist-visa/);
    await expect(page.getByRole('heading', { name: t('visa.detail.checklist') })).toBeVisible();
    await page.getByRole('button', { name: t('visa.book.submit') }).click();
    await page.waitForURL(/\/checkout\//);

    // Applicants hold the nationality checked; passports are required.
    await expect(page.locator('#passenger-0-nationality')).toHaveValue('NG');
    await expect(page.getByText(t('checkout.passportRequired'))).toBeVisible();
    await fillTraveller(page, 0, ADA, true);
    await fillContactAndAccept(page, 'ada.visa@example.com');
    await payAndConfirm(page);

    await page.getByRole('link', { name: t('booking.inhouse.openApplication') }).click();
    await page.waitForURL(/\/visa\//);
    await expect(page.getByTestId('visa-status')).toHaveText(
      t('booking.inhouse.applicationStatus.awaiting_documents'),
    );
    await expectNoAxeViolations(page);

    // Anything but PDF, JPEG or PNG is refused before upload.
    const items = page.locator('[data-testid^="visa-item-"]');
    await items
      .first()
      .locator('input[type="file"]')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByText(t('visa.application.errors.type'))).toBeVisible();

    const count = await items.count();
    for (let index = 0; index < count; index += 1) {
      await items
        .nth(index)
        .locator('input[type="file"]')
        .setInputFiles({ name: `document ${index}.pdf`, mimeType: 'application/pdf', buffer: PDF });
      await expect(items.nth(index).getByTestId('visa-document-status')).toHaveText(
        t('visa.application.documentStatus.clean'),
        { timeout: 30_000 },
      );
    }

    // Viewing goes through a short-lived signed link and always downloads.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      items
        .first()
        .getByRole('button', { name: t('visa.application.view', { file: 'document-0.pdf' }) })
        .click(),
    ]);
    expect(download.url()).toMatch(/\/v1\/visa\/documents\/[0-9a-f-]+\/content\?expires=/);
    const tampered = download
      .url()
      .replace(/signature=[^&]+/, 'signature=AAAAAAAAAAAAAAAAAAAAAAAA');
    expect((await page.request.get(tampered)).status()).toBe(404);

    await page.getByRole('button', { name: t('visa.application.submit') }).click();
    await expect(page.getByTestId('visa-status')).toHaveText(
      t('booking.inhouse.applicationStatus.submitted'),
    );
  });
});
