import { createHmac, timingSafeEqual } from 'node:crypto';

import { SUPPORTED_CURRENCIES, money } from '@suskii/shared';
import { z } from 'zod';

import {
  PaymentProvider,
  WebhookSignatureError,
  headerValue,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentEvent,
  type PaymentRef,
  type PaymentVerification,
  type ProviderRefund,
  type RefundRequest,
  type WebhookHeaders,
} from '../payment-provider';
import { ProviderHttp } from '../provider-http';

export interface StripeOptions {
  secretKey: string;
  webhookSecret: string;
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Stripe accepts events signed at most this long ago (its SDK's default tolerance). */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
/** Stripe Checkout sessions live between 30 minutes and 24 hours. */
const MIN_SESSION_SECONDS = 31 * 60;
const MAX_SESSION_SECONDS = 23 * 3600;

const currency = z
  .string()
  .length(3)
  .transform((value) => value.toUpperCase());

const session = z.looseObject({
  id: z.string().startsWith('cs_'),
  url: z.url().nullish(),
  status: z.string().nullish(),
  payment_status: z.string(),
  amount_total: z.number().int().nullish(),
  currency: currency.nullish(),
  payment_intent: z.union([z.string(), z.looseObject({ id: z.string() })]).nullish(),
  payment_method_types: z.array(z.string()).nullish(),
});
const refund = z.looseObject({
  id: z.string().startsWith('re_'),
  status: z.string().nullish(),
  amount: z.number().int(),
  currency,
  payment_intent: z.string().nullish(),
  failure_reason: z.string().nullish(),
  metadata: z.record(z.string(), z.string()).nullish(),
});
const event = z.looseObject({
  id: z.string().startsWith('evt_'),
  type: z.string(),
  created: z.number().int(),
  data: z.looseObject({ object: z.unknown() }),
});

const intentId = (value: z.infer<typeof session>['payment_intent']): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null);

function refundStatus(status: string | null | undefined): ProviderRefund['status'] {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'canceled') return 'failed';
  return 'pending';
}

function toRefund(data: z.infer<typeof refund>): ProviderRefund {
  const status = refundStatus(data.status);
  return {
    providerRefundId: data.id,
    status,
    amount: money(BigInt(data.amount), data.currency),
    refundId: data.metadata?.suskii_refund_id ?? null,
    failureReason: status === 'failed' ? (data.failure_reason ?? 'provider_failed') : null,
  };
}

/**
 * Stripe Checkout for international cards (ADR-016). Events are signed with HMAC-SHA256 over
 * `{timestamp}.{body}` using the endpoint's secret and must be at most 5 minutes old; the signed
 * payload is authoritative, so no confirmation call is needed. Refunds carry our refund id as the
 * idempotency key, so an ambiguous failure can be retried safely.
 */
export class StripePaymentProvider extends PaymentProvider {
  readonly name = 'stripe' as const;
  readonly currencies = SUPPORTED_CURRENCIES;
  readonly methods = ['card'] as const;
  readonly idempotentRefunds = true;
  private readonly http: ProviderHttp;
  private readonly now: () => Date;

  constructor(private readonly options: StripeOptions) {
    super();
    this.http = new ProviderHttp({ provider: this.name, ...options });
    this.now = options.now ?? (() => new Date());
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const wanted = Math.floor(request.expiresAt.getTime() / 1000);
    // Our own deadline stays authoritative: a later success is refunded automatically.
    const expiresAt = Math.min(
      Math.max(wanted, nowSeconds + MIN_SESSION_SECONDS),
      nowSeconds + MAX_SESSION_SECONDS,
    );
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: request.returnUrl,
      cancel_url: request.returnUrl,
      client_reference_id: request.paymentId,
      customer_email: request.customerEmail,
      expires_at: String(expiresAt),
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': request.amount.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': request.amount.minor.toString(),
      'line_items[0][price_data][product_data][name]': `Suskii booking ${request.reference}`,
      'metadata[payment_id]': request.paymentId,
      'metadata[booking_reference]': request.reference,
      'payment_intent_data[metadata][payment_id]': request.paymentId,
    });
    const created = session.parse(
      await this.http.request({
        method: 'POST',
        path: '/v1/checkout/sessions',
        body: form,
        idempotencyKey: `checkout-${request.paymentId}`,
      }),
    );
    if (!created.url) throw new Error('Stripe returned a checkout session without a URL');
    return { providerReference: created.id, checkoutUrl: created.url };
  }

  parseWebhook(rawBody: Buffer, headers: WebhookHeaders): PaymentEvent | null {
    this.verifySignature(rawBody, headerValue(headers, 'stripe-signature') ?? '');
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureError('Webhook body is not JSON');
    }
    const parsed = event.parse(json);
    const occurredAt = new Date(parsed.created * 1000).toISOString();
    const base = {
      eventId: parsed.id,
      providerRefundId: null,
      refundId: null,
      method: null,
      occurredAt,
      failureReason: null,
    };
    switch (parsed.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const data = session.parse(parsed.data.object);
        // Delayed methods complete the session unpaid; their outcome follows as async_payment_*.
        if (parsed.type === 'checkout.session.completed' && data.payment_status !== 'paid')
          return null;
        const type: PaymentEvent['type'] =
          parsed.type === 'checkout.session.expired'
            ? 'checkout.expired'
            : parsed.type === 'checkout.session.async_payment_failed'
              ? 'payment.failed'
              : 'payment.succeeded';
        return {
          ...base,
          type,
          providerReference: data.id,
          providerTransactionId: intentId(data.payment_intent),
          amount:
            data.amount_total !== null && data.amount_total !== undefined && data.currency
              ? money(BigInt(data.amount_total), data.currency)
              : null,
          method: data.payment_method_types?.[0] ?? null,
          failureReason:
            type === 'payment.failed'
              ? 'payment_failed'
              : type === 'checkout.expired'
                ? 'expired'
                : null,
        };
      }
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed': {
        const data = toRefund(refund.parse(parsed.data.object));
        if (data.status === 'pending') return null;
        return {
          ...base,
          type: data.status === 'succeeded' ? 'refund.succeeded' : 'refund.failed',
          providerReference: null,
          providerTransactionId: refund.parse(parsed.data.object).payment_intent ?? null,
          providerRefundId: data.providerRefundId,
          refundId: data.refundId,
          amount: data.amount,
          failureReason: data.failureReason,
        };
      }
      default:
        return null;
    }
  }

  async verifyPayment(payment: PaymentRef): Promise<PaymentVerification> {
    const data = session.parse(
      await this.http.request({
        method: 'GET',
        path: `/v1/checkout/sessions/${encodeURIComponent(payment.providerReference)}`,
      }),
    );
    const status =
      data.status === 'complete' && data.payment_status === 'paid'
        ? 'succeeded'
        : data.status === 'expired'
          ? 'failed'
          : 'pending';
    return {
      status,
      amount:
        data.amount_total !== null && data.amount_total !== undefined && data.currency
          ? money(BigInt(data.amount_total), data.currency)
          : null,
      providerTransactionId: intentId(data.payment_intent),
      method: data.payment_method_types?.[0] ?? null,
      failureReason: status === 'failed' ? 'expired' : null,
    };
  }

  async refund(request: RefundRequest): Promise<ProviderRefund> {
    let paymentIntent = request.payment.providerTransactionId;
    paymentIntent ??= (await this.verifyPayment(request.payment)).providerTransactionId;
    if (!paymentIntent) throw new Error('Stripe payment has no payment intent to refund');
    const created = refund.parse(
      await this.http.request({
        method: 'POST',
        path: '/v1/refunds',
        body: new URLSearchParams({
          payment_intent: paymentIntent,
          amount: request.amount.minor.toString(),
          'metadata[suskii_refund_id]': request.refundId,
        }),
        idempotencyKey: `refund-${request.refundId}`,
      }),
    );
    return toRefund(created);
  }

  override async getRefund(providerRefundId: string): Promise<ProviderRefund | null> {
    return toRefund(
      refund.parse(
        await this.http.request({
          method: 'GET',
          path: `/v1/refunds/${encodeURIComponent(providerRefundId)}`,
        }),
      ),
    );
  }

  override async cancelCheckout(providerReference: string): Promise<void> {
    try {
      await this.http.request({
        method: 'POST',
        path: `/v1/checkout/sessions/${encodeURIComponent(providerReference)}/expire`,
      });
    } catch {
      // Best effort: a session that completed or already expired cannot be expired again.
    }
  }

  /** `t=<unix>,v1=<hex>[,v1=<hex>]` over `{t}.{raw body}`; any matching v1 within tolerance. */
  private verifySignature(rawBody: Buffer, header: string): void {
    const parts = header.split(',').map((item) => item.trim().split('='));
    const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
    const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
    if (!Number.isInteger(timestamp) || signatures.length === 0) throw new WebhookSignatureError();
    const age = Math.abs(this.now().getTime() / 1000 - timestamp);
    if (age > STRIPE_SIGNATURE_TOLERANCE_SECONDS)
      throw new WebhookSignatureError('Webhook timestamp is too old');
    const expected = Buffer.from(
      createHmac('sha256', this.options.webhookSecret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest('hex'),
      'utf8',
    );
    const matches = signatures.some((signature) => {
      const given = Buffer.from(signature, 'utf8');
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
    if (!matches) throw new WebhookSignatureError();
  }
}
