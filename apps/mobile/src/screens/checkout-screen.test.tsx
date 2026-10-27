import { getMessages } from '@suskii/i18n';
import { BOOKING_TERMS_VERSION } from '@suskii/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { openHostedCheckout } from '../lib/payment';
import { tripStore } from '../lib/trips';
import { json, mockApi, renderWithApp } from '../test/app';
import {
  BOOKING_ID,
  QUOTE_ID,
  booking,
  countries,
  flightQuote,
  hotelQuote,
  inhouseQuote,
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

  it('lists the ways to pay and opens the provider page on the one chosen (ADR-074)', async () => {
    const base = flightQuote();
    let paymentCalls = 0;
    const { calls } = mockApi({
      [`GET /v1/quotes/${QUOTE_ID}`]: () =>
        json(
          flightQuote({
            payment: {
              ...base.payment,
              methods: [
                { method: 'card', providers: ['paystack'] },
                { method: 'bank_transfer', providers: ['paystack'] },
                { method: 'agent', providers: ['paystack'] },
              ],
            },
          }),
        ),
      'GET /v1/catalog/countries': () => json(countries),
      'POST /v1/attestation/challenges': () =>
        json({ challenge: 'challenge-1', expiresAt: '2026-10-01T09:05:00.000Z' }, 201),
      'POST /v1/bookings': () =>
        json({ booking: booking({ status: 'PRICED', documents: [] }), accessToken: TOKEN }, 201),
      [`POST /v1/bookings/${BOOKING_ID}/payments`]: () =>
        (paymentCalls += 1) === 1
          ? json(
              {
                type: 'urn:suskii:problem:payment-method-unavailable',
                title: 'This payment method is not available',
                status: 422,
              },
              422,
            )
          : json(paymentSession, 201),
    });
    await renderWithApp(<CheckoutScreen />);

    // Card comes first and is chosen until the traveller picks another way.
    expect(await screen.findByTestId('method-card')).toBeChecked();
    expect(screen.getByText(m.checkout.method.hints.card)).toBeOnTheScreen();
    expect(screen.queryByText(m.checkout.method.hints.agent)).toBeNull();
    await fillTraveller();
    await fireEvent.press(screen.getByTestId('method-agent'));
    expect(screen.getByTestId('method-agent')).toBeChecked();
    // Only the chosen method explains itself, so the list stays short on a phone.
    expect(screen.getByText(m.checkout.method.hints.agent)).toBeOnTheScreen();
    expect(screen.queryByText(m.checkout.method.hints.card)).toBeNull();
    await fireEvent.press(screen.getByTestId('checkout-submit'));

    // The method went away since the quote: say so and fall back to the first one.
    expect(await screen.findByText(m.checkout.errors.methodUnavailable)).toBeOnTheScreen();
    expect(screen.getByTestId('method-card')).toBeChecked();
    expect(openHostedCheckout).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('checkout-submit'));
    await waitFor(() => expect(openHostedCheckout).toHaveBeenCalledWith(CHECKOUT_URL));
    const bodies = await Promise.all(
      calls
        .filter((request) => request.url.endsWith('/payments'))
        .map((request) => request.json() as Promise<{ method?: string }>),
    );
    expect(bodies.map((body) => body.method)).toEqual(['agent', 'card']);
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

  it('adds checked bags per traveller with a seat, to the total and as extras', async () => {
    const base = flightQuote();
    const flight = base.flight;
    if (!flight) throw new Error('the fixture is a flight');
    const offer = flight.offer;
    const bagged = (passengers: typeof offer.passengers) =>
      flightQuote({
        flight: {
          ...flight,
          offer: {
            ...offer,
            passengers,
            services: [
              {
                id: 'offer-1.bag23',
                type: 'checked_bag',
                weightKg: 23,
                maxQuantity: 2,
                price: { amountMinor: 1_500_000, currency: 'NGN' },
              },
            ],
          },
        },
        // Reserving is never offered with paid extras.
        payment: {
          ...base.payment,
          hold: {
            deadline: '2026-10-04T09:00:00.000Z',
            total: { amountMinor: 8_500_000, currency: 'NGN' },
          },
        },
      });

    // A lap infant cannot add a bag.
    mockApi({
      [`GET /v1/quotes/${QUOTE_ID}`]: () => json(bagged({ adults: 1, children: 0, infants: 1 })),
      'GET /v1/catalog/countries': () => json(countries),
    });
    const first = await renderWithApp(<CheckoutScreen />);
    expect(await screen.findByTestId('passengers.0.bags-0')).toBeOnTheScreen();
    expect(screen.queryByTestId('passengers.1.bags-0')).toBeNull();
    first.unmount();

    const { calls } = mockApi({
      [`GET /v1/quotes/${QUOTE_ID}`]: () => json(bagged({ adults: 1, children: 0, infants: 0 })),
      'GET /v1/catalog/countries': () => json(countries),
      'POST /v1/attestation/challenges': () =>
        json({ challenge: 'challenge-1', expiresAt: '2026-10-01T09:05:00.000Z' }, 201),
      'POST /v1/bookings': () =>
        json({ booking: booking({ status: 'PRICED', documents: [] }), accessToken: TOKEN }, 201),
      [`POST /v1/bookings/${BOOKING_ID}/payments`]: () => json(paymentSession, 201),
    });
    await renderWithApp(<CheckoutScreen />);
    expect(await screen.findByTestId('plan-hold')).toBeOnTheScreen();
    await fillTraveller();
    await fireEvent.press(screen.getByTestId('passengers.0.bags-2'));

    expect(screen.getByTestId('checkout-extras')).toHaveTextContent(/30,000/);
    expect(screen.getByTestId('checkout-total')).toHaveTextContent(/115,000/);
    expect(screen.queryByTestId('plan-hold')).toBeNull();
    expect(screen.getByText(m.checkout.plan.notWithExtras)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('checkout-submit'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/trips/${BOOKING_ID}`));
    const create = calls.find((request) => request.url.endsWith('/v1/bookings'));
    const body = (await create?.json()) as { extras?: unknown };
    expect(body.extras).toEqual([{ serviceId: 'offer-1.bag23', passengerIndex: 0, quantity: 2 }]);
  });

  it('shows tax on our service as its own line inside the total (ADR-072)', async () => {
    const tour = inhouseQuote('tour');
    if (!tour.price) throw new Error('the fixture is priced');
    mockApi({
      [`GET /v1/quotes/${QUOTE_ID}`]: () =>
        json({
          ...tour,
          price: {
            ...tour.price,
            serviceTaxes: [
              {
                code: 'vat',
                label: 'VAT',
                rateBps: 750,
                amount: { amountMinor: 712_500, currency: 'NGN' },
                registrationNumber: 'TIN 01234567-0001',
              },
            ],
            total: { amountMinor: 10_212_500, currency: 'NGN' },
          },
        }),
      'GET /v1/catalog/countries': () => json(countries),
    });
    await renderWithApp(<CheckoutScreen />);

    const line = await screen.findByTestId('service-tax');
    expect(line).toHaveTextContent(/VAT \(7\.5%\)/);
    expect(line).toHaveTextContent(/7,125/);
    expect(screen.getByTestId('checkout-total')).toHaveTextContent(/102,125/);
  });

  it('notes hotel taxes collected at the property beside the total', async () => {
    mockApi({
      [`GET /v1/quotes/${QUOTE_ID}`]: () => json(hotelQuote()),
      'GET /v1/catalog/countries': () => json(countries),
    });
    await renderWithApp(<CheckoutScreen />);

    expect(await screen.findByTestId('checkout-pay-at-property')).toHaveTextContent(/5,000/);
    expect(screen.queryByTestId('service-tax')).toBeNull();
  });

  it('asks for passports for a package abroad and shows the product, not a fare', async () => {
    mockApi({
      [`GET /v1/quotes/${QUOTE_ID}`]: () => json(inhouseQuote('package')),
      'GET /v1/catalog/countries': () => json(countries),
    });
    await renderWithApp(<CheckoutScreen />);

    expect(await screen.findByTestId('inhouse-package')).toHaveTextContent(/Zanzibar beach break/);
    expect(screen.getByText(m.checkout.passportRequired)).toBeOnTheScreen();
    expect(screen.getByTestId('passengers.0.passportNumber')).toBeOnTheScreen();
    expect(screen.getByText(m.checkout.basePrice)).toBeOnTheScreen();
    // In-house prices carry no separate taxes line when there are none.
    expect(screen.queryByText(m.checkout.taxes)).toBeNull();
    expect(screen.getByTestId('checkout-total')).toHaveTextContent(/1,250,000/);
  });

  it('books a tour without passport details and sends no add-on details', async () => {
    const { calls } = mockApi({
      [`GET /v1/quotes/${QUOTE_ID}`]: () => json(inhouseQuote('tour')),
      'GET /v1/catalog/countries': () => json(countries),
      'POST /v1/attestation/challenges': () =>
        json({ challenge: 'challenge-1', expiresAt: '2026-10-01T09:05:00.000Z' }, 201),
      'POST /v1/bookings': () =>
        json({ booking: booking({ status: 'PRICED', documents: [] }), accessToken: TOKEN }, 201),
      [`POST /v1/bookings/${BOOKING_ID}/payments`]: () => json(paymentSession, 201),
    });
    await renderWithApp(<CheckoutScreen />);
    expect(await screen.findByTestId('inhouse-tour')).toBeOnTheScreen();
    expect(screen.queryByTestId('passengers.0.passportNumber')).toBeNull();

    await fillTraveller();
    await fireEvent.press(screen.getByTestId('checkout-submit'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/trips/${BOOKING_ID}`));
    const create = calls.find((request) => request.url.endsWith('/v1/bookings'));
    const body = (await create?.json()) as { passengers: unknown[]; addonDetails?: unknown };
    expect(body.passengers).toHaveLength(1);
    expect(body).not.toHaveProperty('addonDetails');
  });
});
