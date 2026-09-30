import type { Schemas } from '@suskii/api-client';
import * as WebBrowser from 'expo-web-browser';

import { json, mockApi } from '../test/app';
import { BOOKING_ID, booking } from '../test/fixtures';

import { createBareApi } from './api';
import { openHostedCheckout, startPayment } from './payment';

// A development build: mock device attestation.
jest.mock('../config', () => ({
  appConfig: { apiBaseUrl: 'http://api.test', attestation: 'mock', playIntegrityProject: '' },
  CLIENT_ID: 'mobile-ios/0.1.0',
}));

const PAYMENTS = `POST /v1/bookings/${BOOKING_ID}/payments`;
const CHALLENGE = {
  'POST /v1/attestation/challenges': () =>
    json({ challenge: 'challenge-1', expiresAt: '2026-01-01T00:00:00Z' }, 201),
};
const session = (
  status: Schemas['PaymentSession']['status'],
  checkoutUrl: string | null,
): Schemas['PaymentSession'] => ({
  paymentId: '0192d3a0-7c1e-7b2a-9f00-0000000000a1',
  status,
  checkoutUrl,
  amount: { amountMinor: 8_500_000, currency: 'NGN' },
  expiresAt: '2026-10-01T10:00:00.000Z',
});
const problem = (slug: string, status: number, extra: object = {}) =>
  json({ type: `urn:suskii:problem:${slug}`, title: slug, status, ...extra }, status);

describe('startPayment', () => {
  it('opens the hosted checkout with a fresh idempotency key and the device attestation', async () => {
    const { calls } = mockApi({
      ...CHALLENGE,
      [PAYMENTS]: () => json(session('pending', 'https://pay.example/c/1'), 201),
    });
    const api = createBareApi();
    const headers = { 'X-Booking-Token': 'guest-token' };

    const first = await startPayment(api, BOOKING_ID, headers, { provider: 'mock' });
    await startPayment(api, BOOKING_ID, headers, { provider: 'mock' });

    expect(first).toEqual({ kind: 'redirect', checkoutUrl: 'https://pay.example/c/1' });
    const payments = calls.filter((request) => request.url.endsWith('/payments'));
    const [one, two] = payments.map((request) => request.headers);
    expect(one?.get('X-Booking-Token')).toBe('guest-token');
    expect(one?.get('X-Suskii-Attestation')).toBeTruthy();
    expect(one?.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(two?.get('Idempotency-Key')).not.toBe(one?.get('Idempotency-Key'));
  });

  it('reports a price change with the new total for consent', async () => {
    const change = {
      previous: { amountMinor: 8_500_000, currency: 'NGN' },
      current: { amountMinor: 9_100_000, currency: 'NGN' },
      difference: { amountMinor: 600_000, currency: 'NGN' },
      price: booking().price,
    };
    mockApi({
      ...CHALLENGE,
      [PAYMENTS]: () => problem('price-changed', 409, { priceChange: change }),
    });
    expect(await startPayment(createBareApi(), BOOKING_ID, {}, {})).toEqual({
      kind: 'price-changed',
      change,
    });
  });

  it.each([
    ['offer-expired', 410, 'expired'],
    ['payment-provider-unavailable', 503, 'provider-unavailable'],
    ['attestation-required', 403, 'device'],
    ['internal', 500, 'error'],
  ] as const)('maps %s (%i) to %s', async (slug, status, kind) => {
    mockApi({ ...CHALLENGE, [PAYMENTS]: () => problem(slug, status) });
    expect(await startPayment(createBareApi(), BOOKING_ID, {}, {})).toEqual({ kind });
  });

  it('still pays when the device cannot attest (the API decides)', async () => {
    const { calls } = mockApi({
      'POST /v1/attestation/challenges': () => problem('rate-limited', 429),
      [PAYMENTS]: () => json(session('succeeded', null), 201),
    });
    expect(await startPayment(createBareApi(), BOOKING_ID, {}, { useWallet: true })).toEqual({
      kind: 'paid',
    });
    expect(calls.at(-1)?.headers.get('X-Suskii-Attestation')).toBeNull();
  });

  it('treats a lost connection as an error the traveller can retry', async () => {
    mockApi({
      ...CHALLENGE,
      [PAYMENTS]: () => {
        throw new TypeError('Network request failed');
      },
    });
    expect(await startPayment(createBareApi(), BOOKING_ID, {}, {})).toEqual({ kind: 'error' });
  });
});

describe('openHostedCheckout', () => {
  it('uses the system browser session and returns to the app scheme', async () => {
    await openHostedCheckout('https://pay.example/c/1');
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://pay.example/c/1',
      'suskii://trips',
      { showInRecents: true },
    );
  });
});
