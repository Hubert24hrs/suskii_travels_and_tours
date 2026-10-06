import type { Money, PaymentProviderName } from '@suskii/shared';

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

export type PaymentEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'checkout.expired'
  | 'refund.succeeded'
  | 'refund.failed';

/** A verified provider webhook, normalised. Never contains card data. */
export interface PaymentEvent {
  /** Unique per provider: events are processed once per id. */
  eventId: string;
  type: PaymentEventType;
  /** Our payment's provider reference (payment events, and refund events when known). */
  providerReference: string | null;
  /** The provider's id for the charge. */
  providerTransactionId: string | null;
  /** Refund events: the provider's refund id, and ours when the provider echoes it back. */
  providerRefundId: string | null;
  refundId: string | null;
  amount: Money | null;
  /** Payment channel (card, bank_transfer, ussd, mobile_money); never card details. */
  method: string | null;
  occurredAt: string;
  failureReason: string | null;
  /**
   * Card payments, when the provider reports them (ADR-040): issuing country and an opaque id
   * that is the same for the same card. Never card numbers; adapters hash anything derived from
   * them.
   */
  card?: PaymentCard | null;
}

export interface PaymentCard {
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
  fingerprint: string | null;
}

/** Normalises what a provider says about a card; null when it says nothing useful. */
export function paymentCard(country: unknown, fingerprint: unknown): PaymentCard | null {
  const code =
    typeof country === 'string' ? (/(?:^|\s)([A-Z]{2})$/.exec(country.trim())?.[1] ?? null) : null;
  const id = typeof fingerprint === 'string' && fingerprint.length > 0 ? fingerprint : null;
  if (!code && !id) return null;
  return { country: code, fingerprint: id };
}

export interface PaymentVerification {
  status: 'succeeded' | 'failed' | 'pending';
  amount: Money | null;
  providerTransactionId: string | null;
  method: string | null;
  failureReason: string | null;
}

export interface PaymentRef {
  providerReference: string;
  providerTransactionId: string | null;
  amount: Money;
}

export interface RefundRequest {
  /** Our refund id: idempotency key where the provider supports one, and a note otherwise. */
  refundId: string;
  payment: PaymentRef;
  amount: Money;
}

export interface ProviderRefund {
  providerRefundId: string;
  status: 'succeeded' | 'pending' | 'failed';
  amount: Money | null;
  /** Our refund id, when the provider stores it with the refund. */
  refundId: string | null;
  failureReason: string | null;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export type PaymentMethod = 'card' | 'bank_transfer' | 'ussd' | 'mobile_money';

export class WebhookSignatureError extends Error {
  constructor(message = 'Webhook signature is missing or invalid') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/** The provider's own records contradict a webhook: never applied (ADR-016). */
export class WebhookVerificationError extends Error {
  constructor(message = 'The provider did not confirm this event') {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

/** Base of every error a provider call can raise. Messages never contain payloads or PII. */
export class PaymentProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The provider rejected the request (4xx): nothing happened, retrying the same call will not help. */
export class PaymentProviderRequestError extends PaymentProviderError {}

/**
 * The call failed on the way (network error, 5xx, rate limit) or timed out. For a write this is
 * ambiguous: the provider may have acted on it.
 */
export class PaymentProviderUnavailableError extends PaymentProviderError {}

/**
 * A hosted-checkout payment provider (SAQ-A: card data never touches Suskii; ADR-016).
 * Implementations honour their timeouts and throw `PaymentProviderError` subclasses.
 */
export abstract class PaymentProvider {
  abstract readonly name: PaymentProviderName;
  /** Currencies this provider settles. */
  abstract readonly currencies: readonly string[];
  /** What the traveller can pay with on the hosted page, for the checkout's labels. */
  abstract readonly methods: readonly PaymentMethod[];
  /** Whether repeating `refund()` with the same refund id is safe after an ambiguous failure. */
  abstract readonly idempotentRefunds: boolean;

  abstract createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;

  /**
   * Verifies the signature over the exact raw body and normalises the event; null for event
   * types we do not act on. Throws `WebhookSignatureError` for a bad signature.
   */
  abstract parseWebhook(rawBody: Buffer, headers: WebhookHeaders): PaymentEvent | null;

  /**
   * Server-to-server confirmation before an event is applied. Throws `WebhookVerificationError`
   * when the provider's records disagree. The default trusts signed events.
   */
  confirm(event: PaymentEvent): Promise<PaymentEvent> {
    return Promise.resolve(event);
  }

  /** Asks the provider what happened to a payment (reconciliation of lost webhooks). */
  abstract verifyPayment(payment: PaymentRef): Promise<PaymentVerification>;

  abstract refund(request: RefundRequest): Promise<ProviderRefund>;

  /** Current state of a refund; null when the provider has no lookup. */
  getRefund(_providerRefundId: string, _payment: PaymentRef): Promise<ProviderRefund | null> {
    return Promise.resolve(null);
  }

  /** Refunds recorded against a charge; null when the provider cannot list them. */
  listRefunds(_payment: PaymentRef): Promise<ProviderRefund[] | null> {
    return Promise.resolve(null);
  }

  /** Closes an unpaid checkout early where the provider allows it (best effort). */
  cancelCheckout(_providerReference: string): Promise<void> {
    return Promise.resolve();
  }
}

export function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
