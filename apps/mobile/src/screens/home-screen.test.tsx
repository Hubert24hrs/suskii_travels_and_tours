import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { json, mockApi, renderWithApp } from '../test/app';

import { HomeScreen } from './home-screen';

const m = getMessages('en-NG');

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

  it('keeps an incomplete search on the form and explains what is missing', async () => {
    mockApi({ 'GET /v1/deals/flights': () => json({ currency: 'NGN', origins: [], deals: [] }) });
    await renderWithApp(<HomeScreen />);

    await fireEvent.press(screen.getByTestId('search-submit'));

    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getAllByText(m.search.issues.required).length).toBeGreaterThan(0);
  });
});
