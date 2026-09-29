import type { Money } from '@suskii/shared';

export interface CheckoutRequest {
  paymentId: string;
  /** Shown on the checkout page and statements: the booking reference. */
  reference: string;
  amount: Money;
  customerEmail: string;
  /** Where the traveller lands afterwards. The outcome itself only ever comes by webhook. */
  returnUrl: string;
  expiresAt: Date;
}

export interface CheckoutSession {
  providerReference: string;
  checkoutUrl: string;
}

export type PaymentEventType = 'payment.succeeded' | 'payment.failed';

/** A verified provider webhook, normalised. Never contains card data. */
export interface PaymentEvent {
  /** The provider's event id: events are processed once per id. */
  eventId: string;
  type: PaymentEventType;
  providerReference: string;
  amount: Money;
  occurredAt: string;
  failureReason: string | null;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export class WebhookSignatureError extends Error {
  constructor(message = 'Webhook signature is missing or invalid') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * Hosted-checkout payment provider (SAQ-A: card data never touches Suskii). Mock now; Paystack,
 * Flutterwave and Stripe adapters in phase 6 (ADR-014).
 */
export abstract class PaymentProvider {
  abstract readonly name: string;
  abstract createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies the signature over the exact raw body and normalises the event. */
  abstract parseWebhook(rawBody: Buffer, headers: WebhookHeaders): PaymentEvent;
}
