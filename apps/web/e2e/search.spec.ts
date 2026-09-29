import {
  parseAddonsParams,
  parseFlightSearchParams,
  parseHotelSearchParams,
  parsePackagesParams,
  parseToursParams,
  parseVisaParams,
} from '@suskii/shared';

import { expect, isoDaysFromToday, t, test } from './fixtures';
import { choose, pickDates, setAdults } from './helpers';

const searchParams = (url: string) => new URL(url).searchParams;

test.describe('search module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('validates the flight form and focuses the first problem', async ({ page }) => {
    await page.getByRole('button', { name: t('search.flights.submit') }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: t('search.issues.summary') }),
    ).toBeVisible();
    const origin = page.locator('#flight-origin-input');
    await expect(origin).toBeFocused();
    await expect(origin).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/$/);

    await choose(page, 'flight-origin', 'LOS', /Lagos/);
    await choose(page, 'flight-destination', 'LOS', /Lagos/);
    await page.getByRole('button', { name: t('search.flights.submit') }).click();
    await expect(page.getByText(t('search.issues.same_origin_destination'))).toBeVisible();
  });

  test('serialises a round trip into the URL and restores it on return', async ({ page }) => {
    const depart = isoDaysFromToday(30);
    const back = isoDaysFromToday(37);
    await choose(page, 'flight-origin', 'LOS', /Lagos/);
    await choose(page, 'flight-destination', 'London', /LHR/);
    await pickDates(page, 'flight-departureDate', depart, back);
    await setAdults(page, 'flight-travellers', 2);
    await page.locator('#flight-cabinClass').selectOption('business');
    await page.getByLabel(t('search.flights.directOnly')).check();
    await page.getByRole('button', { name: t('search.flights.submit') }).click();

    await page.waitForURL(/\/flights\/search\?/);
    const { form } = parseFlightSearchParams(searchParams(page.url()));
    expect(form).toMatchObject({
      tripType: 'round_trip',
      origin: 'LOS',
      destination: 'LHR',
      departureDate: depart,
      returnDate: back,
      travellers: { adults: 2, children: 0, infants: 0 },
      cabinClass: 'business',
      directOnly: true,
      flexibleDates: false,
    });
    // The search entry page pre-fills the same search from the URL.
    await expect(page.locator('#flight-origin-input')).toHaveValue('Lagos (LOS)');
    await expect(page.locator('#flight-cabinClass')).toHaveValue('business');

    // Back on the homepage, the last search on this device is restored.
    await page.goto('/');
    await expect(page.locator('#flight-origin-input')).toHaveValue('Lagos (LOS)');
    await expect(page.locator('#flight-destination-input')).toHaveValue(/\(LHR\)/);
  });

  test('builds a multi-city search leg by leg', async ({ page }) => {
    await page.getByRole('radio', { name: t('search.flights.tripTypes.multi_city') }).click();
    const legOrigins = page.locator('[id^="flight-legs-"][id$="-origin-input"]');
    await expect(legOrigins).toHaveCount(2);
    await page.getByRole('button', { name: t('search.flights.addLeg') }).click();
    await expect(legOrigins).toHaveCount(3);
    await page.getByRole('button', { name: t('search.flights.removeLeg', { number: 3 }) }).click();
    await expect(legOrigins).toHaveCount(2);

    const first = isoDaysFromToday(20);
    const second = isoDaysFromToday(27);
    await choose(page, 'flight-legs-0-origin', 'LOS', /Lagos/);
    await choose(page, 'flight-legs-0-destination', 'Accra', /ACC/);
    await pickDates(page, 'flight-legs-0-departureDate', first);
    await choose(page, 'flight-legs-1-origin', 'Accra', /ACC/);
    await choose(page, 'flight-legs-1-destination', 'Nairobi', /NBO/);
    await pickDates(page, 'flight-legs-1-departureDate', second);
    await page.getByRole('button', { name: t('search.flights.submit') }).click();

    await page.waitForURL(/\/flights\/search\?trip=multi_city/);
    const { form } = parseFlightSearchParams(searchParams(page.url()));
    expect(form).toMatchObject({
      tripType: 'multi_city',
      legs: [
        { origin: 'LOS', destination: 'ACC', departureDate: first },
        { origin: 'ACC', destination: 'NBO', departureDate: second },
      ],
    });
  });

  test('explains an incomplete search link and keeps what it could read', async ({ page }) => {
    await page.goto('/flights/search?trip=round_trip&from=LOS');
    await expect(page.getByText(t('pages.searchEntry.invalid'))).toBeVisible();
    await expect(page.locator('#flight-origin-input')).toHaveValue('Lagos (LOS)');
  });

  test('routes the hotels tab to the hotel search', async ({ page }) => {
    await page.getByRole('tab', { name: t('search.tabs.hotels') }).click();
    await choose(page, 'hotel-destination-cityId', 'Dubai', /Dubai/);
    await pickDates(page, 'hotel-checkIn', isoDaysFromToday(30), isoDaysFromToday(33));
    await page.getByRole('button', { name: t('search.hotels.submit') }).click();

    await page.waitForURL(/\/hotels\/search\?/);
    const { form } = parseHotelSearchParams(searchParams(page.url()));
    expect(form).toMatchObject({
      checkIn: isoDaysFromToday(30),
      checkOut: isoDaysFromToday(33),
      rooms: [{ adults: 2, childAges: [] }],
    });
  });

  test('routes the packages tab to the packages page', async ({ page }) => {
    await page.getByRole('tab', { name: t('search.tabs.packages') }).click();
    await choose(page, 'package-cityId', 'Dubai', /Dubai/);
    await page.getByRole('button', { name: t('search.packages.submit') }).click();

    await page.waitForURL(/\/packages\?/);
    const { form } = parsePackagesParams(searchParams(page.url()));
    expect(form).toMatchObject({ when: { type: 'month' }, travellers: { adults: 2 } });
  });

  test('routes the tours tab to the tours page', async ({ page }) => {
    await page.getByRole('tab', { name: t('search.tabs.tours') }).click();
    await page.getByLabel(t('search.tours.query')).fill('Zanzibar');
    await pickDates(page, 'tour-date', isoDaysFromToday(14));
    await page.getByRole('button', { name: t('search.tours.submit') }).click();

    await page.waitForURL(/\/tours\?/);
    const { form } = parseToursParams(searchParams(page.url()));
    expect(form).toMatchObject({ query: 'Zanzibar', date: isoDaysFromToday(14) });
  });

  test('routes the visa tab to the visa page', async ({ page }) => {
    await page.getByRole('tab', { name: t('search.tabs.visa') }).click();
    await choose(page, 'visa-destination', 'United Kingdom', /United Kingdom/);
    await pickDates(page, 'visa-travelDate', isoDaysFromToday(60));
    await page.getByRole('button', { name: t('search.visa.submit') }).click();

    await page.waitForURL(/\/visa\?/);
    const { form } = parseVisaParams(searchParams(page.url()));
    expect(form).toMatchObject({
      nationality: 'NG',
      destination: 'GB',
      purpose: 'tourism',
      travelDate: isoDaysFromToday(60),
    });
  });

  test('keeps the last name out of the add-ons URL', async ({ page }) => {
    await page.getByRole('tab', { name: t('search.tabs.travel_addons') }).click();
    await page.getByRole('radio', { name: t('search.addons.modes.booking') }).click();
    await page.getByLabel(t('search.addons.bookingReference')).fill('ABC123');
    await page.getByLabel(t('search.addons.lastName')).fill('Okafor');
    await page.getByRole('button', { name: t('search.addons.submitBooking') }).click();

    await page.waitForURL(/\/travel-add-ons\?/);
    expect(page.url()).not.toContain('Okafor');
    expect(parseAddonsParams(searchParams(page.url()))).toMatchObject({
      mode: 'booking',
      bookingReference: 'ABC123',
    });
    // The name typed on the previous page comes back from this tab's session storage.
    await expect(page.getByLabel(t('search.addons.lastName'))).toHaveValue('Okafor');
  });
});
