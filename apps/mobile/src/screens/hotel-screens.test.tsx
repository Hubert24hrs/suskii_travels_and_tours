import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import { preferences } from '../lib/cache';
import { json, mockApi, renderWithApp } from '../test/app';

import { HotelRatesScreen } from './hotel-rates-screen';
import { HotelResultsScreen } from './hotel-results-screen';

jest.mock('../config', () => ({
  appConfig: {
    apiBaseUrl: 'http://api.test',
    webBaseUrl: 'https://www.suskii.test',
    attestation: 'mock',
    playIntegrityProject: '',
  },
  CLIENT_ID: 'mobile-android/0.1.0',
}));

const m = getMessages('en-NG');
const SEARCH_ID = 'hs_0123456789abcdef';
const HOTEL_ID = `${SEARCH_ID}.h0`;
const CITY = '0192f0e0-0000-7000-8000-000000000001';
const CHECK_IN = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const CHECK_OUT = new Date(Date.now() + 33 * 86_400_000).toISOString().slice(0, 10);
const ngn = (amountMinor: number) => ({ amountMinor, currency: 'NGN' });

const rate = (id: string, room: Schemas['HotelRate']['room'] = null): Schemas['HotelRate'] => ({
  id,
  roomName: 'Deluxe Room',
  room,
  board: 'breakfast_included',
  refundable: true,
  freeCancellationUntil: null,
  price: {
    currency: 'NGN',
    fare: ngn(18_000_000),
    taxes: ngn(1_350_000),
    fees: [],
    serviceTaxes: [],
    discount: null,
    total: ngn(19_350_000),
    memberSaving: null,
    fx: null,
  },
  pricePerNight: ngn(6_450_000),
  payAtProperty: null,
  expiresAt: '2099-01-01T00:00:00.000Z',
});

const base = {
  supplier: 'mock',
  name: 'The Palm Resort',
  stars: 4,
  reviewScore: 8.4,
  reviewCount: 212,
  latitude: 6.43,
  longitude: 3.42,
  area: 'Waterfront',
  cityName: 'Lagos',
  countryCode: 'NG',
  amenities: ['wifi', 'pool'],
  propertyType: 'resort' as const,
  verifiedReviews: null,
};
const photo = (scene: string, caption: string) => ({
  url: `http://localhost:3000/art/hotels/h3k9abcd12-${scene}.svg`,
  caption,
});

function results(count: number): Schemas['HotelSearchResult'] {
  return {
    searchId: SEARCH_ID,
    status: 'complete',
    request: {
      destination: { type: 'city', cityId: CITY },
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms: [{ adults: 2, childAges: [] }],
      freeCancellationOnly: false,
    },
    currency: 'NGN',
    nights: 3,
    suppliers: [{ supplier: 'mock', status: 'ok', durationMs: 9, resultCount: count }],
    resultsExpireAt: '2099-01-01T00:00:00.000Z',
    total: count,
    nextCursor: null,
    hotels: Array.from({ length: count }, (_, index) => ({
      ...base,
      id: `${SEARCH_ID}.h${index}`,
      photo: photo('exterior', 'The building'),
      cheapestRate: rate(`${SEARCH_ID}.h${index}.r0`),
      freeCancellationAvailable: true,
    })),
    facets: {
      stars: [
        { stars: 5, count: 4, minPrice: ngn(30_000_000) },
        { stars: 4, count: 9, minPrice: ngn(19_350_000) },
      ],
      price: { min: ngn(10_000_000), max: ngn(50_000_000) },
      amenities: [
        { amenity: 'wifi', count: 13 },
        { amenity: 'pool', count: 7 },
      ],
      boards: [
        { board: 'room_only', count: 13 },
        { board: 'breakfast_included', count: 13 },
      ],
      areas: [
        { area: 'Waterfront', count: 6 },
        { area: 'City centre', count: 7 },
      ],
      propertyTypes: [
        { type: 'hotel', count: 8 },
        { type: 'resort', count: 3 },
        { type: 'apartment', count: 2 },
      ],
      freeCancellation: 13,
    },
  };
}

describe('hotel results (ADR-096)', () => {
  beforeEach(() => {
    preferences.clearAll();
    jest.mocked(useLocalSearchParams).mockReturnValue({
      dest: CITY,
      checkin: CHECK_IN,
      checkout: CHECK_OUT,
      room: '2',
    });
  });

  it('shows a picture and the property type on each card', async () => {
    mockApi({ 'POST /v1/hotels/searches': () => json(results(2)) });
    await renderWithApp(<HotelResultsScreen />);

    expect(await screen.findAllByTestId('hotel-result')).toHaveLength(2);
    expect(screen.getAllByTestId('hotel-photo')).toHaveLength(2);
    expect(screen.getAllByText(/4-star · Resort · Waterfront/)).toHaveLength(2);
  });

  it('keeps cards to text under the data saver', async () => {
    preferences.set('preferences.dataSaver', true);
    mockApi({ 'POST /v1/hotels/searches': () => json(results(2)) });
    await renderWithApp(<HotelResultsScreen />);

    expect(await screen.findAllByTestId('hotel-result')).toHaveLength(2);
    expect(screen.queryByTestId('hotel-photo')).toBeNull();
  });

  it('filters by price, stars, property type, meals, amenities and area on the API', async () => {
    const { calls } = mockApi({
      'POST /v1/hotels/searches': () => json(results(3)),
      [`GET /v1/hotels/searches/${SEARCH_ID}/hotels`]: () => json(results(1)),
    });
    await renderWithApp(<HotelResultsScreen />);
    expect(await screen.findAllByTestId('hotel-result')).toHaveLength(3);
    const pages = () => calls.filter((request) => request.url.includes(`${SEARCH_ID}/hotels`));
    // A plain search is one round trip (ADR-075).
    expect(pages()).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('hotel-filters'));
    await fireEvent.press(await screen.findByTestId('hotel-filter-price-1'));
    await fireEvent.press(screen.getByTestId('hotel-filter-stars-5'));
    await fireEvent.press(screen.getByTestId('hotel-filter-stars-4'));
    await fireEvent.press(screen.getByTestId('hotel-filter-type-resort'));
    await fireEvent.press(screen.getByTestId('hotel-filter-board-breakfast_included'));
    await fireEvent.press(screen.getByTestId('hotel-filter-amenity-pool'));
    await fireEvent.press(screen.getByTestId('hotel-filter-area-Waterfront'));
    expect(screen.getByTestId('hotel-filter-type-resort')).toBeChecked();
    await fireEvent.press(screen.getByTestId('hotel-filters-apply'));

    await waitFor(async () => expect(await screen.findAllByTestId('hotel-result')).toHaveLength(1));
    const query = new URL(pages().at(-1)?.url ?? '').searchParams;
    // The second of four steps between NGN 100,000 and NGN 500,000.
    expect(query.get('maxPrice')).toBe('30000000');
    expect(query.get('stars')).toBe('5,4');
    expect(query.get('types')).toBe('resort');
    expect(query.get('board')).toBe('breakfast_included');
    expect(query.get('amenities')).toBe('pool');
    expect(query.get('areas')).toBe('Waterfront');
    // The button says that filters are on.
    expect(screen.getByTestId('hotel-filters')).toHaveTextContent(`${m.mobile.search.filters} •`);

    // Clearing them shows the search's own first page again without another request.
    const asked = pages().length;
    await fireEvent.press(screen.getByTestId('hotel-filters'));
    await fireEvent.press(await screen.findByTestId('hotel-filters-clear'));
    await fireEvent.press(screen.getByTestId('hotel-filters-apply'));
    await waitFor(async () => expect(await screen.findAllByTestId('hotel-result')).toHaveLength(3));
    expect(pages()).toHaveLength(asked);
  });
});

describe('hotel page (ADR-096)', () => {
  const detail = (): Schemas['HotelDetail'] => ({
    ...base,
    id: HOTEL_ID,
    description: 'The Palm Resort is a 4-star resort on the waterfront of Lagos.',
    photos: [
      photo('exterior', 'The building'),
      photo('room', 'A room'),
      // Not https and not our own drawing: never loaded.
      { url: 'http://tracker.example/pixel.gif', caption: null },
    ],
    nights: 3,
    rates: [
      rate(`${HOTEL_ID}.r0`, {
        description: 'A larger room on a higher floor.',
        maxGuests: 2,
        sizeSqm: 28,
        beds: [
          { type: 'queen', count: 1 },
          { type: 'sofa_bed', count: 1 },
        ],
      }),
      rate(`${HOTEL_ID}.r1`),
    ],
  });

  beforeEach(() => {
    preferences.clearAll();
    jest.mocked(useLocalSearchParams).mockReturnValue({ hotelId: HOTEL_ID });
  });

  it('shows the photos, the description and what each room has', async () => {
    mockApi({ [`GET /v1/hotels/results/${HOTEL_ID}`]: () => json(detail()) });
    await renderWithApp(<HotelRatesScreen />);

    expect(await screen.findByTestId('hotel-description')).toHaveTextContent(/4-star resort/);
    expect(screen.getByText(/4-star · Resort · Waterfront, Lagos/)).toBeOnTheScreen();
    // Two pictures of ours; the third URL is neither ours nor https.
    expect(screen.getByTestId('hotel-photo-0')).toHaveAccessibleName(
      'The Palm Resort: photo 1 of 2. The building',
    );
    expect(screen.getByTestId('hotel-photo-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('hotel-photo-2')).toBeNull();
    expect(screen.getByText(m.results.stayContent.samplePhotos)).toBeOnTheScreen();
    // The first rate's room is described; the second has only a name.
    expect(screen.getAllByTestId('room-details')).toHaveLength(1);
    expect(screen.getByTestId('room-details')).toHaveTextContent(
      /Sleeps 2 · 28 m² · 1 × queen bed · 1 × sofa bed/,
    );
    expect(screen.getByText('A larger room on a higher floor.')).toBeOnTheScreen();
  });

  it('leaves the photos out under the data saver', async () => {
    preferences.set('preferences.dataSaver', true);
    mockApi({ [`GET /v1/hotels/results/${HOTEL_ID}`]: () => json(detail()) });
    await renderWithApp(<HotelRatesScreen />);

    expect(await screen.findByTestId('hotel-description')).toBeOnTheScreen();
    expect(screen.queryByTestId('hotel-gallery')).toBeNull();
  });
});
