import { Inject, Injectable } from '@nestjs/common';
import { fromWire, toWire, type Money } from '@suskii/shared';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';

import {
  PaymentProvider,
  WebhookSignatureError,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentEvent,
  type WebhookHeaders,
} from './payment-provider';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

const mockEventSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  created: z.iso.datetime(),
  data: z.object({
    reference: z.string().min(1).max(64),
    amount: z.object({ amountMinor: z.number().int(), currency: z.string().length(3) }),
    failureReason: z.string().max(64).nullable(),
  }),
});

/**
 * MOCK payment provider for development and tests. Its hosted checkout page lives on the web app
 * (`/checkout/mock-payment/{reference}`); the page's buttons make the API build a webhook event
 * signed with an HMAC subkey and feed it through the same pipeline as a real provider. Refused
 * in production unless ALLOW_MOCK_PROVIDERS=true (env schema).
 */
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  readonly name = 'mock';

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hmac: HmacService,
  ) {
    super();
  }

  createCheckout(_request: CheckoutRequest): Promise<CheckoutSession> {
    const providerReference = `mockpay_${randomToken(16)}`;
    return Promise.resolve({
      providerReference,
      checkoutUrl: `${this.config.WEB_APP_URL.replace(/\/$/, '')}/checkout/mock-payment/${providerReference}`,
    });
  }

  /** The signed webhook a real provider would send for this outcome. */
  signedEvent(
    providerReference: string,
    outcome: 'succeeded' | 'failed',
    amount: Money,
  ): { rawBody: Buffer; headers: WebhookHeaders } {
    const body = JSON.stringify({
      id: `mockevt_${randomToken(16)}`,
      type: outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
      created: new Date().toISOString(),
      data: {
        reference: providerReference,
        amount: toWire(amount),
        failureReason: outcome === 'failed' ? 'card_declined' : null,
      },
    });
    return {
      rawBody: Buffer.from(body, 'utf8'),
      headers: { [MOCK_SIGNATURE_HEADER]: this.hmac.digest('mock-payment', body) },
    };
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
      amount: fromWire(event.data.amount),
      occurredAt: event.created,
      failureReason: event.data.failureReason,
    };
  }
}
