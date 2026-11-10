import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { addDays } from '@suskii/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { preferences } from '../lib/cache';
import { json, mockApi, renderWithApp } from '../test/app';
import { flightQuote } from '../test/fixtures';

import { FlightResultsScreen } from './flight-results-screen';

const m = getMessages('en-NG');
const SEARCH_ID = 'fs_0123456789abcdef';
/** A month ahead, so the form's rules never see a past date however late the suite runs. */
const DEPART = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

function flightResults(count: number, sort = 'best'): Schemas['FlightSearchResult'] {
  const quote = flightQuote();
  const offer = quote.flight?.offer;
  if (!offer || !quote.flight) throw new Error('the fixture is a flight');
  return {
    searchId: SEARCH_ID,
    status: 'complete',
    request: { ...quote.flight.request, directOnly: false },
    currency: 'NGN',
    suppliers: [{ supplier: 'mock', status: 'ok', durationMs: 12, resultCount: count }],
    resultsExpireAt: '2026-10-01T10:00:00.000Z',
    total: count,
    nextCursor: null,
    offers: Array.from({ length: count }, (_, index) => ({
      ...offer,
      id: `${SEARCH_ID}.${sort}${index}`,
    })),
    facets: {
      airlines: [],
      stops: [],
      price: null,
      durationMinutes: null,
      departureWindows: [],
      refundable: 0,
      withCheckedBag: 0,
    },
  };
}

describe('results screens (ADR-075)', () => {
  beforeEach(() => {
    preferences.clearAll();
    jest.mocked(useLocalSearchParams).mockReturnValue({
      trip: 'one_way',
      from: 'LOS',
      to: 'ABV',
      depart: DEPART,
      adults: '1',
    });
  });

  it('shows the page the search answers with, and asks again only for another sort', async () => {
    const { calls } = mockApi({
      'POST /v1/flights/searches': () => json(flightResults(3)),
      [`GET /v1/flights/searches/${SEARCH_ID}/offers`]: () => json(flightResults(2, 'cheapest')),
    });
    await renderWithApp(<FlightResultsScreen />);

    expect(await screen.findAllByTestId('flight-offer')).toHaveLength(3);
    const search = calls.find((request) => request.url.includes('/v1/flights/searches'));
    expect(new URL(search?.url ?? '').searchParams.get('limit')).toBe('20');
    // One round trip: no second request for the same first page.
    const pages = () => calls.filter((request) => request.url.includes('/offers'));
    expect(pages()).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: m.mobile.search.filters }));
    await fireEvent.press(await screen.findByRole('radio', { name: m.results.sort.cheapest }));
    await waitFor(async () => expect(await screen.findAllByTestId('flight-offer')).toHaveLength(2));
    expect(new URL(pages()[0]?.url ?? '').searchParams.get('sort')).toBe('cheapest');
  });

  it('asks for half the results per page in data-saver mode', async () => {
    preferences.set('preferences.dataSaver', true);
    const { calls } = mockApi({ 'POST /v1/flights/searches': () => json(flightResults(10)) });
    await renderWithApp(<FlightResultsScreen />);

    expect(await screen.findAllByTestId('flight-offer')).toHaveLength(10);
    const search = calls.find((request) => request.url.includes('/v1/flights/searches'));
    expect(new URL(search?.url ?? '').searchParams.get('limit')).toBe('10');
  });

  it('prices no other day until the traveller asks for flexible dates', async () => {
    const { calls } = mockApi({ 'POST /v1/flights/searches': () => json(flightResults(1)) });
    await renderWithApp(<FlightResultsScreen />);

    await fireEvent.press(await screen.findByTestId('flexible-dates-show'));
    expect(router.setParams).toHaveBeenCalledWith({ flex: '1' });
    // Each day would be a supplier search, so none is asked for on a plain search.
    expect(calls.some((request) => request.url.includes('/date-prices'))).toBe(false);
    expect(screen.queryByTestId('flexible-dates')).toBeNull();
  });

  it('shows the lowest price on the days around a flexible search and searches the day pressed', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({
      trip: 'one_way',
      from: 'LOS',
      to: 'ABV',
      depart: DEPART,
      adults: '1',
      flex: '1',
    });
    const day = (offset: number, amountMinor: number | null) => ({
      offset,
      departureDate: addDays(DEPART, offset),
      returnDate: null,
      status: amountMinor === null ? ('none' as const) : ('priced' as const),
      total: amountMinor === null ? null : { amountMinor, currency: 'NGN' },
    });
    const prices: Schemas['FlightDatePrices'] = {
      currency: 'NGN',
      days: [day(-1, 9_000_000), day(0, 8_500_000), day(1, 7_200_000), day(2, null)],
      cheapestOffset: 1,
    };
    const { calls } = mockApi({
      'POST /v1/flights/searches': () => json(flightResults(1)),
      'POST /v1/flights/date-prices': () => json(prices),
    });
    await renderWithApp(<FlightResultsScreen />);

    const strip = within(await screen.findByTestId('flexible-dates'));
    expect(await strip.findByTestId('flexible-day-1')).toHaveTextContent(/72,000/);
    expect(strip.getByTestId('flexible-day-1')).toHaveTextContent(
      new RegExp(m.results.flexible.lowest),
    );
    expect(strip.getByTestId('flexible-day-0')).toHaveTextContent(
      new RegExp(m.results.flexible.yourDate),
    );
    expect(strip.getByTestId('flexible-day-2')).toHaveTextContent(
      new RegExp(m.results.flexible.none),
    );
    expect(screen.queryByTestId('flexible-dates-show')).toBeNull();
    const asked = calls.find((request) => request.url.includes('/date-prices'));
    expect(new URL(asked?.url ?? '').searchParams.get('currency')).toBe('NGN');

    await fireEvent.press(strip.getByTestId('flexible-day-1'));
    expect(router.setParams).toHaveBeenCalledWith({ depart: addDays(DEPART, 1) });
  });

  it('offers the same search from or to a nearby airport', async () => {
    const near = (code: string, name: string, distanceKm: number) => ({
      code,
      name,
      cityName: name,
      countryCode: 'NG',
      distanceKm,
    });
    mockApi({
      'POST /v1/flights/searches': () => json(flightResults(1)),
      'GET /v1/catalog/airports/LOS/nearby': () =>
        json({ airport: 'LOS', radiusKm: 150, items: [near('IBA', 'Ibadan Airport', 113)] }),
      // The other end of this search is never offered as its own neighbour.
      'GET /v1/catalog/airports/ABV/nearby': () =>
        json({ airport: 'ABV', radiusKm: 150, items: [near('LOS', 'Lagos Airport', 140)] }),
    });
    await renderWithApp(<FlightResultsScreen />);

    const nearby = within(await screen.findByTestId('nearby-airports'));
    expect(nearby.getByTestId('nearby-from-IBA')).toHaveTextContent(/Ibadan Airport \(IBA\)/);
    expect(nearby.queryByTestId('nearby-to-LOS')).toBeNull();
    await fireEvent.press(nearby.getByTestId('nearby-from-IBA'));
    expect(router.setParams).toHaveBeenCalledWith({ from: 'IBA' });
  });
});
