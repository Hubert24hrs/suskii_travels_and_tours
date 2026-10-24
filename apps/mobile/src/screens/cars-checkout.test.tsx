import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import {
  BOOKING_ID,
  QUOTE_ID,
  booking,
  busQuote,
  countries,
  rentalQuote,
  rideQuote,
} from '../test/fixtures';

import { CheckoutScreen } from './checkout-screen';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-android/0.1.0',
}));
jest.mock('../lib/push', () => ({ followBooking: jest.fn(() => Promise.resolve(false)) }));
jest.mock('../lib/payment', () => ({
  ...jest.requireActual<object>('../lib/payment'),
  openHostedCheckout: jest.fn(() => Promise.resolve()),
}));

const m = getMessages('en-NG');
const paymentSession = {
  paymentId: '0192d3a0-7c1e-7b2a-9f00-0000000000a1',
  status: 'pending',
  checkoutUrl: 'https://pay.example/checkout/1',
  amount: { amountMinor: 320_000, currency: 'NGN' },
  expiresAt: '2026-10-01T10:00:00.000Z',
};

function api(quote: ReturnType<typeof busQuote>) {
  return mockApi({
    [`GET /v1/quotes/${QUOTE_ID}`]: () => json(quote),
    'GET /v1/catalog/countries': () => json(countries),
    'POST /v1/bookings': () =>
      json({ booking: booking({ status: 'PRICED' }), accessToken: null }, 201),
    [`POST /v1/bookings/${BOOKING_ID}/payments`]: () => json(paymentSession, 201),
  });
}

async function contactAndTerms(): Promise<void> {
  await fireEvent.changeText(screen.getByTestId('contact-email'), 'ada@example.com');
  await fireEvent.changeText(screen.getByTestId('contact-phone'), '+234 803 000 0000');
  await fireEvent.press(screen.getByTestId('accept-terms'));
}

describe('Cars checkout on mobile', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ quoteId: QUOTE_ID });
  });

  it('names a traveller per bus seat, asks for no passport and shows the hold', async () => {
    api(busQuote());
    await renderWithApp(<CheckoutScreen />, await signedInSession());

    expect(await screen.findByTestId('cars-summary')).toHaveTextContent(/Lagos to Ibadan/);
    expect(screen.getByTestId('cars-summary')).toHaveTextContent(/Seats 1A, 2A/);
    expect(screen.getByText(/Seats held until/)).toBeOnTheScreen();
    expect(screen.getByTestId('passengers.0.givenNames')).toBeOnTheScreen();
    expect(screen.getByTestId('passengers.1.givenNames')).toBeOnTheScreen();
    expect(screen.queryByTestId('passengers.0.passportNumber')).toBeNull();
    expect(screen.queryByTestId('guests.0.givenNames')).toBeNull();
    // Nationality suggestions come from the country list once it has loaded.
    const [nationality] = screen.getAllByLabelText(m.checkout.fields.nationality);
    await fireEvent.changeText(nationality!, 'nig');
    expect(await screen.findByRole('button', { name: 'Nigeria' })).toBeOnTheScreen();
  });

  it('books a ride for the named rider and sends guests, not passengers', async () => {
    const { calls } = api(rideQuote());
    await renderWithApp(<CheckoutScreen />, await signedInSession());

    expect(await screen.findByText(m.mobile.cars.rider)).toBeOnTheScreen();
    expect(screen.getByTestId('cars-summary')).toHaveTextContent(/Yaba to Victoria Island/);
    expect(screen.queryByTestId('passengers.0.givenNames')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('guests.0.givenNames'), 'Ada');
    await fireEvent.changeText(screen.getByTestId('guests.0.surname'), 'Okafor');
    await contactAndTerms();
    await fireEvent.press(screen.getByTestId('checkout-submit'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/trips/${BOOKING_ID}`));
    const create = calls.find((request) => request.url.endsWith('/v1/bookings'));
    const body = (await create?.json()) as Record<string, unknown>;
    expect(body.guests).toEqual([{ givenNames: 'Ada', surname: 'Okafor' }]);
    expect(body).not.toHaveProperty('passengers');
  });

  it('shows the refundable rental deposit next to the total', async () => {
    api(rentalQuote());
    await renderWithApp(<CheckoutScreen />, await signedInSession());

    expect(await screen.findByText(m.mobile.cars.renter)).toBeOnTheScreen();
    expect(screen.getByTestId('checkout-total')).toHaveTextContent(/70,000/);
    expect(screen.getByTestId('checkout-deposit')).toHaveTextContent(/₦100,000/);
    expect(screen.getByTestId('cars-summary')).toHaveTextContent(/Toyota Corolla \(2021\)/);
  });
});
