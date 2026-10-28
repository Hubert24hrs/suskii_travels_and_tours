import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import { preferences } from '../lib/cache';
import { json, mockApi, renderWithApp } from '../test/app';
import { flightQuote } from '../test/fixtures';

import { FlightResultsScreen } from './flight-results-screen';

const m = getMessages('en-NG');
const SEARCH_ID = 'fs_0123456789abcdef';

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
      depart: '2026-11-02',
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
    expect(calls.filter((request) => request.method === 'GET')).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: m.mobile.search.filters }));
    await fireEvent.press(await screen.findByRole('radio', { name: m.results.sort.cheapest }));
    await waitFor(async () => expect(await screen.findAllByTestId('flight-offer')).toHaveLength(2));
    const list = calls.find((request) => request.method === 'GET');
    expect(new URL(list?.url ?? '').searchParams.get('sort')).toBe('cheapest');
  });

  it('asks for half the results per page in data-saver mode', async () => {
    preferences.set('preferences.dataSaver', true);
    const { calls } = mockApi({ 'POST /v1/flights/searches': () => json(flightResults(10)) });
    await renderWithApp(<FlightResultsScreen />);

    expect(await screen.findAllByTestId('flight-offer')).toHaveLength(10);
    const search = calls.find((request) => request.url.includes('/v1/flights/searches'));
    expect(new URL(search?.url ?? '').searchParams.get('limit')).toBe('10');
  });
});
