import { randomUUID } from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

import type { ApiClient, Schemas } from './api';
import { problemSlug } from './api';
import { attestationHeader } from './attestation';

export type PaymentStart =
  | { kind: 'redirect'; checkoutUrl: string }
  | { kind: 'paid' }
  | { kind: 'price-changed'; change: Schemas['BookingPriceChange'] }
  | { kind: 'expired' }
  | { kind: 'provider-unavailable' }
  | { kind: 'device' }
  | { kind: 'error' };

/**
 * Starts a payment (ADR-021): the API re-prices first, then opens a hosted checkout. The device
 * attestation is attached for ATTESTATION_MODE=enforce; a fresh idempotency key goes with it.
 */
export async function startPayment(
  api: ApiClient,
  bookingId: string,
  headers: Record<string, string>,
  body: Schemas['StartPaymentRequestInput'],
): Promise<PaymentStart> {
  try {
    const attestation = await attestationHeader(api);
    const { data, error, response } = await api.POST('/v1/bookings/{bookingId}/payments', {
      params: {
        path: { bookingId },
        header: {
          ...headers,
          'Idempotency-Key': randomUUID(),
          ...(attestation ? { 'X-Suskii-Attestation': attestation } : {}),
        },
      },
      body,
    });
    if (data)
      return data.checkoutUrl
        ? { kind: 'redirect', checkoutUrl: data.checkoutUrl }
        : { kind: 'paid' };
    const slug = problemSlug(error);
    if (slug === 'price-changed') {
      const change = (error as { priceChange?: Schemas['BookingPriceChange'] }).priceChange;
      return change ? { kind: 'price-changed', change } : { kind: 'error' };
    }
    if (response.status === 410) return { kind: 'expired' };
    if (slug === 'payment-provider-unavailable') return { kind: 'provider-unavailable' };
    if (slug === 'attestation-required') return { kind: 'device' };
    return { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * The provider's hosted page in the system browser sheet (never a WebView). It returns when the
 * return page hands control back (`suskii://trips/...`) or the traveller closes it; either way
 * the booking screen polls the outcome, which the webhook decides.
 */
export async function openHostedCheckout(checkoutUrl: string): Promise<void> {
  await WebBrowser.openAuthSessionAsync(checkoutUrl, 'suskii://trips', { showInRecents: true });
}
