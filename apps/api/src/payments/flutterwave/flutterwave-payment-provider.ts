import { createHash, timingSafeEqual } from 'node:crypto';

import { parseMoney, toDecimalString, type Money } from '@suskii/shared';
import { z } from 'zod';

import {
  PaymentProvider,
  PaymentProviderUnavailableError,
  WebhookSignatureError,
  WebhookVerificationError,
  headerValue,
  paymentCard,
  type CheckoutRequest,
  type PaymentCard,
  type CheckoutSession,
  type PaymentEvent,
  type PaymentRef,
  type PaymentVerification,
  type ProviderRefund,
  type RefundRequest,
  type WebhookHeaders,
} from '../payment-provider';
import { ProviderHttp } from '../provider-http';

export interface FlutterwaveOptions {
  secretKey: string;
  webhookHash: string;
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/** Major-unit amounts arrive as JSON numbers or strings; kept as their exact decimal text. */
const decimal = z
  .union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d+)?$/)])
  .transform(String);
const currency = z
  .string()
  .length(3)
  .transform((value) => value.toUpperCase());
const id = z.union([z.number().int(), z.string().min(1)]).transform(String);

const envelope = <T extends z.ZodType>(data: T) =>
  z.looseObject({ status: z.literal('success'), data });

const transaction = z.looseObject({
  id,
  tx_ref: z.string(),
  amount: decimal,
  currency,
  status: z.string(),
  payment_type: z.string().nullish(),
  created_at: z.string().nullish(),
  card: z
    .looseObject({
      first_6digits: z.string().nullish(),
      last_4digits: z.string().nullish(),
      expiry: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
});
const chargeEvent = z.looseObject({ event: z.literal('charge.completed'), data: transaction });
const refundData = z.looseObject({ id, status: z.string(), amount_refunded: decimal.nullish() });

/**
 * Flutterwave sends no card token in webhooks, so the card is identified by a hash of its
 * truncated number and expiry; the digits themselves never leave this adapter (ADR-040).
 */
function cardOf(card: z.infer<typeof transaction>['card']): PaymentCard | null {
  if (!card) return null;
  const { first_6digits: bin, last_4digits: last4, expiry } = card;
  const fingerprint =
    bin && last4 && expiry
      ? createHash('sha256').update(`flutterwave:${bin}:${last4}:${expiry}`).digest('hex')
      : null;
  return paymentCard(card.country, fingerprint);
}

/** Flutterwave names payment channels its own way; normalised to ours. */
function method(paymentType: string | null | undefined): string | null {
  if (!paymentType) return null;
  if (paymentType === 'card') return 'card';
  if (paymentType === 'ussd') return 'ussd';
  if (paymentType.includes('bank') || paymentType === 'account') return 'bank_transfer';
  if (paymentType.includes('mobilemoney') || paymentType.includes('mpesa')) return 'mobile_money';
  return paymentType;
}

const amountOf = (value: string, code: string): Money => parseMoney(value, code);

/**
 * Flutterwave v3 standard checkout (ADR-016). The webhook's `verif-hash` is a static shared
 * secret, so every outcome is confirmed with `GET /v3/transactions/:id/verify` before it is
 * applied. Amounts are major units on the wire and converted exactly (no floats).
 */
export class FlutterwavePaymentProvider extends PaymentProvider {
  readonly name = 'flutterwave' as const;
  readonly currencies = ['NGN', 'GHS', 'KES', 'ZAR', 'USD', 'EUR', 'GBP'] as const;
  readonly methods = ['card', 'bank_transfer', 'ussd', 'mobile_money'] as const;
  readonly idempotentRefunds = false;
  private readonly http: ProviderHttp;

  constructor(private readonly options: FlutterwaveOptions) {
    super();
    this.http = new ProviderHttp({ provider: this.name, ...options });
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const minutes = Math.ceil((request.expiresAt.getTime() - Date.now()) / 60_000);
    const response = envelope(z.looseObject({ link: z.url() })).parse(
      await this.http.request({
        method: 'POST',
        path: '/v3/payments',
        body: {
          tx_ref: request.paymentId,
          amount: toDecimalString(request.amount),
          currency: request.amount.currency,
          redirect_url: request.returnUrl,
          customer: { email: request.customerEmail },
          customizations: { title: 'Suskii Travels', description: `Booking ${request.reference}` },
          meta: { payment_id: request.paymentId, booking_reference: request.reference },
          session_duration: Math.min(1440, Math.max(1, minutes)),
        },
      }),
    );
    return { providerReference: request.paymentId, checkoutUrl: response.data.link };
  }

  parseWebhook(rawBody: Buffer, headers: WebhookHeaders): PaymentEvent | null {
    const given = Buffer.from(headerValue(headers, 'verif-hash') ?? '', 'utf8');
    const wanted = Buffer.from(this.options.webhookHash, 'utf8');
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new WebhookSignatureError();
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureError('Webhook body is not JSON');
    }
    const parsed = chargeEvent.safeParse(json);
    if (!parsed.success) return null;
    const data = parsed.data.data;
    const succeeded = data.status === 'successful';
    if (!succeeded && data.status !== 'failed') return null;
    return {
      eventId: `charge.completed:${data.id}:${data.status}`,
      type: succeeded ? 'payment.succeeded' : 'payment.failed',
      providerReference: data.tx_ref,
      providerTransactionId: data.id,
      providerRefundId: null,
      refundId: null,
      amount: amountOf(data.amount, data.currency),
      method: method(data.payment_type),
      occurredAt: data.created_at
        ? new Date(data.created_at).toISOString()
        : new Date().toISOString(),
      failureReason: succeeded ? null : 'payment_failed',
      card: cardOf(data.card),
    };
  }

  /** Every outcome must match Flutterwave's own record (the hash alone proves little). */
  override async confirm(event: PaymentEvent): Promise<PaymentEvent> {
    if (!event.providerTransactionId || !event.amount) throw new WebhookVerificationError();
    const response = envelope(transaction).parse(
      await this.http.request({
        method: 'GET',
        path: `/v3/transactions/${encodeURIComponent(event.providerTransactionId)}/verify`,
      }),
    );
    const data = response.data;
    const expected = event.type === 'payment.succeeded' ? 'successful' : 'failed';
    const amount = amountOf(data.amount, data.currency);
    if (
      data.status !== expected ||
      data.tx_ref !== event.providerReference ||
      amount.minor !== event.amount.minor ||
      amount.currency !== event.amount.currency
    ) {
      throw new WebhookVerificationError();
    }
    return event;
  }

  async verifyPayment(payment: PaymentRef): Promise<PaymentVerification> {
    let data: z.infer<typeof transaction>;
    try {
      data = envelope(transaction).parse(
        await this.http.request({
          method: 'GET',
          path: `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(payment.providerReference)}`,
        }),
      ).data;
    } catch (error) {
      if (error instanceof PaymentProviderUnavailableError) throw error;
      if (error instanceof z.ZodError)
        throw new PaymentProviderUnavailableError(this.name, 'Unexpected verify response');
      return {
        status: 'pending',
        amount: null,
        providerTransactionId: null,
        method: null,
        failureReason: null,
      };
    }
    const status =
      data.status === 'successful' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending';
    return {
      status,
      amount: amountOf(data.amount, data.currency),
      providerTransactionId: data.id,
      method: method(data.payment_type),
      failureReason: status === 'failed' ? 'payment_failed' : null,
    };
  }

  async refund(request: RefundRequest): Promise<ProviderRefund> {
    const transactionId = request.payment.providerTransactionId;
    if (!transactionId) {
      throw new PaymentProviderUnavailableError(
        this.name,
        'The charge id is unknown; verify the payment first',
      );
    }
    const response = envelope(refundData).parse(
      await this.http.request({
        method: 'POST',
        path: `/v3/transactions/${encodeURIComponent(transactionId)}/refund`,
        body: { amount: toDecimalString(request.amount) },
      }),
    );
    const status = response.data.status;
    return {
      providerRefundId: response.data.id,
      status: status === 'completed' ? 'succeeded' : status === 'failed' ? 'failed' : 'pending',
      amount: request.amount,
      refundId: request.refundId,
      failureReason: status === 'failed' ? 'provider_failed' : null,
    };
  }
}
