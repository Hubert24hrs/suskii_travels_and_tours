import { createHmac } from 'node:crypto';

import { money } from '@suskii/shared';

import { FlutterwavePaymentProvider } from './flutterwave/flutterwave-payment-provider';
import {
  PaymentProviderRequestError,
  PaymentProviderUnavailableError,
  WebhookSignatureError,
  WebhookVerificationError,
  type PaymentEvent,
} from './payment-provider';
import { PaystackPaymentProvider } from './paystack/paystack-payment-provider';
import { StripePaymentProvider } from './stripe/stripe-payment-provider';

// Payload fixtures are shaped after the providers' API references and official SDK types.

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A fetch that answers from a queue and records what was sent. */
function fakeFetch(...responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const next = responses.shift();
    if (!next) return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const PAYMENT_ID = '0192f0a8-5b6c-7d8e-9f00-112233445566';

describe('PaystackPaymentProvider', () => {
  const secretKey = 'sk_test_paystack_0123456789';
  const provider = (fetchImpl?: typeof fetch) =>
    new PaystackPaymentProvider({
      secretKey,
      baseUrl: 'https://api.paystack.test',
      timeoutMs: 1000,
      fetch: fetchImpl,
    });
  const sign = (body: string) => createHmac('sha512', secretKey).update(body).digest('hex');
  const charge = {
    event: 'charge.success',
    data: {
      id: 302961,
      status: 'success',
      reference: PAYMENT_ID,
      amount: 4_550_000,
      currency: 'NGN',
      channel: 'card',
      paid_at: '2026-10-01T10:05:00.000Z',
      customer: { email: 'ngozi@example.com' },
      authorization: { last4: '4081', bin: '408408' },
    },
  };

  it('initialises a transaction in subunits with our payment id as reference', async () => {
    const { fetch, calls } = fakeFetch({
      body: {
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/abc',
          access_code: 'abc',
          reference: PAYMENT_ID,
        },
      },
    });
    const session = await provider(fetch).createCheckout({
      paymentId: PAYMENT_ID,
      reference: 'K7M2QX',
      amount: money(4_550_000n, 'NGN'),
      customerEmail: 'ngozi@example.com',
      returnUrl: 'https://web.test/bookings/1',
      expiresAt: new Date(Date.now() + 1_800_000),
    });
    expect(session).toEqual({
      providerReference: PAYMENT_ID,
      checkoutUrl: 'https://checkout.paystack.com/abc',
    });
    expect(calls[0]?.url).toBe('https://api.paystack.test/transaction/initialize');
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${secretKey}`);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      amount: '4550000',
      currency: 'NGN',
      reference: PAYMENT_ID,
      email: 'ngozi@example.com',
    });
  });

  it('accepts a correctly signed charge.success and never keeps card details', () => {
    const body = JSON.stringify(charge);
    const event = provider().parseWebhook(Buffer.from(body), {
      'x-paystack-signature': sign(body),
    });
    expect(event).toEqual<PaymentEvent>({
      eventId: 'charge.success:302961',
      type: 'payment.succeeded',
      providerReference: PAYMENT_ID,
      providerTransactionId: '302961',
      providerRefundId: null,
      refundId: null,
      amount: money(4_550_000n, 'NGN'),
      method: 'card',
      occurredAt: '2026-10-01T10:05:00.000Z',
      failureReason: null,
    });
    expect(
      JSON.stringify(event, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toContain('4081');
  });

  it('rejects a tampered body, a wrong secret and a missing signature', () => {
    const body = JSON.stringify(charge);
    const tampered = body.replace('4550000', '4550');
    expect(() =>
      provider().parseWebhook(Buffer.from(tampered), { 'x-paystack-signature': sign(body) }),
    ).toThrow(WebhookSignatureError);
    const wrong = createHmac('sha512', 'sk_test_other').update(body).digest('hex');
    expect(() =>
      provider().parseWebhook(Buffer.from(body), { 'x-paystack-signature': wrong }),
    ).toThrow(WebhookSignatureError);
    expect(() => provider().parseWebhook(Buffer.from(body), {})).toThrow(WebhookSignatureError);
  });

  it('maps refund events and ignores the rest', () => {
    const refund = JSON.stringify({
      event: 'refund.processed',
      data: {
        id: 1_234_567,
        status: 'processed',
        transaction_reference: PAYMENT_ID,
        amount: 4_550_000,
        currency: 'NGN',
      },
    });
    expect(
      provider().parseWebhook(Buffer.from(refund), { 'x-paystack-signature': sign(refund) }),
    ).toMatchObject({
      type: 'refund.succeeded',
      providerRefundId: '1234567',
      providerReference: PAYMENT_ID,
      amount: money(4_550_000n, 'NGN'),
    });
    const other = JSON.stringify({ event: 'transfer.success', data: {} });
    expect(
      provider().parseWebhook(Buffer.from(other), { 'x-paystack-signature': sign(other) }),
    ).toBeNull();
  });

  it('confirms a success against the transaction record before it is applied', async () => {
    const body = JSON.stringify(charge);
    const event = provider().parseWebhook(Buffer.from(body), {
      'x-paystack-signature': sign(body),
    })!;
    const verified = { status: true, data: { ...charge.data } };
    await expect(provider(fakeFetch({ body: verified }).fetch).confirm(event)).resolves.toBe(event);
    const cheaper = { status: true, data: { ...charge.data, amount: 100 } };
    await expect(provider(fakeFetch({ body: cheaper }).fetch).confirm(event)).rejects.toThrow(
      WebhookVerificationError,
    );
  });

  it('treats abandoned transactions as pending and unknown references as not started', async () => {
    const abandoned = { status: true, data: { ...charge.data, status: 'abandoned' } };
    const ref = {
      providerReference: PAYMENT_ID,
      providerTransactionId: null,
      amount: money(1n, 'NGN'),
    };
    expect((await provider(fakeFetch({ body: abandoned }).fetch).verifyPayment(ref)).status).toBe(
      'pending',
    );
    const unknown = {
      status: 400,
      body: { status: false, message: 'Transaction reference not found' },
    };
    expect((await provider(fakeFetch(unknown).fetch).verifyPayment(ref)).status).toBe('pending');
    const failed = { status: true, data: { ...charge.data, status: 'failed' } };
    expect((await provider(fakeFetch({ body: failed }).fetch).verifyPayment(ref)).status).toBe(
      'failed',
    );
  });

  it('refunds by transaction id with our refund id in the note and finds it again', async () => {
    const created = {
      status: true,
      data: {
        id: 99,
        status: 'pending',
        amount: 100_000,
        currency: 'NGN',
        merchant_note: 'suskii-refund:r1',
      },
    };
    const { fetch, calls } = fakeFetch(
      { body: created },
      { body: { status: true, data: [created.data] } },
    );
    const paystack = provider(fetch);
    const ref = {
      providerReference: PAYMENT_ID,
      providerTransactionId: '302961',
      amount: money(4_550_000n, 'NGN'),
    };
    const result = await paystack.refund({
      refundId: 'r1',
      payment: ref,
      amount: money(100_000n, 'NGN'),
    });
    expect(result).toMatchObject({ providerRefundId: '99', status: 'pending', refundId: 'r1' });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      transaction: '302961',
      amount: '100000',
      merchant_note: 'suskii-refund:r1',
    });
    expect(await paystack.listRefunds(ref)).toEqual([
      expect.objectContaining({ providerRefundId: '99', refundId: 'r1' }),
    ]);
    expect(calls[1]?.url).toBe('https://api.paystack.test/refund?transaction=302961');
  });
});

describe('FlutterwavePaymentProvider', () => {
  const webhookHash = 'flw-secret-hash-0123456789';
  const provider = (fetchImpl?: typeof fetch) =>
    new FlutterwavePaymentProvider({
      secretKey: 'FLWSECK_TEST-0123456789',
      webhookHash,
      baseUrl: 'https://api.flutterwave.test',
      timeoutMs: 1000,
      fetch: fetchImpl,
    });
  const completed = (overrides: Record<string, unknown> = {}) => ({
    event: 'charge.completed',
    data: {
      id: 285959875,
      tx_ref: PAYMENT_ID,
      flw_ref: 'FLW-MOCK-1',
      amount: 45500.5,
      currency: 'NGN',
      charged_amount: 45500.5,
      status: 'successful',
      payment_type: 'bank_transfer',
      created_at: '2026-10-01T10:05:00.000Z',
      ...overrides,
    },
  });

  it('opens a standard checkout in major units with a session duration', async () => {
    const { fetch, calls } = fakeFetch({
      body: {
        status: 'success',
        data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' },
      },
    });
    const session = await provider(fetch).createCheckout({
      paymentId: PAYMENT_ID,
      reference: 'K7M2QX',
      amount: money(4_550_050n, 'NGN'),
      customerEmail: 'ngozi@example.com',
      returnUrl: 'https://web.test/bookings/1',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    expect(session.providerReference).toBe(PAYMENT_ID);
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(sent).toMatchObject({ tx_ref: PAYMENT_ID, amount: '45500.50', currency: 'NGN' });
    expect(sent.session_duration).toBe(30);
  });

  it('checks the secret hash and converts amounts exactly', () => {
    const body = JSON.stringify(completed());
    const event = provider().parseWebhook(Buffer.from(body), { 'verif-hash': webhookHash });
    expect(event).toMatchObject({
      eventId: 'charge.completed:285959875:successful',
      type: 'payment.succeeded',
      providerReference: PAYMENT_ID,
      providerTransactionId: '285959875',
      amount: money(4_550_050n, 'NGN'),
      method: 'bank_transfer',
    });
    expect(() =>
      provider().parseWebhook(Buffer.from(body), { 'verif-hash': 'wrong-hash-0123456789' }),
    ).toThrow(WebhookSignatureError);
    // More decimals than the currency has: fails closed instead of rounding.
    const precise = JSON.stringify(completed({ amount: '45500.505' }));
    expect(() =>
      provider().parseWebhook(Buffer.from(precise), { 'verif-hash': webhookHash }),
    ).toThrow();
  });

  it('applies an outcome only when Flutterwave confirms status, reference and amount', async () => {
    const body = JSON.stringify(completed());
    const event = provider().parseWebhook(Buffer.from(body), {
      'verif-hash': webhookHash,
    })!;
    const record = { status: 'success', data: completed().data };
    const { fetch, calls } = fakeFetch({ body: record });
    await expect(provider(fetch).confirm(event)).resolves.toBe(event);
    expect(calls[0]?.url).toBe('https://api.flutterwave.test/v3/transactions/285959875/verify');
    const otherRef = { status: 'success', data: completed({ tx_ref: 'someone-else' }).data };
    await expect(provider(fakeFetch({ body: otherRef }).fetch).confirm(event)).rejects.toThrow(
      WebhookVerificationError,
    );
    const pending = { status: 'success', data: completed({ status: 'pending' }).data };
    await expect(provider(fakeFetch({ body: pending }).fetch).confirm(event)).rejects.toThrow(
      WebhookVerificationError,
    );
  });

  it('refunds in major units against the charge id', async () => {
    const { fetch, calls } = fakeFetch({
      body: { status: 'success', data: { id: 7, status: 'completed' } },
    });
    const result = await provider(fetch).refund({
      refundId: 'r1',
      payment: {
        providerReference: PAYMENT_ID,
        providerTransactionId: '285959875',
        amount: money(4_550_050n, 'NGN'),
      },
      amount: money(1_000_050n, 'NGN'),
    });
    expect(result).toMatchObject({ providerRefundId: '7', status: 'succeeded' });
    expect(calls[0]?.url).toBe('https://api.flutterwave.test/v3/transactions/285959875/refund');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ amount: '10000.50' });
  });
});

describe('StripePaymentProvider', () => {
  const webhookSecret = 'whsec_test_0123456789abcdef';
  const now = new Date('2026-10-01T10:00:00.000Z');
  const provider = (fetchImpl?: typeof fetch) =>
    new StripePaymentProvider({
      secretKey: 'sk_test_stripe_0123456789',
      webhookSecret,
      baseUrl: 'https://api.stripe.test',
      timeoutMs: 1000,
      fetch: fetchImpl,
      now: () => now,
    });
  const signed = (payload: unknown, at = now) => {
    const body = JSON.stringify(payload);
    const t = Math.floor(at.getTime() / 1000);
    const v1 = createHmac('sha256', webhookSecret).update(`${t}.${body}`).digest('hex');
    return { body: Buffer.from(body), header: `t=${t},v1=${v1}` };
  };
  const sessionEvent = (type: string, object: Record<string, unknown> = {}) => ({
    id: 'evt_1PabcDEF',
    type,
    created: Math.floor(now.getTime() / 1000),
    data: {
      object: {
        id: 'cs_test_a1b2c3',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 81_245,
        currency: 'usd',
        payment_intent: 'pi_3Pabc',
        payment_method_types: ['card'],
        ...object,
      },
    },
  });

  it('creates a Checkout session with the amount, our ids and an expiry Stripe accepts', async () => {
    const { fetch, calls } = fakeFetch({
      body: {
        id: 'cs_test_a1b2c3',
        url: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3',
        payment_status: 'unpaid',
      },
    });
    await provider(fetch).createCheckout({
      paymentId: PAYMENT_ID,
      reference: 'K7M2QX',
      amount: money(81_245n, 'USD'),
      customerEmail: 'ngozi@example.com',
      returnUrl: 'https://web.test/bookings/1',
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    });
    const form = new URLSearchParams(calls[0]?.body);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('81245');
    expect(form.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(form.get('client_reference_id')).toBe(PAYMENT_ID);
    // Stripe needs at least 30 minutes; our own shorter deadline still applies.
    expect(Number(form.get('expires_at'))).toBe(Math.floor(now.getTime() / 1000) + 31 * 60);
    expect(calls[0]?.headers['Idempotency-Key']).toBe(`checkout-${PAYMENT_ID}`);
    expect(calls[0]?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('verifies the signature, the timestamp tolerance and any matching v1', () => {
    const { body, header } = signed(sessionEvent('checkout.session.completed'));
    expect(provider().parseWebhook(body, { 'stripe-signature': header })).toMatchObject({
      eventId: 'evt_1PabcDEF',
      type: 'payment.succeeded',
      providerReference: 'cs_test_a1b2c3',
      providerTransactionId: 'pi_3Pabc',
      amount: money(81_245n, 'USD'),
    });
    expect(() =>
      provider().parseWebhook(body, {
        'stripe-signature': `${header.split(',')[0]},v1=deadbeef,${header.split(',')[1]}`,
      }),
    ).not.toThrow();
    const tampered = Buffer.from(body.toString().replace('81245', '100'));
    expect(() => provider().parseWebhook(tampered, { 'stripe-signature': header })).toThrow(
      WebhookSignatureError,
    );
    const stale = signed(
      sessionEvent('checkout.session.completed'),
      new Date(now.getTime() - 301_000),
    );
    expect(() => provider().parseWebhook(stale.body, { 'stripe-signature': stale.header })).toThrow(
      /too old/,
    );
  });

  it('waits for delayed payment methods and maps failures, expiry and refunds', () => {
    const parse = (payload: unknown) => {
      const { body, header } = signed(payload);
      return provider().parseWebhook(body, { 'stripe-signature': header });
    };
    expect(
      parse(sessionEvent('checkout.session.completed', { payment_status: 'unpaid' })),
    ).toBeNull();
    expect(parse(sessionEvent('checkout.session.async_payment_failed'))?.type).toBe(
      'payment.failed',
    );
    expect(
      parse(
        sessionEvent('checkout.session.expired', { status: 'expired', payment_status: 'unpaid' }),
      )?.type,
    ).toBe('checkout.expired');
    expect(
      parse({
        id: 'evt_2',
        type: 'refund.updated',
        created: Math.floor(now.getTime() / 1000),
        data: {
          object: {
            id: 're_1',
            status: 'succeeded',
            amount: 81_245,
            currency: 'usd',
            payment_intent: 'pi_3Pabc',
            metadata: { suskii_refund_id: 'r1' },
          },
        },
      }),
    ).toMatchObject({ type: 'refund.succeeded', providerRefundId: 're_1', refundId: 'r1' });
    expect(
      parse({ id: 'evt_3', type: 'customer.created', created: 1, data: { object: {} } }),
    ).toBeNull();
  });

  it('refunds the payment intent with our refund id as idempotency key', async () => {
    const { fetch, calls } = fakeFetch({
      body: {
        id: 're_1',
        status: 'pending',
        amount: 1_000,
        currency: 'usd',
        metadata: { suskii_refund_id: 'r1' },
      },
    });
    const result = await provider(fetch).refund({
      refundId: 'r1',
      payment: {
        providerReference: 'cs_test_a1b2c3',
        providerTransactionId: 'pi_3Pabc',
        amount: money(81_245n, 'USD'),
      },
      amount: money(1_000n, 'USD'),
    });
    expect(result).toMatchObject({ providerRefundId: 're_1', status: 'pending', refundId: 'r1' });
    expect(calls[0]?.headers['Idempotency-Key']).toBe('refund-r1');
    expect(new URLSearchParams(calls[0]?.body).get('payment_intent')).toBe('pi_3Pabc');
  });
});

describe('provider HTTP errors', () => {
  const ref = { providerReference: 'cs_x', providerTransactionId: null, amount: money(1n, 'USD') };
  const stripe = (fetchImpl: typeof fetch) =>
    new StripePaymentProvider({
      secretKey: 'sk_test_stripe_0123456789',
      webhookSecret: 'whsec_test_0123456789abcdef',
      baseUrl: 'https://api.stripe.test',
      timeoutMs: 1000,
      fetch: fetchImpl,
    });

  it('maps 5xx and network failures to unavailable, 4xx to rejected', async () => {
    await expect(
      stripe(fakeFetch({ status: 503, body: {} }).fetch).verifyPayment(ref),
    ).rejects.toThrow(PaymentProviderUnavailableError);
    await expect(stripe(fakeFetch().fetch).verifyPayment(ref)).rejects.toThrow(
      PaymentProviderUnavailableError,
    );
    await expect(
      stripe(
        fakeFetch({ status: 400, body: { error: { message: 'No such session' } } }).fetch,
      ).verifyPayment(ref),
    ).rejects.toThrow(PaymentProviderRequestError);
  });
});
