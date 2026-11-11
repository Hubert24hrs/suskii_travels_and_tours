import { getMessages } from '@suskii/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

import { json, mockApi, renderWithApp, signedInSession } from '../test/app';
import {
  BOOKING_ID,
  PRICE_REQUEST_ID,
  QUOTE_ID,
  offeredPriceRequest,
  priceRequest,
} from '../test/fixtures';

import { PriceRequestScreen, PriceRequestsScreen } from './price-requests-screen';

jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-android/0.1.0',
}));

const m = getMessages('en-NG');
const params = useLocalSearchParams as jest.Mock;
const notFound = () =>
  json({ type: 'urn:suskii:problem:not-found', title: 'Not found', status: 404 }, 404);

afterEach(() => {
  params.mockReturnValue({});
  jest.mocked(router.push).mockClear();
});

describe('PriceRequestsScreen', () => {
  it('asks a guest to sign in, and reads nothing', async () => {
    const { calls } = mockApi({});
    await renderWithApp(<PriceRequestsScreen />);

    expect(await screen.findByTestId('account-required')).toBeOnTheScreen();
    expect(calls).toHaveLength(0);
  });

  it('lists the account’s requests with where each stands, and opens one', async () => {
    mockApi({
      'GET /v1/me/assisted-quotes': () =>
        json({
          quotes: [
            offeredPriceRequest(),
            priceRequest({
              id: '0192d3a0-7c1e-7b2a-9f00-00000000d402',
              reference: 'Q-9P3N5Z',
              title: 'Airport transfer for six',
            }),
          ],
        }),
    });
    await renderWithApp(<PriceRequestsScreen />, await signedInSession());

    expect(await screen.findByText('Lagoon View Hotel, sea view room')).toBeOnTheScreen();
    expect(screen.getByText(m.quotes.statuses.offered)).toBeOnTheScreen();
    expect(screen.getByText(m.quotes.statuses.requested)).toBeOnTheScreen();
    // The offer's total is the API's money, formatted; nothing is computed here.
    expect(screen.getByText(/185,000/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId(`quote-${PRICE_REQUEST_ID}`));
    expect(router.push).toHaveBeenCalledWith(`/account/quotes/${PRICE_REQUEST_ID}`);
  });

  it('refuses contact details before anything is sent, then sends places, dates and counts', async () => {
    let listed = 0;
    const { calls } = mockApi({
      'GET /v1/me/assisted-quotes': () => {
        listed += 1;
        return json({ quotes: listed > 1 ? [priceRequest()] : [] });
      },
      'POST /v1/quotes/assisted': () => json(priceRequest(), 201),
    });
    await renderWithApp(<PriceRequestsScreen />, await signedInSession());
    expect(await screen.findByText(m.quotes.empty)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('quote-product-hotel'));
    await fireEvent.changeText(
      screen.getByTestId('quote-what'),
      'Lagoon View Hotel, call me on 0803 000 0000',
    );
    await fireEvent.changeText(screen.getByTestId('quote-destination'), 'Lagos');
    await fireEvent.press(screen.getByTestId('quote-start'));
    await fireEvent.press(await screen.findByTestId('quote-start-day-2026-12-12'));
    await fireEvent.press(screen.getByTestId('quote-start-done'));
    await fireEvent.press(screen.getByTestId('quote-ask-submit'));

    expect(await screen.findByTestId('quote-ask-error')).toHaveTextContent(m.quotes.errors.contact);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await fireEvent.changeText(screen.getByTestId('quote-what'), 'Lagoon View Hotel, sea view');
    await fireEvent.press(screen.getByTestId('quote-ask-submit'));

    expect(await screen.findByTestId('quote-ask-sent')).toBeOnTheScreen();
    const asked = calls.find((call) => call.method === 'POST');
    expect(asked?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await asked?.json()).toEqual({
      product: 'hotel',
      title: 'Lagoon View Hotel, sea view',
      request: {
        origin: null,
        destination: 'Lagos',
        startDate: '2026-12-12',
        endDate: null,
        adults: 2,
        children: 0,
      },
      currency: 'NGN',
      observationId: null,
    });
    // The new request shows without leaving the screen.
    expect(await screen.findByTestId(`quote-${PRICE_REQUEST_ID}`)).toBeOnTheScreen();
  });

  it('says so while price requests are switched off, and offers no form', async () => {
    mockApi({ 'GET /v1/me/assisted-quotes': notFound });
    await renderWithApp(<PriceRequestsScreen />, await signedInSession());

    expect(await screen.findByTestId('quotes-off')).toBeOnTheScreen();
    expect(screen.queryByTestId('quote-ask')).toBeNull();
  });

  it('says when five requests are already open', async () => {
    mockApi({
      'GET /v1/me/assisted-quotes': () => json({ quotes: [] }),
      'POST /v1/quotes/assisted': () =>
        json(
          {
            type: 'urn:suskii:problem:assisted-quote-limit',
            title: 'Too many open requests',
            status: 409,
          },
          409,
        ),
    });
    await renderWithApp(<PriceRequestsScreen />, await signedInSession());
    await screen.findByText(m.quotes.empty);

    await fireEvent.changeText(screen.getByTestId('quote-what'), 'Airport transfer for six');
    await fireEvent.changeText(screen.getByTestId('quote-destination'), 'Abuja');
    await fireEvent.press(screen.getByTestId('quote-start'));
    await fireEvent.press(await screen.findByTestId('quote-start-day-2026-12-12'));
    await fireEvent.press(screen.getByTestId('quote-start-done'));
    await fireEvent.press(screen.getByTestId('quote-ask-submit'));

    expect(await screen.findByTestId('quote-ask-error')).toHaveTextContent(m.quotes.errors.limit);
  });
});

describe('PriceRequestScreen', () => {
  beforeEach(() => {
    params.mockReturnValue({ id: PRICE_REQUEST_ID });
  });

  it('shows a waiting request with when it is answered by, and withdraws it', async () => {
    const { calls } = mockApi({
      [`GET /v1/quotes/assisted/${PRICE_REQUEST_ID}`]: () => json(priceRequest()),
      [`POST /v1/quotes/assisted/${PRICE_REQUEST_ID}/withdraw`]: () =>
        json(priceRequest({ status: 'withdrawn' })),
    });
    await renderWithApp(<PriceRequestScreen />, await signedInSession());

    expect(await screen.findByTestId('quote-status')).toHaveTextContent(
      m.quotes.statuses.requested,
    );
    expect(screen.queryByTestId('quote-offer')).toBeNull();
    await fireEvent.press(screen.getByTestId('quote-withdraw'));

    await waitFor(() =>
      expect(screen.getByTestId('quote-status')).toHaveTextContent(m.quotes.statuses.withdrawn),
    );
    expect(screen.queryByTestId('quote-withdraw')).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('shows a verified offer with its terms and total, and books it through the checkout', async () => {
    mockApi({
      [`GET /v1/quotes/assisted/${PRICE_REQUEST_ID}`]: () => json(offeredPriceRequest()),
    });
    await renderWithApp(<PriceRequestScreen />, await signedInSession());

    expect(await screen.findByTestId('quote-total')).toHaveTextContent(/185,000/);
    expect(screen.getByText(m.quotes.offer.verified)).toBeOnTheScreen();
    expect(screen.getByText(m.quotes.offer.refundable)).toBeOnTheScreen();
    expect(screen.getByText(m.quotes.offer.afterPayment)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('quote-book'));
    expect(router.push).toHaveBeenCalledWith(`/checkout/${QUOTE_ID}`);
  });

  it('hands the request to the share sheet as a PDF, and keeps no copy on the phone', async () => {
    mockApi({
      [`GET /v1/quotes/assisted/${PRICE_REQUEST_ID}`]: () => json(offeredPriceRequest()),
    });
    const shared = jest.mocked(shareAsync);
    const downloaded = jest.mocked(File.downloadFileAsync);
    shared.mockClear();
    downloaded.mockClear();
    await renderWithApp(<PriceRequestScreen />, await signedInSession());

    await fireEvent.press(await screen.findByTestId('quote-pdf'));
    await waitFor(() => expect(shared).toHaveBeenCalledTimes(1));
    // Read from the API's own route with the account's session, as the app's own client.
    const [url, destination, options] = downloaded.mock.calls[0] ?? [];
    expect(url).toBe(`http://api.test/v1/quotes/assisted/${PRICE_REQUEST_ID}/pdf`);
    expect((destination as File).uri).toBe('file:///data/cache/suskii-price-request-Q-7K2M4X.pdf');
    expect(options).toMatchObject({
      headers: { Authorization: 'Bearer access-token', 'X-Suskii-Client': 'mobile-android/0.1.0' },
    });
    expect(shared).toHaveBeenCalledWith(
      'file:///data/cache/suskii-price-request-Q-7K2M4X.pdf',
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );
    // The cache copy goes once the sheet has closed.
    await waitFor(() =>
      expect(new File('file:///data/cache/suskii-price-request-Q-7K2M4X.pdf').exists).toBe(false),
    );
  });

  it('says why a request closed, and links a booked one to its trip', async () => {
    mockApi({
      [`GET /v1/quotes/assisted/${PRICE_REQUEST_ID}`]: () =>
        json({ ...offeredPriceRequest(), status: 'booked', bookingId: BOOKING_ID }),
    });
    const view = await renderWithApp(<PriceRequestScreen />, await signedInSession());

    // A booked offer is no longer on offer: no button books it twice.
    expect(await screen.findByTestId('quote-booking')).toBeOnTheScreen();
    expect(screen.queryByTestId('quote-book')).toBeNull();
    await fireEvent.press(screen.getByTestId('quote-booking'));
    expect(router.push).toHaveBeenCalledWith(`/trips/${BOOKING_ID}`);
    view.unmount();

    mockApi({
      [`GET /v1/quotes/assisted/${PRICE_REQUEST_ID}`]: () =>
        json(priceRequest({ status: 'unavailable', closedReason: 'sold_out' })),
    });
    await renderWithApp(<PriceRequestScreen />, await signedInSession());
    expect(await screen.findByTestId('quote-closed')).toHaveTextContent(m.quotes.closed.sold_out);
  });

  it('shows another account’s request as not there', async () => {
    mockApi({ [`GET /v1/quotes/assisted/${PRICE_REQUEST_ID}`]: notFound });
    await renderWithApp(<PriceRequestScreen />, await signedInSession());

    expect(await screen.findByTestId('quote-missing')).toBeOnTheScreen();
  });
});
