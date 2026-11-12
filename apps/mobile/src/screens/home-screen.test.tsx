import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { daysFromToday } from '../lib/dates';
import { json, mockApi, renderWithApp } from '../test/app';
import { carsFeatures, rentalVehicle } from '../test/fixtures';

import { HomeScreen } from './home-screen';

const m = getMessages('en-NG');

const destination: Schemas['HotelDestination'] = {
  id: '0192d3a0-7c1e-7b2a-9f00-00000000d001',
  slug: 'dubai',
  city: { id: '0192d3a0-7c1e-7b2a-9f00-00000000d002', name: 'Dubai', timeZone: 'Asia/Dubai' },
  country: { code: 'AE', name: 'United Arab Emirates' },
  imageUrl: null,
  hotelCount: 42,
  fromPricePerNight: { amountMinor: 8_500_000, currency: 'NGN' },
  sample: true,
  updatedAt: new Date().toISOString(),
};

const packageCard: Schemas['PackageCard'] = {
  id: '0192d3a0-7c1e-7b2a-9f00-00000000d101',
  slug: 'sample-zanzibar-escape',
  title: 'Zanzibar escape',
  summary: 'Five nights by the ocean.',
  artKey: null,
  sample: true,
  featured: true,
  cityName: 'Zanzibar',
  countryCode: 'TZ',
  nights: 5,
  fromPrice: { amountMinor: 125_000_000, currency: 'NGN' },
  nextDeparture: '2026-12-14',
  departures: 2,
};

const tourCard: Schemas['TourCard'] = {
  id: '0192d3a0-7c1e-7b2a-9f00-00000000d201',
  slug: 'sample-lagos-city-highlights',
  title: 'Lagos city highlights',
  summary: 'A guided day around the city.',
  artKey: null,
  sample: true,
  featured: false,
  cityName: 'Lagos',
  countryCode: 'NG',
  durationMinutes: 240,
  category: 'city',
  fromPrice: { amountMinor: 2_500_000, currency: 'NGN' },
  nextDeparture: '2026-12-01',
  departures: 4,
};

const rentalCar = {
  ...rentalVehicle,
  estimate: {
    rental: { amountMinor: 7_000_000, currency: 'NGN' },
    deposit: rentalVehicle.deposit,
    blocks: { months: 0, weeks: 0, days: 2 },
  },
};

/** Every list Home can ask for, so a test can move between the tabs. */
const everything = {
  'GET /v1/deals/flights': () => json({ currency: 'NGN', origins: [], deals: [deal] }),
  'GET /v1/cars/features': () => json(carsFeatures),
  'GET /v1/destinations/hotels': () => json({ currency: 'NGN', destinations: [destination] }),
  'GET /v1/rentals/vehicles': () => json({ days: 2, vehicles: [rentalCar] }),
  'GET /v1/packages': () => json({ packages: [packageCard] }),
  'GET /v1/tours': () => json({ tours: [tourCard] }),
};

const deal: Schemas['FlightDeal'] = {
  id: 'deal-1',
  routeSlug: 'lagos-to-abuja',
  origin: { code: 'LOS', cityName: 'Lagos', countryCode: 'NG' },
  destination: { code: 'ABV', cityName: 'Abuja', countryCode: 'NG' },
  departureDate: '2026-11-02',
  returnDate: null,
  carrier: { code: 'ZZ', name: 'Demo Air' },
  cabinClass: 'economy',
  stops: 0,
  durationMinutes: 70,
  price: { amountMinor: 8_500_000, currency: 'NGN' },
  sample: false,
  updatedAt: new Date().toISOString(),
};

describe('HomeScreen', () => {
  it('shows the search card and the latest deals', async () => {
    mockApi({
      'GET /v1/deals/flights': () => json({ currency: 'NGN', origins: [], deals: [deal] }),
    });
    await renderWithApp(<HomeScreen />);

    expect(screen.getByRole('header', { name: m.hero.headline })).toBeOnTheScreen();
    expect(screen.getByTestId('flight-search-form')).toBeOnTheScreen();
    expect(
      await screen.findByRole('header', { name: m.mobile.home.dealsHeading }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: m.mobile.home.seeAllDeals }));
    expect(router.push).toHaveBeenCalledWith('/deals');
  });

  it('offers the trip builder: the parts of a trip together, paid once (ADR-099)', async () => {
    mockApi({
      'GET /v1/deals/flights': () => json({ currency: 'NGN', origins: [], deals: [] }),
    });
    await renderWithApp(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId('home-trip-builder'));
    expect(router.push).toHaveBeenCalledWith('/trips/plan');
  });

  it('opens the search behind a deal card', async () => {
    mockApi({
      'GET /v1/deals/flights': () => json({ currency: 'NGN', origins: [], deals: [deal] }),
    });
    await renderWithApp(<HomeScreen />);

    await fireEvent.press(await screen.findByText(m.sections.deals.cta));

    const path = jest.mocked(router.push).mock.calls[0]?.[0];
    expect(path).toMatch(/^\/search\/flights\?/);
    expect(path).toContain('from=LOS');
    expect(path).toContain('to=ABV');
    expect(path).toContain('depart=2026-11-02');
  });

  it('keeps flight deals to the Flights tab', async () => {
    mockApi(everything);
    await renderWithApp(<HomeScreen />);
    const deals = { name: m.mobile.home.dealsHeading };
    expect(await screen.findByRole('header', deals)).toBeOnTheScreen();
    // The Cars tab shows once the API says a Cars product is on.
    await screen.findByTestId('search-tab-cars');

    for (const [tab, shown] of [
      ['hotels', 'home-hotel-destinations'],
      ['cars', 'home-rental-cars'],
      ['packages', 'home-packages'],
      ['tours', 'home-tours'],
    ] as const) {
      await fireEvent.press(screen.getByTestId(`search-tab-${tab}`));
      expect(await screen.findByTestId(shown)).toBeOnTheScreen();
      expect(screen.queryByRole('header', deals)).not.toBeOnTheScreen();
      expect(screen.queryByTestId('home-flight-deals')).not.toBeOnTheScreen();
    }

    await fireEvent.press(screen.getByTestId('search-tab-flights'));
    expect(await screen.findByRole('header', deals)).toBeOnTheScreen();
    expect(screen.queryByTestId('home-tours')).not.toBeOnTheScreen();
  });

  it('shows hotel destinations under Hotels and searches the one tapped', async () => {
    mockApi(everything);
    await renderWithApp(<HomeScreen />);
    await fireEvent.press(screen.getByTestId('search-tab-hotels'));

    expect(
      await screen.findByRole('header', { name: m.sections.destinations.heading }),
    ).toBeOnTheScreen();
    const card = screen.getByTestId('home-destination-dubai');
    expect(card).toHaveTextContent(/Dubai/);
    expect(card).toHaveTextContent(/42 hotels/);
    expect(card).toHaveTextContent(/from ₦85,000\/night/);
    expect(card).toHaveTextContent(m.common.sampleRate, { exact: false });
    await fireEvent.press(screen.getByRole('button', { name: /^Dubai, United Arab Emirates/ }));
    // The search the hotel form starts with: two nights, two weeks out, two adults.
    expect(router.push).toHaveBeenCalledWith(
      `/search/hotels?dest=${destination.city.id}&checkin=${daysFromToday(14)}&checkout=${daysFromToday(16)}&room=2`,
    );
  });

  it('shows cars to rent under Cars and opens the one tapped for the same days', async () => {
    const { calls } = mockApi(everything);
    await renderWithApp(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId('search-tab-cars'));

    const card = await screen.findByTestId(`home-rental-car-${rentalVehicle.slug}`);
    expect(card).toHaveTextContent(/Toyota Corolla \(2021\)/);
    expect(card).toHaveTextContent(m.cars.sample, { exact: false });
    // Free cars for the days the rental search itself starts with.
    const pickupAt = `${daysFromToday(5)}T10:00`;
    const returnAt = `${daysFromToday(7)}T10:00`;
    const asked = calls.find((call) => new URL(call.url).pathname === '/v1/rentals/vehicles');
    expect(Object.fromEntries(new URL(asked?.url ?? 'http://x').searchParams)).toEqual({
      pickupAt,
      returnAt,
    });
    await fireEvent.press(screen.getByRole('button', { name: /^Toyota Corolla \(2021\)/ }));
    expect(router.push).toHaveBeenCalledWith(
      `/rentals/${rentalVehicle.slug}?pickupAt=${encodeURIComponent(pickupAt)}&returnAt=${encodeURIComponent(returnAt)}`,
    );
  });

  it('lists no cars to rent while car rental is off, and does not ask for any', async () => {
    // Buses and rides only: the Cars tab stays, with their ways in.
    const { calls } = mockApi({
      ...everything,
      'GET /v1/cars/features': () => json({ ...carsFeatures, rentals: false }),
    });
    await renderWithApp(<HomeScreen />);
    await fireEvent.press(await screen.findByTestId('search-tab-cars'));

    expect(await screen.findByTestId('home-cars-buses')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-cars-rentals')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('home-rental-cars')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('home-flight-deals')).not.toBeOnTheScreen();
    expect(calls.some((call) => new URL(call.url).pathname === '/v1/rentals/vehicles')).toBe(false);
  });

  it('shows the first packages and tours under their tabs, with the way to the rest', async () => {
    mockApi(everything);
    await renderWithApp(<HomeScreen />);

    await fireEvent.press(screen.getByTestId('search-tab-packages'));
    expect(
      await screen.findByRole('header', { name: m.sections.teaser.packagesTitle }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`home-product-${packageCard.slug}`));
    expect(router.push).toHaveBeenLastCalledWith(`/packages/${packageCard.slug}`);
    await fireEvent.press(screen.getByRole('button', { name: m.inhouse.noResults.packages }));
    expect(router.push).toHaveBeenLastCalledWith('/packages');

    await fireEvent.press(screen.getByTestId('search-tab-tours'));
    expect(
      await screen.findByRole('header', { name: m.sections.teaser.toursTitle }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('home-packages')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`home-product-${tourCard.slug}`));
    expect(router.push).toHaveBeenLastCalledWith(`/tours/${tourCard.slug}`);
    await fireEvent.press(screen.getByRole('button', { name: m.inhouse.noResults.tours }));
    expect(router.push).toHaveBeenLastCalledWith('/tours');
  });

  it('leaves the space empty when a tab has nothing to show', async () => {
    mockApi({
      ...everything,
      'GET /v1/destinations/hotels': () => json({ currency: 'NGN', destinations: [] }),
      'GET /v1/packages': () => json({ packages: [] }),
    });
    await renderWithApp(<HomeScreen />);
    await screen.findByRole('header', { name: m.mobile.home.dealsHeading });

    for (const tab of ['hotels', 'packages'] as const) {
      await fireEvent.press(screen.getByTestId(`search-tab-${tab}`));
      // The trip builder is the last thing on the screen: no list, and no flight deals instead.
      expect(await screen.findByTestId('home-trip-builder')).toBeOnTheScreen();
      expect(screen.queryByTestId('home-flight-deals')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('home-hotel-destinations')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('home-packages')).not.toBeOnTheScreen();
    }
  });

  it('keeps an incomplete search on the form and explains what is missing', async () => {
    mockApi({ 'GET /v1/deals/flights': () => json({ currency: 'NGN', origins: [], deals: [] }) });
    await renderWithApp(<HomeScreen />);

    await fireEvent.press(screen.getByTestId('search-submit'));

    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getAllByText(m.search.issues.required).length).toBeGreaterThan(0);
  });
});
