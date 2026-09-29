import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { PaymentPlansService } from '../src/bookings/payment-plans.service';
import { PaymentReconciliationService } from '../src/bookings/payment-reconciliation.service';
import { MockPaymentProvider } from '../src/payments/mock-payment-provider';
import { PricingService } from '../src/pricing/pricing.service';
import { MockFlightSupplier } from '../src/suppliers/mock/mock-flight-supplier';

import { bearer, enrolTotp, grantRoles, PASSWORD, signUp, totp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * Phase 6 acceptance (ADR-016 to ADR-019): webhook replay never double-credits, tampered amounts
 * fail safely, and a paid booking whose ticketing fails ends refunded with notifications. Plus
 * holds, installments, defaults, maker-checker refunds, the wallet and reconciliation, with the
 * real Paystack adapter talking to a local fake of its API.
 */

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const PAYSTACK_SECRET = 'sk_test_e2e_paystack_0123456789';
const OPS_EMAIL = 'ops@suskii.test';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let keySequence = 0;
const idempotencyKey = (): string => `e2e-payments-${Date.now()}-${(keySequence += 1)}`;

interface Money {
  amountMinor: number;
  currency: string;
}

const contact = { email: 'ngozi@example.com', phone: '+2348012345678' };
const adult = {
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames: 'Ngozi',
  surname: 'Eze',
  dateOfBirth: '1991-02-03',
  nationality: 'NG',
  document: { number: 'B1234567', issuingCountry: 'NG', expiryDate: addDays(today, 3650) },
};

/** A tiny stand-in for Paystack's API: initialize, verify and refunds. */
class FakePaystack {
  server: Server = createServer((request, response) => void this.handle(request, response));
  transactions = new Map<
    string,
    { id: number; amount: number; currency: string; status: string }
  >();
  /** Test hook: what verify reports instead of the truth. */
  verifyOverride: Partial<{ status: string; amount: number }> | null = null;
  refunds: { id: number; transaction: string; amount: number; note: string }[] = [];
  private nextId = 5000;

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  reset(): void {
    this.transactions.clear();
    this.refunds = [];
    this.verifyOverride = null;
  }

  /** The traveller paid on the hosted page. */
  pay(reference: string, amount?: number): { id: number; amount: number; currency: string } {
    const transaction = this.transactions.get(reference);
    if (!transaction) throw new Error(`unknown reference ${reference}`);
    transaction.status = 'success';
    if (amount !== undefined) transaction.amount = amount;
    return transaction;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${PAYSTACK_SECRET}`)
      return this.send(response, 401, { status: false });
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, string>)
      : {};
    const url = new URL(request.url ?? '/', 'http://fake');
    if (request.method === 'POST' && url.pathname === '/transaction/initialize') {
      const reference = body.reference ?? '';
      this.transactions.set(reference, {
        id: (this.nextId += 1),
        amount: Number(body.amount),
        currency: body.currency ?? 'NGN',
        status: 'abandoned',
      });
      return this.send(response, 200, {
        status: true,
        data: {
          authorization_url: `https://checkout.paystack.test/${reference}`,
          access_code: 'x',
          reference,
        },
      });
    }
    const verify = /^\/transaction\/verify\/(.+)$/.exec(url.pathname);
    if (request.method === 'GET' && verify) {
      const reference = decodeURIComponent(verify[1] ?? '');
      const transaction = this.transactions.get(reference);
      if (!transaction)
        return this.send(response, 400, {
          status: false,
          message: 'Transaction reference not found',
        });
      return this.send(response, 200, {
        status: true,
        data: { ...transaction, reference, channel: 'card', ...this.verifyOverride },
      });
    }
    if (request.method === 'POST' && url.pathname === '/refund') {
      const refund = {
        id: (this.nextId += 1),
        transaction: body.transaction ?? '',
        amount: Number(body.amount),
        note: body.merchant_note ?? '',
      };
      this.refunds.push(refund);
      return this.send(response, 200, {
        status: true,
        data: {
          id: refund.id,
          status: 'processed',
          amount: refund.amount,
          currency: body.currency,
          merchant_note: refund.note,
        },
      });
    }
    return this.send(response, 404, { status: false });
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }
}

describe('payments (e2e): providers, ledger, plans and refunds', () => {
  let ctx: TestContext;
  const paystack = new FakePaystack();

  beforeAll(async () => {
    const url = await paystack.start();
    ctx = await createTestApp({
      PAYMENT_PROVIDERS: ['mock', 'paystack'],
      PAYSTACK_SECRET_KEY: PAYSTACK_SECRET,
      PAYSTACK_API_URL: url,
      OPS_ALERT_EMAIL: OPS_EMAIL,
    });
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    const flights = ctx.app.get(MockFlightSupplier);
    flights.repriceDriftBps = 0;
    flights.failNextBookings = 0;
    flights.holds.clear();
    const mock = ctx.app.get(MockPaymentProvider);
    mock.dropNextWebhooks = 0;
    mock.failNextRefunds = 0;
    mock.holdRefunds = false;
    paystack.reset();
    ctx.config.REFUND_APPROVAL_THRESHOLD_NGN = 0;
    ctx.config.INSTALLMENT_DEFAULT_FEE_BPS = 0;
  });
  afterAll(async () => {
    await ctx.close();
    await new Promise((resolve) => paystack.server.close(resolve));
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  interface Quote {
    quoteId: string;
    payment: {
      providers: { name: string }[];
      hold: { deadline: string } | null;
      installments: { schedule: { sequence: number; amount: Money }[] } | null;
    };
  }

  async function search(origin: string, destination: string, days: number) {
    const response = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin, destination, departureDate: inDays(days) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    return response.body.offers as { id: string }[];
  }

  /** Quotes an offer, then reads it the way the checkout page does (with payment options). */
  async function quote(offerId: string): Promise<Quote> {
    const created = await ctx.http().post(`/v1/flights/offers/${offerId}/quote`).expect(201);
    const response = await ctx
      .http()
      .get(`/v1/quotes/${created.body.quoteId as string}`)
      .expect(200);
    return response.body as Quote;
  }

  /** The first offer whose quote allows `plan` (installments need a long, guaranteed hold). */
  async function planQuote(plan: 'hold' | 'installments'): Promise<Quote> {
    for (const offer of await search('LOS', 'LHR', 40)) {
      const candidate = await quote(offer.id);
      if (candidate.payment[plan]) return candidate;
    }
    throw new Error(`no offer allows ${plan}`);
  }

  async function book(
    quoteId: string,
    headers: Record<string, string> = {},
  ): Promise<{ id: string; token: Record<string, string>; total: Money }> {
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .set(headers)
      .send({
        quoteId,
        contact,
        passengers: [adult],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    const token = created.body.accessToken as string | null;
    return {
      id: created.body.booking.id as string,
      token: token ? { 'X-Booking-Token': token } : headers,
      total: created.body.booking.price.total as Money,
    };
  }

  async function domesticBooking(headers: Record<string, string> = {}) {
    const [offer] = await search('LOS', 'ABV', 30);
    return book((await quote(offer?.id ?? '')).quoteId, headers);
  }

  function startPayment(
    id: string,
    token: Record<string, string>,
    body: Record<string, unknown> = {},
  ) {
    return ctx
      .http()
      .post(`/v1/bookings/${id}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(token)
      .send(body);
  }

  function post(path: string, token: Record<string, string>) {
    return ctx.http().post(path).set('Idempotency-Key', idempotencyKey()).set(token).send({});
  }

  async function payWithMock(checkoutUrl: string) {
    const reference = checkoutUrl.split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
  }

  const getBooking = async (id: string, token: Record<string, string>) =>
    (await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200)).body as {
      status: string;
      paid: Money;
      amountDue: Money | null;
      paymentPlan: {
        kind: string;
        status: string;
        installments: {
          id: string;
          sequence: number;
          dueAt: string;
          amount: Money;
          status: string;
        }[];
      } | null;
      refunds: { status: string; amount: Money; destination: string }[];
      flight: { airlineReference: string | null } | null;
    };

  const balance = async (code: string): Promise<bigint> =>
    (await ctx.prisma.ledgerAccount.findUnique({ where: { code } }))?.balanceMinor ?? 0n;

  function paystackWebhook(payload: unknown) {
    const body = JSON.stringify(payload);
    return ctx
      .http()
      .post('/v1/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex'))
      .send(body);
  }

  const chargeSuccess = (
    transaction: { id: number; amount: number; currency: string },
    reference: string,
  ) => ({
    event: 'charge.success',
    data: {
      ...transaction,
      reference,
      status: 'success',
      channel: 'card',
      paid_at: new Date().toISOString(),
    },
  });

  async function staff(email: string, roles: Parameters<typeof grantRoles>[2]) {
    const initial = await signUp(ctx, email);
    await grantRoles(ctx, initial.userId, roles);
    const { secret } = await enrolTotp(ctx, initial.accessToken);
    const pending = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const verified = await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, code: totp(secret, 1) })
      .expect(200);
    return { userId: initial.userId, headers: bearer(verified.body.accessToken as string) };
  }

  const templates = () => ctx.emails.outbox.map((message) => message.template);

  // -------------------------------------------------------------------------
  // Acceptance criteria
  // -------------------------------------------------------------------------

  it('acceptance: a replayed webhook never credits twice', async () => {
    const { id, token, total } = await domesticBooking();
    const payment = await startPayment(id, token).expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    const mock = ctx.app.get(MockPaymentProvider);
    const amount = { minor: BigInt(total.amountMinor), currency: total.currency };
    const event = mock.signedEvent(reference, 'succeeded', amount);
    const send = (body: Buffer, headers: Record<string, string | string[] | undefined>) =>
      ctx
        .http()
        .post('/v1/payments/webhooks/mock')
        .set('Content-Type', 'application/json')
        .set(headers as Record<string, string>)
        .send(body.toString('utf8'))
        .expect(200);
    // The same delivery three times, then a new event id for the same payment.
    await Promise.all([send(event.rawBody, event.headers), send(event.rawBody, event.headers)]);
    await send(event.rawBody, event.headers);
    const again = mock.signedEvent(reference, 'succeeded', amount);
    await send(again.rawBody, again.headers);
    await ctx.background.drain();

    expect((await getBooking(id, token)).status).toBe('CONFIRMED');
    expect(await balance(`booking:${id}:${total.currency}`)).toBe(BigInt(total.amountMinor));
    expect(await balance(`psp:mock:${total.currency}`)).toBe(BigInt(total.amountMinor));
    expect(await ctx.prisma.ledgerTransaction.count({ where: { bookingId: id } })).toBe(1);
    expect(await ctx.prisma.webhookEvent.count()).toBe(2);
    expect(await ctx.prisma.refund.count()).toBe(0);
  });

  it('acceptance: tampered amounts fail safely', async () => {
    const { id, token, total } = await domesticBooking();
    const started = await startPayment(id, token, { provider: 'paystack' }).expect(201);
    expect(started.body.checkoutUrl).toMatch(/^https:\/\/checkout\.paystack\.test\//);
    const reference = (started.body.checkoutUrl as string).split('/').pop() ?? '';

    // 1. A body changed after signing: rejected, nothing stored.
    const genuine = chargeSuccess({ id: 1, amount: total.amountMinor, currency: 'NGN' }, reference);
    const signature = createHmac('sha512', PAYSTACK_SECRET)
      .update(JSON.stringify(genuine))
      .digest('hex');
    const tampered = JSON.stringify({ ...genuine, data: { ...genuine.data, amount: 100 } });
    await ctx
      .http()
      .post('/v1/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(tampered)
      .expect(400);

    // 2. Correctly signed, but Paystack's own record says it was never paid: rejected.
    await paystackWebhook(genuine).expect(400);

    // 3. Correctly signed and paid, but Paystack reports another amount than the event: rejected.
    const transaction = paystack.pay(reference);
    paystack.verifyOverride = { amount: 100 };
    await paystackWebhook(chargeSuccess(transaction, reference)).expect(400);
    expect(await ctx.prisma.webhookEvent.count()).toBe(0);
    expect(await ctx.prisma.ledgerEntry.count()).toBe(0);
    expect((await getBooking(id, token)).status).toBe('AWAITING_PAYMENT');

    // 4. The provider really charged less than asked: recorded, never applied, refunded.
    paystack.verifyOverride = null;
    const short = paystack.pay(reference, total.amountMinor - 50_000);
    await paystackWebhook(chargeSuccess(short, reference)).expect(200);
    await ctx.background.drain();
    const booking = await getBooking(id, token);
    expect(booking).toMatchObject({ status: 'AWAITING_PAYMENT', paid: { amountMinor: 0 } });
    expect(paystack.refunds).toEqual([
      expect.objectContaining({
        transaction: String(short.id),
        amount: total.amountMinor - 50_000,
      }),
    ]);
    const refund = await ctx.prisma.refund.findFirstOrThrow();
    expect(refund).toMatchObject({
      reason: 'amount_mismatch',
      status: 'succeeded',
      source: 'unapplied',
    });
    expect(await balance('unapplied:NGN')).toBe(0n);
    expect(await balance('psp:paystack:NGN')).toBe(0n);
  });

  it('acceptance: payment succeeds but ticketing fails: refunded, customer and ops notified', async () => {
    const { id, token, total } = await domesticBooking();
    ctx.app.get(MockFlightSupplier).failNextBookings = 100;
    const payment = await startPayment(id, token).expect(201);
    await payWithMock(payment.body.checkoutUrl as string);
    for (let attempt = 2; attempt <= ctx.config.TICKETING_MAX_ATTEMPTS; attempt += 1) {
      await ctx.prisma.booking.update({
        where: { id },
        data: { nextTicketingAt: new Date(Date.now() - 1000) },
      });
      await ctx.http().post('/v1/internal/bookings/ticket-due').set(INTERNAL).expect(200);
    }
    await ctx.background.drain();

    const booking = await getBooking(id, token);
    expect(booking.status).toBe('REFUNDED');
    expect(booking.refunds).toEqual([
      expect.objectContaining({ status: 'completed', destination: 'original', amount: total }),
    ]);
    expect(templates()).toEqual(
      expect.arrayContaining(['refund-started', 'refund-completed', 'ops-alert']),
    );
    const alert = ctx.emails.outbox.find((message) => message.template === 'ops-alert');
    expect(alert?.to).toBe(OPS_EMAIL);
    expect(alert?.subject).toContain('ticketing.failed_refunding');
    expect(alert?.text).not.toContain(contact.email);
    expect(await balance(`booking:${id}:${total.currency}`)).toBe(0n);
    expect(await balance(`refunds-in-flight:mock:${total.currency}`)).toBe(0n);
    expect(await balance(`psp:mock:${total.currency}`)).toBe(0n);
  });

  // -------------------------------------------------------------------------
  // Providers and reconciliation
  // -------------------------------------------------------------------------

  it('pays through Paystack end to end, confirmed with the provider before it counts', async () => {
    const { id, token, total } = await domesticBooking();
    const started = await startPayment(id, token, { provider: 'paystack' }).expect(201);
    const reference = (started.body.checkoutUrl as string).split('/').pop() ?? '';
    const transaction = paystack.pay(reference);
    await paystackWebhook(chargeSuccess(transaction, reference)).expect(200);
    await ctx.background.drain();
    expect((await getBooking(id, token)).status).toBe('CONFIRMED');
    const stored = await ctx.prisma.payment.findUniqueOrThrow({
      where: { providerReference: reference },
    });
    expect(stored).toMatchObject({
      provider: 'paystack',
      providerTransactionId: String(transaction.id),
      method: 'card',
    });
    expect(await balance('psp:paystack:NGN')).toBe(BigInt(total.amountMinor));
    // A provider that is not enabled (or cannot take the currency) is refused.
    const other = await domesticBooking();
    const refused = await startPayment(other.id, other.token, { provider: 'stripe' }).expect(422);
    expect(refused.body.type).toBe('urn:suskii:problem:payment-provider-unavailable');
  });

  it('recovers a payment whose webhook never arrived', async () => {
    const { id, token } = await domesticBooking();
    const payment = await startPayment(id, token).expect(201);
    ctx.app.get(MockPaymentProvider).dropNextWebhooks = 1;
    await payWithMock(payment.body.checkoutUrl as string);
    expect((await getBooking(id, token)).status).toBe('AWAITING_PAYMENT');
    const run = await ctx.app
      .get(PaymentReconciliationService)
      .reconcileDue(new Date(Date.now() + 16 * 60_000));
    expect(run).toEqual({ checked: 1, settled: 1 });
    await ctx.background.drain();
    expect((await getBooking(id, token)).status).toBe('CONFIRMED');
    expect(
      await ctx.prisma.webhookEvent.findFirst({ where: { eventId: { startsWith: 'reconcile:' } } }),
    ).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Holds and installments
  // -------------------------------------------------------------------------

  it('reserves now and takes payment later through an emailed access link', async () => {
    const offer = await planQuote('hold');
    const { id, token } = await book(offer.quoteId);
    const held = await post(`/v1/bookings/${id}/hold`, token).expect(200);
    expect(held.body).toMatchObject({
      status: 'HELD',
      paymentPlan: { kind: 'hold', status: 'active' },
    });
    const reference = held.body.flight.airlineReference as string;
    expect(reference).toMatch(/^[A-Z]{6}$/);

    await ctx.background.drain();
    const email = ctx.emails.outbox.find((message) => message.template === 'booking-held');
    const link = /#access=([A-Za-z0-9_-]+)/.exec(email?.text ?? '')?.[1];
    expect(link).toBeTruthy();
    // The link opens the booking in another browser (a new token, not the checkout one).
    const viaLink = { 'X-Booking-Token': link ?? '' };
    expect((await getBooking(id, viaLink)).status).toBe('HELD');

    const payment = await startPayment(id, viaLink).expect(201);
    await payWithMock(payment.body.checkoutUrl as string);
    const confirmed = await getBooking(id, viaLink);
    expect(confirmed.status).toBe('CONFIRMED');
    // Ticketing paid the held order: same airline reference.
    expect(confirmed.flight?.airlineReference).toBe(reference);
    expect([...ctx.app.get(MockFlightSupplier).holds.values()][0]).toMatchObject({ paid: true });
  });

  it('takes a deposit and installments, reminds before due dates, then tickets', async () => {
    const offer = await planQuote('installments');
    const { id, token, total } = await book(offer.quoteId);
    const plan = await post(`/v1/bookings/${id}/installment-plan`, token).expect(200);
    const installments = plan.body.paymentPlan.installments as {
      id: string;
      dueAt: string;
      amount: Money;
    }[];
    expect(installments.length).toBeGreaterThanOrEqual(2);
    expect(installments.reduce((sum, item) => sum + item.amount.amountMinor, 0)).toBe(
      total.amountMinor,
    );

    const deposit = await startPayment(id, token).expect(201);
    expect(deposit.body.amount).toEqual(installments[0]?.amount);
    await payWithMock(deposit.body.checkoutUrl as string);
    const partly = await getBooking(id, token);
    expect(partly).toMatchObject({
      status: 'PARTIALLY_PAID',
      paid: installments[0]?.amount,
      amountDue: installments[1]?.amount,
    });

    // Reminders before each due date, once, by email and SMS. Installments here are about three
    // days apart, so the plan email stood in for the 3-day reminder; the 1-day one goes out.
    const plans = ctx.app.get(PaymentPlansService);
    const next = new Date(installments[1]?.dueAt ?? '');
    await plans.processDue(new Date(next.getTime() - 2 * DAY));
    expect(templates().filter((name) => name === 'payment-due')).toHaveLength(0);
    await plans.processDue(new Date(next.getTime() - 12 * HOUR));
    await plans.processDue(new Date(next.getTime() - 12 * HOUR + 60_000));
    expect(templates().filter((name) => name === 'payment-due')).toHaveLength(1);
    expect(ctx.sms.outbox.filter((message) => message.template === 'payment-due')).toHaveLength(1);

    const rest = await startPayment(id, token, { payInFull: true }).expect(201);
    await payWithMock(rest.body.checkoutUrl as string);
    const confirmed = await getBooking(id, token);
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      paid: total,
      paymentPlan: { status: 'completed' },
    });
  });

  it('defaults a plan on a missed installment and refunds per policy, keeping the fee', async () => {
    ctx.config.INSTALLMENT_DEFAULT_FEE_BPS = 1000;
    const offer = await planQuote('installments');
    const { id, token, total } = await book(offer.quoteId);
    const plan = await post(`/v1/bookings/${id}/installment-plan`, token).expect(200);
    const installments = plan.body.paymentPlan.installments as { dueAt: string; amount: Money }[];
    const deposit = await startPayment(id, token).expect(201);
    await payWithMock(deposit.body.checkoutUrl as string);

    const missed = new Date(installments[1]?.dueAt ?? '');
    const run = await ctx.app
      .get(PaymentPlansService)
      .processDue(new Date(missed.getTime() + (ctx.config.INSTALLMENT_GRACE_HOURS + 1) * HOUR));
    expect(run.defaulted).toBe(1);
    await ctx.background.drain();

    const paid = installments[0]?.amount.amountMinor ?? 0;
    const fee = Math.floor(paid / 10);
    const booking = await getBooking(id, token);
    expect(booking.status).toBe('REFUNDED');
    expect(booking.refunds).toEqual([
      expect.objectContaining({
        status: 'completed',
        amount: { amountMinor: paid - fee, currency: total.currency },
      }),
    ]);
    expect(await balance(`fees:cancellation:${total.currency}`)).toBe(BigInt(fee));
    expect(await balance(`booking:${id}:${total.currency}`)).toBe(0n);
    expect([...ctx.app.get(MockFlightSupplier).holds.values()][0]).toMatchObject({
      cancelled: true,
    });
    expect(templates()).toEqual(
      expect.arrayContaining(['payment-plan-closed', 'refund-completed', 'ops-alert']),
    );
  });

  it('releases an unpaid hold at its deadline', async () => {
    const offer = await planQuote('hold');
    const { id, token } = await book(offer.quoteId);
    const held = await post(`/v1/bookings/${id}/hold`, token).expect(200);
    const deadline = new Date(held.body.paymentPlan.deadline as string);
    const run = await ctx.app
      .get(PaymentPlansService)
      .processDue(new Date(deadline.getTime() + 60_000));
    expect(run.defaulted + run.expired).toBe(1);
    expect((await getBooking(id, token)).status).toBe('EXPIRED');
    expect([...ctx.app.get(MockFlightSupplier).holds.values()][0]).toMatchObject({
      cancelled: true,
    });
  });

  it('refunds a partly paid plan when the traveller cancels', async () => {
    const offer = await planQuote('installments');
    const { id, token } = await book(offer.quoteId);
    await post(`/v1/bookings/${id}/installment-plan`, token).expect(200);
    const deposit = await startPayment(id, token).expect(201);
    await payWithMock(deposit.body.checkoutUrl as string);
    const cancelled = await post(`/v1/bookings/${id}/cancel`, token).expect(200);
    expect(cancelled.body.status).toBe('REFUND_PENDING');
    await ctx.background.drain();
    expect((await getBooking(id, token)).status).toBe('REFUNDED');
  });

  it('limits unpaid reservations per traveller', async () => {
    ctx.config.HOLD_MAX_ACTIVE = 1;
    try {
      const offer = await planQuote('hold');
      const first = await book(offer.quoteId);
      await post(`/v1/bookings/${first.id}/hold`, first.token).expect(200);
      const second = await book((await planQuote('hold')).quoteId);
      const refused = await post(`/v1/bookings/${second.id}/hold`, second.token).expect(409);
      expect(refused.body.type).toBe('urn:suskii:problem:hold-limit');
    } finally {
      ctx.config.HOLD_MAX_ACTIVE = 2;
    }
  });

  // -------------------------------------------------------------------------
  // Staff refunds (maker-checker) and the wallet
  // -------------------------------------------------------------------------

  it('needs a second person to approve a staff refund, and never refunds more than was paid', async () => {
    const { id, token, total } = await domesticBooking();
    const started = await startPayment(id, token, { provider: 'paystack' }).expect(201);
    const reference = (started.body.checkoutUrl as string).split('/').pop() ?? '';
    await paystackWebhook(chargeSuccess(paystack.pay(reference), reference)).expect(200);
    await ctx.background.drain();
    const paymentId = (
      await ctx.prisma.payment.findUniqueOrThrow({ where: { providerReference: reference } })
    ).id;

    const maker = await staff('maker@suskii.test', ['finance']);
    const checker = await staff('checker@suskii.test', ['finance']);
    const request = (amountMinor: number) =>
      ctx
        .http()
        .post(`/v1/admin/bookings/${id}/refunds`)
        .set('Idempotency-Key', idempotencyKey())
        .set(maker.headers)
        .send({
          paymentId,
          amount: { amountMinor, currency: total.currency },
          reason: 'goodwill',
          note: 'Seat issue',
        });

    await request(total.amountMinor + 1).expect(422);
    const created = await request(100_000).expect(201);
    expect(created.body).toMatchObject({
      status: 'pending_approval',
      automatic: false,
      requestedByUserId: maker.userId,
    });
    const own = await ctx
      .http()
      .post(`/v1/admin/refunds/${created.body.id as string}/approve`)
      .set(maker.headers)
      .expect(403);
    expect(own.body.type).toBe('urn:suskii:problem:maker-checker');
    await ctx
      .http()
      .post(`/v1/admin/refunds/${created.body.id as string}/approve`)
      .set(checker.headers)
      .expect(200);
    await ctx.background.drain();

    expect(paystack.refunds).toEqual([
      expect.objectContaining({
        amount: 100_000,
        note: `suskii-refund:${created.body.id as string}`,
      }),
    ]);
    const booking = await getBooking(id, token);
    expect(booking).toMatchObject({
      status: 'CONFIRMED',
      paid: { amountMinor: total.amountMinor - 100_000 },
    });
    const audit = await ctx.prisma.auditLog.findMany({
      where: { targetId: created.body.id as string },
    });
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['refund.created', 'refund.approved', 'refund.succeeded']),
    );
    expect(JSON.stringify(audit)).not.toContain('Seat issue');

    // Below the threshold a refund runs at once; the remaining balance still caps it.
    ctx.config.REFUND_APPROVAL_THRESHOLD_NGN = 10_000_000_00;
    const small = await request(50_000).expect(201);
    expect(small.body.status).toBe('approved');
    await request(total.amountMinor).expect(422);
  });

  it('refunds to the wallet and lets the wallet pay a whole booking', async () => {
    const traveller = await signUp(ctx, 'wallet@example.com');
    const account = bearer(traveller.accessToken);
    const first = await domesticBooking(account);
    const payment = await startPayment(first.id, account).expect(201);
    await payWithMock(payment.body.checkoutUrl as string);
    const paymentId = (
      await ctx.prisma.payment.findFirstOrThrow({
        where: { bookingId: first.id, status: 'succeeded' },
      })
    ).id;

    // Not enough in the wallet yet.
    const second = await domesticBooking(account);
    const refused = await startPayment(second.id, account, { useWallet: true }).expect(409);
    expect(refused.body.type).toBe('urn:suskii:problem:wallet-insufficient');

    const finance = await staff('finance@suskii.test', ['finance']);
    const approver = await staff('approver@suskii.test', ['super_admin']);
    const created = await ctx
      .http()
      .post(`/v1/admin/bookings/${first.id}/refunds`)
      .set('Idempotency-Key', idempotencyKey())
      .set(finance.headers)
      .send({
        paymentId,
        amount: first.total,
        destination: 'wallet',
        reason: 'customer_cancellation',
        cancelBooking: true,
      })
      .expect(201);
    await ctx
      .http()
      .post(`/v1/admin/refunds/${created.body.id as string}/approve`)
      .set(approver.headers)
      .expect(200);
    await ctx.background.drain();
    expect((await getBooking(first.id, account)).status).toBe('REFUNDED');

    const wallet = await ctx.http().get('/v1/me/wallet').set(account).expect(200);
    expect(wallet.body.balances).toEqual([first.total]);
    expect(wallet.body.movements[0]).toMatchObject({
      kind: 'refund_to_wallet',
      amount: first.total,
    });

    const paid = await startPayment(second.id, account, { useWallet: true }).expect(201);
    expect(paid.body).toMatchObject({
      status: 'succeeded',
      checkoutUrl: null,
      amount: second.total,
    });
    await ctx.background.drain();
    expect((await getBooking(second.id, account)).status).toBe('CONFIRMED');
    const after = await ctx.http().get('/v1/me/wallet').set(account).expect(200);
    expect(after.body.balances[0].amountMinor).toBe(
      first.total.amountMinor - second.total.amountMinor,
    );
  });
});
