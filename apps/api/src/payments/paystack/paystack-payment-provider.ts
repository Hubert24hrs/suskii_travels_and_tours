import { createHmac, timingSafeEqual } from 'node:crypto';

import { money } from '@suskii/shared';
import { z } from 'zod';

import {
  PaymentProvider,
  PaymentProviderUnavailableError,
  WebhookSignatureError,
  WebhookVerificationError,
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

export interface PaystackOptions {
  secretKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const minor = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform(BigInt);
const currency = z
  .string()
  .length(3)
  .transform((value) => value.toUpperCase());
const id = z.union([z.number().int(), z.string().min(1)]).transform(String);

const envelope = <T extends z.ZodType>(data: T) => z.looseObject({ status: z.literal(true), data });

const initializeResponse = envelope(
  z.looseObject({ authorization_url: z.url(), reference: z.string().min(1) }),
);
const transaction = z.looseObject({
  id,
  status: z.string(),
  reference: z.string(),
  amount: minor,
  currency,
  channel: z.string().nullish(),
  gateway_response: z.string().nullish(),
});
const refund = z.looseObject({
  id,
  status: z.string(),
  amount: minor.nullish(),
  currency: currency.nullish(),
  merchant_note: z.string().nullish(),
});
const chargeEvent = z.looseObject({
  event: z.literal('charge.success'),
  data: transaction.extend({ paid_at: z.string().nullish() }),
});
const refundEvent = z.looseObject({
  event: z.enum(['refund.processed', 'refund.failed']),
  data: z.looseObject({
    id: id.nullish(),
    status: z.string().nullish(),
    transaction_reference: z.string().nullish(),
    refund_reference: z.string().nullish(),
    amount: minor.nullish(),
    currency: currency.nullish(),
  }),
});

const PENDING = new Set(['ongoing', 'pending', 'processing', 'queued', 'abandoned']);
const refundNote = (refundId: string) => `suskii-refund:${refundId}`;

function refundStatus(status: string): ProviderRefund['status'] {
  if (status === 'processed') return 'succeeded';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function toRefund(data: z.infer<typeof refund>): ProviderRefund {
  const note = data.merchant_note ?? '';
  return {
    providerRefundId: data.id,
    status: refundStatus(data.status),
    amount:
      data.amount !== null && data.amount !== undefined && data.currency
        ? money(data.amount, data.currency)
        : null,
    refundId: note.startsWith('suskii-refund:') ? note.slice('suskii-refund:'.length) : null,
    failureReason: data.status === 'failed' ? 'provider_failed' : null,
  };
}

/**
 * Paystack (NGN, GHS, ZAR, KES, USD; cards, bank transfer, USSD), ADR-016. Webhooks are signed
 * with HMAC-SHA512 of the raw body using the secret key; successes are confirmed with
 * `GET /transaction/verify/:reference` before they are applied. Amounts are in subunits.
 */
export class PaystackPaymentProvider extends PaymentProvider {
  readonly name = 'paystack' as const;
  readonly currencies = ['NGN', 'GHS', 'ZAR', 'KES', 'USD'] as const;
  readonly methods = ['card', 'bank_transfer', 'ussd'] as const;
  readonly idempotentRefunds = false;
  private readonly http: ProviderHttp;

  constructor(private readonly options: PaystackOptions) {
    super();
    this.http = new ProviderHttp({ provider: this.name, ...options });
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const response = initializeResponse.parse(
      await this.http.request({
        method: 'POST',
        path: '/transaction/initialize',
        body: {
          email: request.customerEmail,
          amount: request.amount.minor.toString(),
          currency: request.amount.currency,
          // Our payment id doubles as the transaction reference (letters, digits and dashes).
          reference: request.paymentId,
          callback_url: request.returnUrl,
          metadata: {
            payment_id: request.paymentId,
            booking_reference: request.reference,
            cancel_action: request.returnUrl,
          },
        },
      }),
    );
    return {
      providerReference: response.data.reference,
      checkoutUrl: response.data.authorization_url,
    };
  }

  parseWebhook(rawBody: Buffer, headers: WebhookHeaders): PaymentEvent | null {
    const signature = headerValue(headers, 'x-paystack-signature') ?? '';
    const expected = createHmac('sha512', this.options.secretKey).update(rawBody).digest('hex');
    const given = Buffer.from(signature, 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new WebhookSignatureError();
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureError('Webhook body is not JSON');
    }
    const charge = chargeEvent.safeParse(json);
    if (charge.success) {
      const data = charge.data.data;
      if (data.status !== 'success') return null;
      return {
        eventId: `charge.success:${data.id}`,
        type: 'payment.succeeded',
        providerReference: data.reference,
        providerTransactionId: data.id,
        providerRefundId: null,
        refundId: null,
        amount: money(data.amount, data.currency),
        method: data.channel ?? null,
        occurredAt: data.paid_at ? new Date(data.paid_at).toISOString() : new Date().toISOString(),
        failureReason: null,
      };
    }
    const refunded = refundEvent.safeParse(json);
    if (refunded.success) {
      const { event, data } = refunded.data;
      const providerRefundId = data.id ?? data.refund_reference ?? null;
      return {
        eventId: `${event}:${providerRefundId ?? `${data.transaction_reference ?? ''}:${data.amount ?? ''}`}`,
        type: event === 'refund.processed' ? 'refund.succeeded' : 'refund.failed',
        providerReference: data.transaction_reference ?? null,
        providerTransactionId: null,
        providerRefundId,
        refundId: null,
        amount:
          data.amount !== null && data.amount !== undefined && data.currency
            ? money(data.amount, data.currency)
            : null,
        method: null,
        occurredAt: new Date().toISOString(),
        failureReason: event === 'refund.failed' ? 'provider_failed' : null,
      };
    }
    return null;
  }

  /** A success must match Paystack's own record of the transaction (ADR-016). */
  override async confirm(event: PaymentEvent): Promise<PaymentEvent> {
    if (event.type !== 'payment.succeeded' || !event.providerReference || !event.amount)
      return event;
    const verified = await this.fetchTransaction(event.providerReference);
    if (
      verified?.status !== 'success' ||
      verified.amount !== event.amount.minor ||
      verified.currency !== event.amount.currency
    ) {
      throw new WebhookVerificationError();
    }
    return event;
  }

  async verifyPayment(payment: PaymentRef): Promise<PaymentVerification> {
    const data = await this.fetchTransaction(payment.providerReference);
    if (!data) {
      return {
        status: 'pending',
        amount: null,
        providerTransactionId: null,
        method: null,
        failureReason: null,
      };
    }
    const status =
      data.status === 'success' ? 'succeeded' : PENDING.has(data.status) ? 'pending' : 'failed';
    return {
      status,
      amount: money(data.amount, data.currency),
      providerTransactionId: data.id,
      method: data.channel ?? null,
      failureReason: status === 'failed' ? 'provider_failed' : null,
    };
  }

  async refund(request: RefundRequest): Promise<ProviderRefund> {
    const response = envelope(refund).parse(
      await this.http.request({
        method: 'POST',
        path: '/refund',
        body: {
          transaction: request.payment.providerTransactionId ?? request.payment.providerReference,
          amount: request.amount.minor.toString(),
          currency: request.amount.currency,
          merchant_note: refundNote(request.refundId),
        },
      }),
    );
    return { ...toRefund(response.data), refundId: request.refundId };
  }

  override async getRefund(providerRefundId: string): Promise<ProviderRefund | null> {
    const response = envelope(refund).parse(
      await this.http.request({
        method: 'GET',
        path: `/refund/${encodeURIComponent(providerRefundId)}`,
      }),
    );
    return toRefund(response.data);
  }

  override async listRefunds(payment: PaymentRef): Promise<ProviderRefund[] | null> {
    const transactionId =
      payment.providerTransactionId ?? (await this.fetchTransaction(payment.providerReference))?.id;
    if (!transactionId) return [];
    const response = envelope(z.array(refund)).parse(
      await this.http.request({
        method: 'GET',
        path: `/refund?transaction=${encodeURIComponent(transactionId)}`,
      }),
    );
    return response.data.map(toRefund);
  }

  /** Paystack's record of a transaction, or null when it does not know the reference yet. */
  private async fetchTransaction(reference: string): Promise<z.infer<typeof transaction> | null> {
    try {
      const response = envelope(transaction).parse(
        await this.http.request({
          method: 'GET',
          path: `/transaction/verify/${encodeURIComponent(reference)}`,
        }),
      );
      return response.data;
    } catch (error) {
      if (error instanceof PaymentProviderUnavailableError) throw error;
      if (error instanceof z.ZodError)
        throw new PaymentProviderUnavailableError(this.name, 'Unexpected verify response');
      // 4xx: Paystack does not know this reference (the traveller never opened the checkout).
      return null;
    }
  }
}
