import type { Schemas } from '@suskii/api-client';
import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';

import { appConfig } from '../config';
import { openSecureCache, secureCache } from '../lib/cache';
import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import { BOOKING_ID, booking, carsFeatures } from '../test/fixtures';

import { CarsScreen } from './cars-screen';
import { TripScreen } from './trip-screen';

jest.mock('../lib/push', () => ({ followBooking: jest.fn(() => Promise.resolve(true)) }));

const m = getMessages('en-NG');
/** Part of an element's text (`toHaveTextContent` with a string matches the whole text). */
const part = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const TOKEN = 'v2.k1.sealed-token.example.tag';

const offer = (
  patch: Partial<Schemas['PartnerOffer']> & Pick<Schemas['PartnerOffer'], 'id' | 'programId'>,
): Schemas['PartnerOffer'] => ({
  category: 'transfer',
  partnerName: 'GetTransfer',
  title: null,
  imageUrl: null,
  rating: null,
  durationMinutes: null,
  fromPrice: null,
  href: `/v1/go/${TOKEN}`,
  sample: false,
  ...patch,
});

const tripOffers: Schemas['PartnerOffers'] = {
  trip: { countryCode: 'NG', cityName: 'Abuja', startDate: '2026-11-02', endDate: '2026-11-02' },
  partial: false,
  offers: [
    offer({ id: 'gettransfer', programId: 'gettransfer' }),
    offer({
      id: 'viator:SAMPLE1',
      programId: 'viator',
      category: 'activity',
      partnerName: 'Viator',
      title: 'City highlights walking tour in Abuja',
      rating: { average: 4.5, count: 120 },
      durationMinutes: 180,
      fromPrice: { amountMinor: 4_000_000, currency: 'NGN' },
      sample: true,
    }),
  ],
};

describe('partner offers in the app (ADR-069)', () => {
  beforeEach(async () => {
    await openSecureCache();
    secureCache().clearAll();
    jest.mocked(openBrowserAsync).mockClear();
  });

  it('shows partner offers on a confirmed trip and opens them in the browser', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
    const { calls } = mockApi({
      [`GET /v1/bookings/${BOOKING_ID}`]: () => json(booking()),
      'GET /v1/cars/features': () => json(carsFeatures),
      [`GET /v1/bookings/${BOOKING_ID}/partner-offers`]: () => json(tripOffers),
    });
    await renderWithApp(<TripScreen />);

    const card = await screen.findByTestId('partner-offers');
    expect(card).toHaveTextContent(part(m.partners.tripHeading));
    expect(card).toHaveTextContent(part(m.partners.disclosure));
    expect(card).toHaveTextContent(part(m.partners.categoryBody.transfer));
    expect(card).toHaveTextContent(/City highlights walking tour in Abuja/);
    expect(card).toHaveTextContent(/From ₦40,000(\.00)?/);
    expect(card).toHaveTextContent(/4\.5 of 5 \(120\)/);
    expect(card).toHaveTextContent(part(m.partners.sample));
    const request = calls.find((call) => call.url.includes('/partner-offers'));
    expect(new URL(request?.url ?? '').searchParams.get('currency')).toBe('NGN');

    await fireEvent.press(screen.getByTestId('partner-offer-gettransfer'));
    expect(openBrowserAsync).toHaveBeenCalledWith(
      new URL(`/v1/go/${TOKEN}`, appConfig.apiBaseUrl).toString(),
    );
  });

  it('shows nothing on a trip that is not going ahead', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: BOOKING_ID });
    const { calls } = mockApi({
      [`GET /v1/bookings/${BOOKING_ID}`]: () => json(booking({ status: 'CANCELLED' })),
      'GET /v1/cars/features': () => json(carsFeatures),
    });
    await renderWithApp(<TripScreen />);
    await screen.findByTestId('trip-status');
    expect(calls.some((call) => call.url.includes('/partner-offers'))).toBe(false);
    expect(screen.queryByTestId('partner-offers')).toBeNull();
  });

  it('lists partner car rental and transfers on the Cars hub', async () => {
    const { calls } = mockApi({
      'GET /v1/cars/features': () => json(carsFeatures),
      'GET /v1/partners/offers': () =>
        json({
          ...tripOffers,
          trip: { countryCode: 'NG', cityName: null, startDate: null, endDate: null },
          offers: [
            offer({
              id: 'discovercars',
              programId: 'discovercars',
              category: 'car_rental',
              partnerName: 'DiscoverCars',
            }),
            offer({ id: 'gettransfer', programId: 'gettransfer' }),
          ],
        }),
    });
    await renderWithApp(<CarsScreen />, await signedInSession());

    const card = await screen.findByTestId('partner-offers-hub');
    expect(card).toHaveTextContent(part(m.partners.hubHeading));
    expect(card).toHaveTextContent(part(m.partners.open.replace('{partner}', 'DiscoverCars')));
    const request = calls.find((call) => call.url.includes('/v1/partners/offers'));
    const query = new URL(request?.url ?? '').searchParams;
    expect([query.get('countryCode'), query.get('categories')]).toEqual([
      'NG',
      'car_rental,transfer',
    ]);

    await fireEvent.press(screen.getByTestId('partner-offer-discovercars'));
    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
  });

  it('hides partner offers while they are switched off', async () => {
    const { calls } = mockApi({
      'GET /v1/cars/features': () => json(carsFeatures),
      'GET /v1/partners/offers': () => json({ type: 'about:blank', status: 404 }, 404),
    });
    await renderWithApp(<CarsScreen />, await signedInSession());
    expect(await screen.findByTestId('cars-buses')).toBeOnTheScreen();
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/v1/partners/offers'))).toBe(true),
    );
    expect(screen.queryByTestId('partner-offers-hub')).toBeNull();
  });
});
