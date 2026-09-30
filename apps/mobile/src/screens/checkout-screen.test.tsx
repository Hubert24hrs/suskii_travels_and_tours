import { getMessages } from '@suskii/i18n';
import { BOOKING_TERMS_VERSION } from '@suskii/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { openHostedCheckout } from '../lib/payment';
import { tripStore } from '../lib/trips';
import { json, mockApi, renderWithApp } from '../test/app';
import { BOOKING_ID, QUOTE_ID, booking, countries, flightQuote } from '../test/fixtures';

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
const TOKEN = 'guest-token-abcdefghijklmnopqrstuvwxyz';
const CHECKOUT_URL = 'https://pay.example/checkout/1';
const change = {
  previous: { amountMinor: 8_500_000, currency: 'NGN' },
  current: { amountMinor: 9_100_000, currency: 'NGN' },
  difference: { amountMinor: 600_000, currency: 'NGN' },
  price: booking().price,
};

const paymentSession = {
  paymentId: '0192d3a0-7c1e-7b2a-9f00-0000000000a1',
  status: 'pending',
  checkoutUrl: CHECKOUT_URL,
  amount: { amountMinor: 8_500_000, currency: 'NGN' },
  expiresAt: '2026-10-01T10:00:00.000Z',
};

function api(payments: (count: number) => Response) {
  let paymentCalls = 0;
  return mockApi({
    [`GET /v1/quotes/${QUOTE_ID}`]: () => json(flightQuote()),
    'GET /v1/catalog/countries': () => json(countries),
    'POST /v1/attestation/challenges': () =>
      json({ challenge: 'challenge-1', expiresAt: '2026-10-01T09:05:00.000Z' }, 201),
    'POST /v1/bookings': () =>
      json({ booking: booking({ status: 'PRICED', documents: [] }), accessToken: TOKEN }, 201),
    [`POST /v1/bookings/${BOOKING_ID}/payments`]: () => payments(++paymentCalls),
    [`POST /v1/bookings/${BOOKING_ID}/price-consent`]: () =>
      json(booking({ status: 'PRICED', documents: [] })),
  });
}

async function fillTraveller(): Promise<void> {
  await screen.findByTestId('checkout');
  await fireEvent.press(screen.getByRole('radio', { name: m.checkout.fields.titles.mr }));
  await fireEvent.press(screen.getByRole('radio', { name: m.checkout.fields.genders.m }));
  await fireEvent.changeText(screen.getByTestId('passengers.0.givenNames'), 'Adébáyọ̀');
  await fireEvent.changeText(screen.getByTestId('passengers.0.surname'), 'Okafor');
  await fireEvent.changeText(screen.getByTestId('passengers.0.dateOfBirth'), '1990-04-21');
  await fireEvent.changeText(screen.getByLabelText(m.checkout.fields.nationality), 'nig');
  await fireEvent.press(await screen.findByRole('button', { name: 'Nigeria' }));
  await fireEvent.changeText(screen.getByTestId('contact-email'), ' ada@example.com ');
  await fireEvent.changeText(screen.getByTestId('contact-phone'), '+234 803 000 0000');
  await fireEvent.press(screen.getByTestId('accept-terms'));
}

describe('CheckoutScreen', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ quoteId: QUOTE_ID });
  });

  it('books as a guest with device attestation, then opens the hosted payment page', async () => {
    const { calls } = api(() => json(paymentSession, 201));
    await renderWithApp(<CheckoutScreen />);
    expect(await screen.findByTestId('checkout-total')).toHaveTextContent(/85,000/);

    await fillTraveller();
    await fireEvent.press(screen.getByTestId('checkout-submit'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/trips/${BOOKING_ID}`));
    expect(openHostedCheckout).toHaveBeenCalledWith(CHECKOUT_URL);

    const create = calls.find((request) => request.url.endsWith('/v1/bookings'));
    expect(create?.headers.get('X-Suskii-Attestation')).toBeTruthy();
    expect(create?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await create?.json()).toEqual({
      quoteId: QUOTE_ID,
      contact: { email: 'ada@example.com', phone: '+2348030000000' },
      passengers: [
        {
          type: 'adult',
          title: 'mr',
          gender: 'm',
          givenNames: 'Adébáyọ̀',
          surname: 'Okafor',
          dateOfBirth: '1990-04-21',
          nationality: 'NG',
          document: null,
        },
      ],
      termsVersion: BOOKING_TERMS_VERSION,
      acceptTerms: true,
      locale: 'en-NG',
      turnstileToken: null,
    });

    const pay = calls.find((request) => request.url.endsWith('/payments'));
    expect(pay?.headers.get('X-Booking-Token')).toBe(TOKEN);
    // The guest token is kept in the secure store for Trips, never in the URL or the cache.
    expect(tripStore.deviceTripIds()).toContain(BOOKING_ID);
    expect(await tripStore.bookingHeaders(BOOKING_ID)).toEqual({ 'X-Booking-Token': TOKEN });
  });

  it('checks the form before calling the API', async () => {
    const { calls } = api(() => json(paymentSession, 201));
    await renderWithApp(<CheckoutScreen />);
    await screen.findByTestId('checkout');

    await fireEvent.press(screen.getByTestId('checkout-submit'));

    expect(screen.getByRole('alert')).toHaveTextContent(m.checkout.issues.summary);
    expect(screen.getByText(m.checkout.issues.terms)).toBeOnTheScreen();
    expect(calls.some((request) => request.method === 'POST')).toBe(false);
  });

  it('asks for consent when the fare changes at payment and pays the new total', async () => {
    const { calls } = api((count) =>
      count === 1
        ? json(
            {
              type: 'urn:suskii:problem:price-changed',
              title: 'Price changed',
              status: 409,
              priceChange: change,
            },
            409,
          )
        : json(paymentSession, 201),
    );
    await renderWithApp(<CheckoutScreen />);
    await fillTraveller();
    await fireEvent.press(screen.getByTestId('checkout-submit'));

    expect(await screen.findByTestId('new-total')).toHaveTextContent(/91,000/);
    expect(router.replace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: m.checkout.priceChange.accept }));

    await waitFor(() => expect(openHostedCheckout).toHaveBeenCalledWith(CHECKOUT_URL));
    const consent = calls.find((request) => request.url.endsWith('/price-consent'));
    expect(await consent?.json()).toEqual({ total: change.current });
    expect(calls.filter((request) => request.url.endsWith('/v1/bookings'))).toHaveLength(1);
  });
});
