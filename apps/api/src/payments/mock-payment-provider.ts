import { Inject, Injectable } from '@nestjs/common';
import { SUPPORTED_CURRENCIES, fromWire, toWire, type Money } from '@suskii/shared';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';

import {
  PaymentProvider,
  PaymentProviderRequestError,
  WebhookSignatureError,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentEvent,
  type PaymentRef,
  type PaymentVerification,
  type ProviderRefund,
  type RefundRequest,
  type WebhookHeaders,
} from './payment-provider';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

const wireMoney = z.object({ amountMinor: z.number().int(), currency: z.string().length(3) });
const mockEventSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['payment.succeeded', 'payment.failed', 'refund.succeeded', 'refund.failed']),
  created: z.iso.datetime(),
  data: z.object({
    reference: z.string().min(1).max(64).nullable(),
    refundId: z.string().max(64).nullable().default(null),
    providerRefundId: z.string().max(64).nullable().default(null),
    amount: wireMoney,
    failureReason: z.string().max(64).nullable(),
  }),
});

interface MockCharge {
  amount: Money;
  status: PaymentVerification['status'];
}

/**
 * MOCK payment provider for development and tests. Its hosted checkout page lives on the web app
 * (`/checkout/mock-payment/{reference}`); the page's buttons make the API build a webhook event
 * signed with an HMAC subkey and feed it through the same pipeline as a real provider. Charges
 * and refunds are remembered in memory so reconciliation and refunds behave like a provider's.
 * Refused in production unless ALLOW_MOCK_PROVIDERS=true (env schema).
 */
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  readonly name = 'mock' as const;
  readonly currencies = SUPPORTED_CURRENCIES;
  readonly methods = ['card', 'bank_transfer', 'ussd'] as const;
  readonly idempotentRefunds = true;

  /** Test hook: the next completions record the charge but never deliver their webhook. */
  dropNextWebhooks = 0;
  /** Test hook: this many upcoming refunds are rejected by the "provider". */
  failNextRefunds = 0;
  /** Test hook: refunds stay pending until `settleRefund()` sends their webhook. */
  holdRefunds = false;

  private readonly charges = new Map<string, MockCharge>();
  private readonly refunds = new Map<string, ProviderRefund & { reference: string }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hmac: HmacService,
  ) {
    super();
  }

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const providerReference = `mockpay_${randomToken(16)}`;
    this.charges.set(providerReference, { amount: request.amount, status: 'pending' });
    return Promise.resolve({
      providerReference,
      checkoutUrl: `${this.config.WEB_APP_URL.replace(/\/$/, '')}/checkout/mock-payment/${providerReference}`,
    });
  }

  /** Records the traveller's action on the hosted page, as a provider would. */
  recordOutcome(providerReference: string, outcome: 'succeeded' | 'failed', amount: Money): void {
    this.charges.set(providerReference, { amount, status: outcome });
  }

  /** The signed webhook a real provider would send for this outcome. */
  signedEvent(
    providerReference: string,
    outcome: 'succeeded' | 'failed',
    amount: Money,
  ): { rawBody: Buffer; headers: WebhookHeaders } {
    return this.sign({
      id: `mockevt_${randomToken(16)}`,
      type: outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
      created: new Date().toISOString(),
      data: {
        reference: providerReference,
        refundId: null,
        providerRefundId: null,
        amount: toWire(amount),
        failureReason: outcome === 'failed' ? 'card_declined' : null,
      },
    });
  }

  /** Test hook: finishes a held refund and returns the webhook announcing it. */
  settleRefund(
    providerRefundId: string,
    outcome: 'succeeded' | 'failed',
  ): { rawBody: Buffer; headers: WebhookHeaders } {
    const stored = this.refunds.get(providerRefundId);
    if (!stored?.amount) throw new Error(`Unknown mock refund ${providerRefundId}`);
    this.refunds.set(providerRefundId, {
      ...stored,
      status: outcome,
      failureReason: outcome === 'failed' ? 'provider_failed' : null,
    });
    return this.sign({
      id: `mockevt_${randomToken(16)}`,
      type: outcome === 'succeeded' ? 'refund.succeeded' : 'refund.failed',
      created: new Date().toISOString(),
      data: {
        reference: stored.reference,
        refundId: stored.refundId,
        providerRefundId,
        amount: toWire(stored.amount),
        failureReason: outcome === 'failed' ? 'provider_failed' : null,
      },
    });
  }

  parseWebhook(rawBody: Buffer, headers: WebhookHeaders): PaymentEvent {
    const header = headers[MOCK_SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    const body = rawBody.toString('utf8');
    if (!signature || !this.hmac.verify('mock-payment', body, signature)) {
      throw new WebhookSignatureError();
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new WebhookSignatureError('Webhook body is not JSON');
    }
    const event = mockEventSchema.parse(json);
    return {
      eventId: event.id,
      type: event.type,
      providerReference: event.data.reference,
      providerTransactionId: event.data.reference,
      providerRefundId: event.data.providerRefundId,
      refundId: event.data.refundId,
      amount: fromWire(event.data.amount),
      method: event.type.startsWith('payment') ? 'card' : null,
      occurredAt: event.created,
      failureReason: event.data.failureReason,
    };
  }

  verifyPayment(payment: PaymentRef): Promise<PaymentVerification> {
    const charge = this.charges.get(payment.providerReference);
    return Promise.resolve({
      status: charge?.status ?? 'pending',
      amount: charge?.amount ?? null,
      providerTransactionId: charge ? payment.providerReference : null,
      method: charge?.status === 'succeeded' ? 'card' : null,
      failureReason: charge?.status === 'failed' ? 'card_declined' : null,
    });
  }

  refund(request: RefundRequest): Promise<ProviderRefund> {
    const existing = [...this.refunds.values()].find((item) => item.refundId === request.refundId);
    // Idempotent by our refund id, like Stripe.
    if (existing) return Promise.resolve(existing);
    if (this.failNextRefunds > 0) {
      this.failNextRefunds -= 1;
      return Promise.reject(new PaymentProviderRequestError(this.name, 'Mock refund rejected'));
    }
    const refund = {
      providerRefundId: `mockref_${randomToken(12)}`,
      status: this.holdRefunds ? ('pending' as const) : ('succeeded' as const),
      amount: request.amount,
      refundId: request.refundId,
      failureReason: null,
      reference: request.payment.providerReference,
    };
    this.refunds.set(refund.providerRefundId, refund);
    return Promise.resolve(refund);
  }

  override getRefund(providerRefundId: string): Promise<ProviderRefund | null> {
    return Promise.resolve(this.refunds.get(providerRefundId) ?? null);
  }

  override listRefunds(payment: PaymentRef): Promise<ProviderRefund[]> {
    return Promise.resolve(
      [...this.refunds.values()].filter((item) => item.reference === payment.providerReference),
    );
  }

  private sign(body: z.input<typeof mockEventSchema>): {
    rawBody: Buffer;
    headers: WebhookHeaders;
  } {
    const text = JSON.stringify(body);
    return {
      rawBody: Buffer.from(text, 'utf8'),
      headers: { [MOCK_SIGNATURE_HEADER]: this.hmac.digest('mock-payment', text) },
    };
  }
}
