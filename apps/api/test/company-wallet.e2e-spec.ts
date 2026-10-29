import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { PaymentReconciliationService } from '../src/bookings/payment-reconciliation.service';
import { LedgerReconciliationService } from '../src/finance/ledger-reconciliation.service';
import { MockPaymentProvider } from '../src/payments/mock-payment-provider';
import { PricingService } from '../src/pricing/pricing.service';

import { bearer, enrolTotp, grantRoles, PASSWORD, signUp, totp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * Company wallet (ADR-090): admins add funds by hosted checkout, credited only by the provider's
 * verified event (or reconciliation) at the amount it charged; the booker of a company trip pays
 * it from the wallet in one step, never overdrawing it; refunds of those trips go back to it; the
 * ledger reconciliation checks top-ups; admins and approvers see the wallet, nobody else.
 */

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };

let keySequence = 0;
const idempotencyKey = (): string => `e2e-company-wallet-${Date.now()}-${(keySequence += 1)}`;

const person = (givenNames: string, surname: string) => ({
  type: 'adult',
  title: 'mr',
  gender: 'm',
  givenNames,
  surname,
  dateOfBirth: '1988-02-01',
  nationality: 'NG',
  document: {
    number: `A${Math.floor(Math.random() * 1e7)}`,
    issuingCountry: 'NG',
    expiryDate: inDays(3650),
  },
});

interface Member {
  userId: string;
  email: string;
  auth: Record<string, string>;
}

describe('company wallet (e2e)', () => {
  let ctx: TestContext;
  let catalog: Record<string, string>;
  let lagosId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    const mock = ctx.app.get(MockPaymentProvider);
    mock.dropNextWebhooks = 0;
    catalog = await staff('catalog@suskii.test', ['content_manager', 'operations']);
    lagosId = (
      await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Lagos', countryCode: 'NG' } })
    ).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function staff(
    email: string,
    roles: Parameters<typeof grantRoles>[2],
  ): Promise<Record<string, string>> {
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
    return bearer(verified.body.accessToken as string);
  }

  async function account(email: string): Promise<Member> {
    const session = await signUp(ctx, email);
    await ctx.prisma.user.update({
      where: { id: session.userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { userId: session.userId, email, auth: bearer(session.accessToken) };
  }

  async function join(admin: Member, email: string, role: string): Promise<Member> {
    const member = await account(email);
    await ctx
      .http()
      .post('/v1/me/company/invitations')
      .set(admin.auth)
      .send({ email, role })
      .expect(201);
    await ctx.background.drain();
    const message = ctx.emails.outbox
      .filter((m) => m.to === email && m.template === 'company-invitation')
      .at(-1);
    const token = message?.text.match(/#invite=([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`no invitation for ${email}`);
    await ctx
      .http()
      .post('/v1/me/company/invitations/accept')
      .set(member.auth)
      .send({ token })
      .expect(200);
    return member;
  }

  /** A company with an admin, an approver, a booker and a traveller. */
  async function acme() {
    const admin = await account('ada@acme.test');
    const created = await ctx
      .http()
      .post('/v1/me/company')
      .set(admin.auth)
      .send({ name: 'Acme Logistics', countryCode: 'NG', billingEmail: 'accounts@acme.test' })
      .expect(201);
    const approver = await join(admin, 'bola@acme.test', 'approver');
    const booker = await join(admin, 'chidi@acme.test', 'booker');
    const traveller = await join(admin, 'dayo@acme.test', 'traveller');
    return { companyId: created.body.id as string, admin, approver, booker, traveller };
  }

  /** A published tour departing in 20 days, fully refundable, quoted for one adult. */
  async function tourQuote(naira = 30_000): Promise<string> {
    const created = await ctx
      .http()
      .post('/v1/admin/tours')
      .set(catalog)
      .send({
        slug: `lagos-walk-${(keySequence += 1)}`,
        title: 'Lagos walking tour',
        summary: 'Markets and history on foot.',
        cityId: lagosId,
        timeZone: 'Africa/Lagos',
        durationMinutes: 180,
        meetingPoint: { name: 'Tafawa Balewa Square', address: 'Lagos Island', notes: null },
        cancellationPolicy: [{ daysBefore: 0, refundBps: 10_000 }],
      })
      .expect(201);
    const tourId = created.body.id as string;
    const departure = await ctx
      .http()
      .post(`/v1/admin/tours/${tourId}/departures`)
      .set(catalog)
      .send({
        startsAtLocal: `${inDays(20)}T09:00`,
        capacity: 8,
        prices: { adult: ngn(naira), child: null, infant: null },
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/v1/admin/tours/${tourId}`)
      .set(catalog)
      .send({ status: 'published' })
      .expect(204);
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({
        kind: 'tour',
        departureId: departure.body.id,
        travellers: { adults: 1, children: 0, infants: 0 },
      })
      .expect(201);
    return quote.body.quoteId as string;
  }

  async function book(member: Member, companyTrip: boolean, naira = 30_000): Promise<string> {
    const quoteId = await tourQuote(naira);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .set(member.auth)
      .send({
        quoteId,
        contact: { email: member.email, phone: '+2348012345678' },
        passengers: [person('CHIDI', 'OKAFOR')],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        company: companyTrip,
      })
      .expect(201);
    return created.body.booking.id as string;
  }

  function pay(member: Member, bookingId: string, body: Record<string, unknown>) {
    return ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(member.auth)
      .send(body);
  }

  function startTopUp(member: Member, amount: { amountMinor: number; currency: string }) {
    return ctx
      .http()
      .post('/v1/me/company/wallet/top-ups')
      .set('Idempotency-Key', idempotencyKey())
      .set(member.auth)
      .send({ amount });
  }

  const referenceOf = (checkoutUrl: string): string => checkoutUrl.split('/').pop() ?? '';

  async function completeMock(checkoutUrl: string, outcome: 'succeeded' | 'failed') {
    await ctx
      .http()
      .post(`/v1/payments/mock/${referenceOf(checkoutUrl)}/complete`)
      .send({ outcome })
      .expect(200);
    await ctx.background.drain();
  }

  /** Adds funds through the mock provider's signed-webhook path. */
  async function fund(admin: Member, naira: number): Promise<string> {
    const started = await startTopUp(admin, ngn(naira)).expect(201);
    await completeMock(started.body.checkoutUrl as string, 'succeeded');
    return started.body.id as string;
  }

  const walletBalance = async (companyId: string): Promise<bigint> =>
    (
      await ctx.prisma.ledgerAccount.findUnique({
        where: { code: `company-wallet:${companyId}:NGN` },
      })
    )?.balanceMinor ?? 0n;

  const getBooking = async (member: Member, bookingId: string) =>
    (await ctx.http().get(`/v1/bookings/${bookingId}`).set(member.auth).expect(200)).body as {
      status: string;
      paymentOptions: { companyWallet: { covers: boolean } | null } | null;
      refunds: { destination: string; amount: unknown }[];
    };

  it('adds funds only when the provider confirms, once, and shows them to admins and approvers', async () => {
    const { companyId, admin, approver, booker, traveller } = await acme();

    const empty = await ctx.http().get('/v1/me/company/wallet').set(admin.auth).expect(200);
    expect(empty.body).toMatchObject({ balances: [], canTopUp: true, topUpsPerDay: 5 });
    expect(empty.body.topUpOptions).toContainEqual({
      currency: 'NGN',
      min: ngn(10_000),
      max: ngn(5_000_000),
    });
    const seen = await ctx.http().get('/v1/me/company/wallet').set(approver.auth).expect(200);
    expect(seen.body.canTopUp).toBe(false);
    for (const member of [booker, traveller]) {
      const denied = await ctx.http().get('/v1/me/company/wallet').set(member.auth);
      expect(denied.status).toBe(403);
      expect(denied.body.type).toContain('company-approver-required');
    }
    const outsider = await account('mallory@example.com');
    await ctx.http().get('/v1/me/company/wallet').set(outsider.auth).expect(404);

    // Only admins start a top-up; the key is required; amounts and currencies are checked.
    const notAdmin = await startTopUp(approver, ngn(50_000));
    expect(notAdmin.status).toBe(403);
    expect(notAdmin.body.type).toContain('company-admin-required');
    await ctx
      .http()
      .post('/v1/me/company/wallet/top-ups')
      .set(admin.auth)
      .send({ amount: ngn(50_000) })
      .expect(400);
    const small = await startTopUp(admin, ngn(9_999));
    expect(small.status).toBe(422);
    expect(small.body.type).toContain('company-top-up-amount');
    const large = await startTopUp(admin, ngn(5_000_001));
    expect(large.body.type).toContain('company-top-up-amount');
    const currency = await startTopUp(admin, { amountMinor: 5_000_000, currency: 'KES' });
    expect(currency.status).toBe(422);
    expect(currency.body.type).toContain('company-top-up-currency');

    const started = await startTopUp(admin, ngn(100_000)).expect(201);
    expect(started.body).toMatchObject({
      reference: expect.stringMatching(/^W-[A-Z0-9]{6}$/),
      status: 'pending',
      amount: ngn(100_000),
      received: null,
      checkoutUrl: expect.stringContaining('/checkout/mock-payment/'),
    });
    const topUpId = started.body.id as string;
    // The mock page names the top-up, not a booking; nothing is credited yet.
    const page = await ctx
      .http()
      .get(`/v1/payments/mock/${referenceOf(started.body.checkoutUrl as string)}`)
      .expect(200);
    expect(page.body).toMatchObject({
      bookingReference: started.body.reference,
      amount: ngn(100_000),
      returnUrl: expect.stringContaining(`/account/company?topUp=${topUpId}`),
    });
    expect(await walletBalance(companyId)).toBe(0n);
    // Approvers follow it; the payment page stays with the admin who started it.
    const followed = await ctx
      .http()
      .get(`/v1/me/company/wallet/top-ups/${topUpId}`)
      .set(approver.auth)
      .expect(200);
    expect(followed.body).toMatchObject({ status: 'pending', checkoutUrl: null });

    // A replayed webhook never credits twice.
    const mock = ctx.app.get(MockPaymentProvider);
    const reference = referenceOf(started.body.checkoutUrl as string);
    const amount = { minor: 10_000_000n, currency: 'NGN' };
    mock.recordOutcome(reference, 'succeeded', amount);
    const event = mock.signedEvent(reference, 'succeeded', amount);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await ctx
        .http()
        .post('/v1/payments/webhooks/mock')
        .set('Content-Type', 'application/json')
        .set(event.headers as Record<string, string>)
        .send(event.rawBody.toString('utf8'))
        .expect(200);
    }
    const again = mock.signedEvent(reference, 'succeeded', amount);
    await ctx
      .http()
      .post('/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set(again.headers as Record<string, string>)
      .send(again.rawBody.toString('utf8'))
      .expect(200);
    expect(await walletBalance(companyId)).toBe(10_000_000n);
    expect(
      await ctx.prisma.ledgerTransaction.count({ where: { kind: 'company_topup_captured' } }),
    ).toBe(1);

    const wallet = await ctx.http().get('/v1/me/company/wallet').set(admin.auth).expect(200);
    expect(wallet.body.balances).toEqual([ngn(100_000)]);
    expect(wallet.body.movements).toEqual([
      expect.objectContaining({
        kind: 'company_topup_captured',
        amount: ngn(100_000),
        bookingId: null,
        bookingReference: null,
      }),
    ]);
    expect(wallet.body.topUps).toEqual([
      expect.objectContaining({ id: topUpId, status: 'succeeded', checkoutUrl: null }),
    ]);

    // A declined top-up credits nothing.
    const declined = await startTopUp(admin, ngn(20_000)).expect(201);
    await completeMock(declined.body.checkoutUrl as string, 'failed');
    const failed = await ctx
      .http()
      .get(`/v1/me/company/wallet/top-ups/${declined.body.id as string}`)
      .set(admin.auth)
      .expect(200);
    expect(failed.body.status).toBe('failed');
    expect(await walletBalance(companyId)).toBe(10_000_000n);

    // The console sees balances and recent top-ups.
    const support = await staff('support@suskii.test', ['support']);
    const detail = await ctx
      .http()
      .get(`/v1/admin/companies/${companyId}`)
      .set(support)
      .expect(200);
    expect(detail.body.walletBalances).toEqual([ngn(100_000)]);
    expect(detail.body.recentTopUps.map((t: { status: string }) => t.status)).toEqual([
      'failed',
      'succeeded',
    ]);
    expect(detail.body.recentTopUps[0]).not.toHaveProperty('checkoutUrl');

    // The ledger reconciliation agrees with the provider.
    const run = await ctx.app.get(LedgerReconciliationService).run();
    expect(run.discrepancies).toBe(0);
    expect(
      await ctx.prisma.companyWalletTopUp.count({ where: { ledgerCheckedAt: { not: null } } }),
    ).toBe(1);

    const audit = await ctx.prisma.auditLog.findMany({
      where: { action: { startsWith: 'company_wallet.' }, targetId: companyId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { action: true, actorUserId: true, metadata: true },
    });
    expect(audit.map((row) => row.action)).toEqual([
      'company_wallet.topup_started',
      'company_wallet.topped_up',
      'company_wallet.topup_started',
    ]);
    expect(audit[0]?.actorUserId).toBe(admin.userId);
    expect(JSON.stringify(audit)).not.toContain('ada@acme.test');
  });

  it('credits what the provider charged, recovers lost webhooks and caps top-ups per day', async () => {
    const { companyId, admin } = await acme();
    const mock = ctx.app.get(MockPaymentProvider);

    // The provider charged a different amount: that amount is credited and audited.
    const started = await startTopUp(admin, ngn(100_000)).expect(201);
    const reference = referenceOf(started.body.checkoutUrl as string);
    const charged = { minor: 9_000_000n, currency: 'NGN' };
    mock.recordOutcome(reference, 'succeeded', charged);
    const event = mock.signedEvent(reference, 'succeeded', charged);
    await ctx
      .http()
      .post('/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set(event.headers as Record<string, string>)
      .send(event.rawBody.toString('utf8'))
      .expect(200);
    expect(await walletBalance(companyId)).toBe(9_000_000n);
    const mismatch = await ctx
      .http()
      .get(`/v1/me/company/wallet/top-ups/${started.body.id as string}`)
      .set(admin.auth)
      .expect(200);
    expect(mismatch.body).toMatchObject({
      status: 'succeeded',
      amount: ngn(100_000),
      received: ngn(90_000),
    });
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'company_wallet.topup_amount_mismatch', targetId: companyId },
      }),
    ).toBe(1);
    // ...and the reconciliation compares against what was charged.
    expect((await ctx.app.get(LedgerReconciliationService).run()).discrepancies).toBe(0);

    // The webhook never arrives: reconciliation asks the provider and credits it.
    const lost = await startTopUp(admin, ngn(50_000)).expect(201);
    mock.dropNextWebhooks = 1;
    await completeMock(lost.body.checkoutUrl as string, 'succeeded');
    expect(await walletBalance(companyId)).toBe(9_000_000n);
    const run = await ctx.app
      .get(PaymentReconciliationService)
      .reconcileDue(new Date(Date.now() + 16 * 60_000));
    expect(run).toEqual({ checked: 1, settled: 1 });
    expect(await walletBalance(companyId)).toBe(14_000_000n);
    expect(
      await ctx.prisma.webhookEvent.findFirst({
        where: { eventId: `reconcile:${referenceOf(lost.body.checkoutUrl as string)}:succeeded` },
      }),
    ).not.toBeNull();

    // Five top-ups in 24 hours at most (two above, three more), then 409.
    for (let index = 0; index < 3; index += 1) await startTopUp(admin, ngn(10_000)).expect(201);
    const capped = await startTopUp(admin, ngn(10_000));
    expect(capped.status).toBe(409);
    expect(capped.body.type).toContain('company-top-up-limit');

    // A suspended company adds no funds and cannot spend them.
    await ctx.prisma.company.update({ where: { id: companyId }, data: { status: 'suspended' } });
    const wallet = await ctx.http().get('/v1/me/company/wallet').set(admin.auth).expect(200);
    expect(wallet.body.canTopUp).toBe(false);
    await ctx.prisma.companyWalletTopUp.deleteMany({ where: { status: 'pending' } });
    const suspended = await startTopUp(admin, ngn(10_000));
    expect(suspended.status).toBe(409);
    expect(suspended.body.type).toContain('company-suspended');
  });

  it("pays the booker's company trips from the wallet, never overdrawn, and refunds to it", async () => {
    const { companyId, admin, approver, booker } = await acme();
    const first = await book(booker, true);

    // Nothing in the wallet yet: the option says so and paying answers 409.
    expect((await getBooking(booker, first)).paymentOptions?.companyWallet).toEqual({
      covers: false,
    });
    const short = await pay(booker, first, { useCompanyWallet: true });
    expect(short.status).toBe(409);
    expect(short.body.type).toContain('company-wallet-insufficient');

    await fund(admin, 70_000);
    expect((await getBooking(booker, first)).paymentOptions?.companyWallet).toEqual({
      covers: true,
    });
    // Personal trips cannot use it; other people's bookings are not theirs to load.
    const personal = await book(booker, false);
    expect((await getBooking(booker, personal)).paymentOptions?.companyWallet).toBeNull();
    const refused = await pay(booker, personal, { useCompanyWallet: true });
    expect(refused.status).toBe(409);
    expect(refused.body.type).toContain('company-wallet-unavailable');
    await pay(approver, first, { useCompanyWallet: true }).expect(404);

    const paid = await pay(booker, first, { useCompanyWallet: true }).expect(201);
    expect(paid.body).toMatchObject({
      status: 'succeeded',
      checkoutUrl: null,
      amount: ngn(30_000),
    });
    await ctx.background.drain();
    expect((await getBooking(booker, first)).status).toBe('CONFIRMED');
    expect(await walletBalance(companyId)).toBe(4_000_000n);
    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { id: paid.body.paymentId as string },
    });
    expect(payment).toMatchObject({ kind: 'company_wallet', provider: 'company_wallet' });

    // Two trips at once against ₦40,000: one is paid, the other is refused; never negative.
    const second = await book(booker, true);
    const third = await book(booker, true);
    const results = await Promise.all([
      pay(booker, second, { useCompanyWallet: true }),
      pay(booker, third, { useCompanyWallet: true }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.type).toContain(
      'company-wallet-insufficient',
    );
    expect(await walletBalance(companyId)).toBe(1_000_000n);

    // Cancelling a wallet-paid trip refunds the company wallet, not a card.
    const cancelled = await ctx
      .http()
      .post(`/v1/bookings/${first}/cancel`)
      .set(booker.auth)
      .expect(200);
    expect(cancelled.body.refunds).toEqual([
      expect.objectContaining({ destination: 'company_wallet', amount: ngn(30_000) }),
    ]);
    await ctx.background.drain();
    await ctx.http().post('/v1/internal/bookings/refunds-due').set(INTERNAL).expect(200);
    await ctx.background.drain();
    expect(await walletBalance(companyId)).toBe(4_000_000n);
    expect((await getBooking(booker, first)).status).toBe('REFUNDED');

    const wallet = await ctx.http().get('/v1/me/company/wallet').set(approver.auth).expect(200);
    const kinds = (
      wallet.body.movements as { kind: string; bookingReference: string | null }[]
    ).map((movement) => movement.kind);
    expect(kinds).toEqual([
      'refund_to_company_wallet',
      'company_wallet_payment',
      'company_wallet_payment',
      'company_topup_captured',
    ]);
    expect(
      (wallet.body.movements as { bookingReference: string | null }[])
        .slice(0, 3)
        .every((movement) => movement.bookingReference !== null),
    ).toBe(true);
    expect((await ctx.app.get(LedgerReconciliationService).run()).discrepancies).toBe(0);

    // Someone who leaves the company can no longer spend its money.
    const fourth = await book(booker, true);
    const members = await ctx.http().get('/v1/me/company/members').set(admin.auth).expect(200);
    const membership = (members.body.members as { id: string; userId: string }[]).find(
      (member) => member.userId === booker.userId,
    );
    await ctx
      .http()
      .delete(`/v1/me/company/members/${membership?.id ?? ''}`)
      .set(admin.auth)
      .expect(204);
    expect((await getBooking(booker, fourth)).paymentOptions?.companyWallet).toBeNull();
    const left = await pay(booker, fourth, { useCompanyWallet: true });
    expect(left.status).toBe(409);
    expect(left.body.type).toContain('company-wallet-unavailable');
    expect(await walletBalance(companyId)).toBe(4_000_000n);

    const paidAudit = await ctx.prisma.auditLog.findMany({
      where: { action: 'company_wallet.paid', actorUserId: booker.userId },
      select: { actorUserId: true, metadata: true },
    });
    expect(paidAudit).toHaveLength(2);
    expect(paidAudit.every((row) => row.actorUserId === booker.userId)).toBe(true);
  });
});
