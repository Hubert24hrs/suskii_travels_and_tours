import { money } from '@suskii/shared';

import { CheckoutService } from '../src/bookings/checkout.service';
import { driverPayoutContext } from '../src/crypto/encryption-contexts';
import { FieldEncryption } from '../src/crypto/field-encryption';
import { DriverPayoutsService } from '../src/finance/driver-payouts.service';
import { LedgerReconciliationService } from '../src/finance/ledger-reconciliation.service';
import { MockPayoutProvider } from '../src/ground/payouts';
import { LedgerService, transfer } from '../src/ledger/ledger.service';
import { MockPaymentProvider } from '../src/payments/mock-payment-provider';

import {
  book,
  busInventory,
  nextKey,
  passenger,
  staffSession,
  type BusInventory,
} from './helpers/cars';
import { driverSession, VICTORIA_ISLAND } from './helpers/rides';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

interface Discrepancy {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  expected: { amountMinor: number; currency: string } | null;
  actual: { amountMinor: number; currency: string } | null;
  status: string;
  resolution: string | null;
}

/**
 * Cars P6 (ADR-051): money for buses, rides and rentals runs on the one payment pipeline.
 * A replayed webhook posts once; a payment that arrives after the hold expired is refunded
 * automatically; the reconciliation sweep finds planted mismatches between payments, the ledger
 * and the provider and hands them to finance; driver earnings are paid out in batches through
 * the ledger, once, with failures put back.
 */
describe('cars payments (e2e)', () => {
  let ctx: TestContext;
  let staff: Record<string, string>;
  let finance: Record<string, string>;
  let inventory: BusInventory;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      DRIVER_PAYOUT_MIN_MINOR: 100_000,
      OPS_ALERT_EMAIL: 'ops@suskii.test',
    });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    staff = (await staffSession(ctx, 'ground@suskii.test', ['operations'])).headers;
    finance = (await staffSession(ctx, 'finance@suskii.test', ['finance'])).headers;
    inventory = await busInventory(ctx, staff);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    await ctx.close();
  });

  const mock = () => ctx.app.get(MockPaymentProvider);
  const reconcile = () => ctx.app.get(LedgerReconciliationService).run();
  const payouts = () => ctx.app.get(DriverPayoutsService).run();
  const balance = async (code: string): Promise<bigint> =>
    (await ctx.prisma.ledgerAccount.findUnique({ where: { code } }))?.balanceMinor ?? 0n;

  /** A guest bus booking with a started (unpaid) checkout. */
  async function unpaidBusBooking(seats = ['4A']) {
    const held = await ctx
      .http()
      .post(`/v1/buses/trips/${inventory.tripId}/holds`)
      .send({ seats })
      .expect(201);
    const quoted = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({ kind: 'bus', holdId: held.body.holdId, holdToken: held.body.holdToken })
      .expect(201);
    const created = await book(ctx, {
      quoteId: quoted.body.quoteId,
      passengers: seats.map(() => passenger('Ada', 'Okafor')),
    }).expect(201);
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const bookingId = created.body.booking.id as string;
    const started = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', nextKey('e2e-cars-pay'))
      .set(token)
      .send({})
      .expect(201);
    const reference = (started.body.checkoutUrl as string).split('/').pop() ?? '';
    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { providerReference: reference },
    });
    return { bookingId, token, reference, payment };
  }

  const deliver = (event: ReturnType<MockPaymentProvider['signedEvent']>) =>
    ctx
      .http()
      .post('/v1/payments/webhooks/mock')
      .set('Content-Type', 'application/json')
      .set(event.headers as Record<string, string>)
      .send(event.rawBody.toString('utf8'))
      .expect(200);

  it('posts a replayed bus payment webhook to the ledger once', async () => {
    const { bookingId, token, reference, payment } = await unpaidBusBooking(['4A', '4B']);
    const amount = money(payment.amountMinor, payment.currency);
    const event = mock().signedEvent(reference, 'succeeded', amount);
    await Promise.all([deliver(event), deliver(event)]);
    await deliver(event);
    // A new delivery id for the same payment is a duplicate too.
    await deliver(mock().signedEvent(reference, 'succeeded', amount));
    await ctx.background.drain();

    const booking = await ctx.http().get(`/v1/bookings/${bookingId}`).set(token).expect(200);
    expect(booking.body.status).toBe('CONFIRMED');
    expect(
      await ctx.prisma.ledgerTransaction.count({
        where: { bookingId, kind: 'payment_captured' },
      }),
    ).toBe(1);
    expect(await balance(`booking:${bookingId}:NGN`)).toBe(payment.amountMinor);
    expect(await balance('psp:mock:NGN')).toBe(payment.amountMinor);
    expect(await ctx.prisma.refund.count()).toBe(0);
    // The sweep finds the payment, its posting and the provider in agreement.
    const run = await reconcile();
    expect(run).toMatchObject({ checked: 1, discrepancies: 0 });
    expect(await ctx.prisma.reconciliationDiscrepancy.count()).toBe(0);
  });

  it('refunds a payment that arrives after the bus hold expired, and keeps the seats free', async () => {
    const { bookingId, token, reference, payment } = await unpaidBusBooking(['5C']);
    await ctx.prisma.booking.update({
      where: { id: bookingId },
      data: { paymentDeadline: new Date(Date.now() - 60 * 60_000) },
    });
    expect(await ctx.app.get(CheckoutService).expireDue()).toBe(1);
    expect((await ctx.http().get(`/v1/bookings/${bookingId}`).set(token)).body.status).toBe(
      'EXPIRED',
    );
    const seatMap = async () =>
      (await ctx.http().get(`/v1/buses/trips/${inventory.tripId}`).expect(200)).body as {
        seatsLeft: number;
      };
    const seatsBefore = (await seatMap()).seatsLeft;

    // The traveller completes the old checkout anyway.
    await deliver(
      mock().signedEvent(reference, 'succeeded', money(payment.amountMinor, payment.currency)),
    );
    await ctx.background.drain();

    const paid = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid).toMatchObject({ status: 'succeeded', requiresRefund: true });
    const refunds = await ctx.prisma.refund.findMany({ where: { paymentId: payment.id } });
    expect(refunds).toEqual([
      expect.objectContaining({
        reason: 'late_payment',
        automatic: true,
        source: 'unapplied',
        status: 'succeeded',
        amountMinor: payment.amountMinor,
      }),
    ]);
    // Received, held as unapplied, refunded: nothing left anywhere.
    expect(await balance('unapplied:NGN')).toBe(0n);
    expect(await balance('psp:mock:NGN')).toBe(0n);
    expect((await ctx.http().get(`/v1/bookings/${bookingId}`).set(token)).body.status).toBe(
      'EXPIRED',
    );
    expect((await seatMap()).seatsLeft).toBe(seatsBefore);
    expect(await ctx.prisma.busTicket.count({ where: { tripId: inventory.tripId } })).toBe(0);
    // The late payment and its refund reconcile cleanly.
    expect((await reconcile()).discrepancies).toBe(0);
  });

  describe('ledger reconciliation', () => {
    /** A captured payment row for a booking, as if a webhook had been applied. */
    async function capturedPayment(bookingId: string, amountMinor: bigint, status = 'succeeded') {
      return ctx.prisma.payment.create({
        data: {
          bookingId,
          provider: 'mock',
          providerReference: nextKey('mock-recon'),
          status: status as 'succeeded',
          amountMinor,
          currency: 'NGN',
          expiresAt: new Date(Date.now() + 60_000),
          succeededAt: new Date(),
        },
      });
    }

    /** Posts a capture for a payment with any amount (a deliberately wrong entry). */
    const postCapture = (paymentId: string, bookingId: string, amountMinor: bigint) =>
      ctx.prisma.$transaction((tx) =>
        ctx.app.get(LedgerService).post(tx, {
          key: `payment:${paymentId}:captured`,
          kind: 'payment_unapplied',
          bookingId,
          paymentId,
          lines: transfer(
            { kind: 'psp', provider: 'mock', currency: 'NGN' },
            { kind: 'unapplied', currency: 'NGN' },
            money(amountMinor, 'NGN'),
          ),
        }),
      );

    const list = async (status = 'open'): Promise<Discrepancy[]> =>
      (
        await ctx
          .http()
          .get('/v1/admin/finance/discrepancies')
          .query({ status })
          .set(finance)
          .expect(200)
      ).body.discrepancies as Discrepancy[];

    it('finds mismatched, missing and orphaned entries and a provider that disagrees', async () => {
      const { bookingId } = await unpaidBusBooking(['6A']);
      // 1. Booked for less than the payment says.
      const short = await capturedPayment(bookingId, 1_000_000n);
      await postCapture(short.id, bookingId, 900_000n);
      // 2. Captured with no posting at all.
      const missing = await capturedPayment(bookingId, 500_000n);
      // 3. Posted correctly, but the provider reports a different amount.
      const differs = await capturedPayment(bookingId, 700_000n);
      await postCapture(differs.id, bookingId, 700_000n);
      mock().recordOutcome(differs.providerReference, 'succeeded', money(650_000n, 'NGN'));
      // 4. Money in the ledger for a payment we hold as failed.
      const orphan = await capturedPayment(bookingId, 300_000n, 'failed');
      await postCapture(orphan.id, bookingId, 300_000n);
      // 5. Correct everywhere.
      const fine = await capturedPayment(bookingId, 400_000n);
      await postCapture(fine.id, bookingId, 400_000n);
      mock().recordOutcome(fine.providerReference, 'succeeded', money(400_000n, 'NGN'));

      const run = await reconcile();
      expect(run).toMatchObject({ checked: 4, discrepancies: 4 });
      const found = await list();
      const bySubject = (id: string) => found.filter((row) => row.subjectId === id);
      expect(bySubject(short.id)).toEqual([
        expect.objectContaining({
          kind: 'ledger_amount',
          expected: { amountMinor: 1_000_000, currency: 'NGN' },
          actual: { amountMinor: 900_000, currency: 'NGN' },
        }),
      ]);
      expect(bySubject(missing.id)).toEqual([
        expect.objectContaining({ kind: 'ledger_missing', actual: null }),
      ]);
      expect(bySubject(differs.id)).toEqual([
        expect.objectContaining({
          kind: 'provider_amount',
          expected: { amountMinor: 700_000, currency: 'NGN' },
          actual: { amountMinor: 650_000, currency: 'NGN' },
        }),
      ]);
      expect(bySubject(orphan.id)).toEqual([
        expect.objectContaining({ kind: 'orphan_ledger', expected: null }),
      ]);
      expect(bySubject(fine.id)).toEqual([]);
      // Operations hear about it once per sweep.
      expect(ctx.emails.outbox.filter((message) => message.template === 'ops-alert')).toHaveLength(
        1,
      );

      // A second sweep raises nothing new (the orphan is seen again, not duplicated).
      expect((await reconcile()).discrepancies).toBe(0);
      expect(await ctx.prisma.reconciliationDiscrepancy.count()).toBe(4);

      // Accepted stays resolved; resolving twice is a conflict.
      const accepted = bySubject(differs.id)[0]?.id ?? '';
      await ctx
        .http()
        .post(`/v1/admin/finance/discrepancies/${accepted}/resolve`)
        .set(finance)
        .send({ resolution: 'accepted' })
        .expect(204);
      await ctx
        .http()
        .post(`/v1/admin/finance/discrepancies/${accepted}/resolve`)
        .set(finance)
        .send({ resolution: 'accepted' })
        .expect(409);
      // Marked corrected without fixing anything: the next sweep checks again and reopens it.
      const corrected = bySubject(short.id)[0]?.id ?? '';
      await ctx
        .http()
        .post(`/v1/admin/finance/discrepancies/${corrected}/resolve`)
        .set(finance)
        .send({ resolution: 'corrected' })
        .expect(204);
      expect((await reconcile()).discrepancies).toBe(1);
      const reopened = (await list()).find((row) => row.id === corrected);
      expect(reopened).toMatchObject({ status: 'open', resolution: null });
      expect((await list('resolved')).map((row) => row.id)).toEqual([accepted]);
      const audit = await ctx.prisma.auditLog.findMany({
        where: { action: 'reconciliation.discrepancy_resolved' },
      });
      expect(audit.map((entry) => entry.metadata)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ resolution: 'accepted', kind: 'provider_amount' }),
          expect.objectContaining({ resolution: 'corrected', kind: 'ledger_amount' }),
        ]),
      );
      await ctx
        .http()
        .post(`/v1/admin/finance/discrepancies/${corrected}/resolve`)
        .set(staff)
        .send({ resolution: 'accepted' })
        .expect(403);
    });
  });

  describe('driver payouts', () => {
    /** Earnings credited as a completed ride would (`ride_earnings`). */
    const earn = (driverId: string, amountMinor: bigint) =>
      ctx.prisma.$transaction((tx) =>
        ctx.app.get(LedgerService).post(tx, {
          key: nextKey('e2e-earnings'),
          kind: 'ride_earnings',
          lines: transfer(
            { kind: 'psp', provider: 'mock', currency: 'NGN' },
            { kind: 'driver-earnings', driverId, currency: 'NGN' },
            money(amountMinor, 'NGN'),
          ),
        }),
      );

    /** Bank details written as the payout-account route stores them (encrypted, timestamped). */
    const setAccount = (driverId: string, accountNumber: string) =>
      ctx.prisma.driver.update({
        where: { id: driverId },
        data: {
          payoutAccountEncrypted: ctx.app
            .get(FieldEncryption)
            .encrypt(
              JSON.stringify({ bankCode: '058', accountNumber, accountName: 'Tunde Bakare' }),
              driverPayoutContext(driverId),
            ),
          payoutAccountUpdatedAt: new Date(),
        },
      });

    async function driverWithAccount(email: string, accountNumber: string) {
      const driver = await driverSession(ctx, email, VICTORIA_ISLAND);
      await setAccount(driver.driverId, accountNumber);
      return driver;
    }

    it('pays due earnings once in one batch, and puts a rejected payout back', async () => {
      const provider = ctx.app.get(MockPayoutProvider);
      const paid = await driverWithAccount('paid-driver@example.com', '0123456789');
      const rejected = await driverWithAccount('rejected-driver@example.com', '0123450000');
      const small = await driverWithAccount('small-driver@example.com', '0123451111');
      const noAccount = await driverSession(ctx, 'no-account@example.com', VICTORIA_ISLAND);
      const suspended = await driverWithAccount('suspended@example.com', '0123452222');
      await ctx.prisma.driver.update({
        where: { id: suspended.driverId },
        data: { status: 'suspended' },
      });
      await earn(paid.driverId, 250_000n);
      await earn(paid.driverId, 100_000n);
      await earn(rejected.driverId, 400_000n);
      await earn(small.driverId, 50_000n);
      await earn(noAccount.driverId, 300_000n);
      await earn(suspended.driverId, 300_000n);
      const batchesBefore = provider.batches.length;

      // Two runs at once: the earnings lock and the one-pending index pay each driver once.
      const [first, second] = await Promise.all([payouts(), payouts()]);
      expect(first.sent + second.sent).toBe(2);
      expect(first.paid + second.paid).toBe(1);
      expect(first.failed + second.failed).toBe(1);
      expect(provider.batches.length - batchesBefore).toBeLessThanOrEqual(2);

      const rows = await ctx.prisma.driverPayout.findMany({ orderBy: { amountMinor: 'asc' } });
      expect(rows).toEqual([
        expect.objectContaining({ driverId: paid.driverId, amountMinor: 350_000n, status: 'paid' }),
        expect.objectContaining({
          driverId: rejected.driverId,
          amountMinor: 400_000n,
          status: 'failed',
          failureReason: 'account_rejected',
        }),
      ]);
      // Paid out of our provider balance; the rejected one is back in the driver's earnings.
      expect(await balance(`driver-earnings:${paid.driverId}:NGN`)).toBe(0n);
      expect(await balance(`driver-earnings:${rejected.driverId}:NGN`)).toBe(400_000n);
      expect(await balance(`driver-earnings:${small.driverId}:NGN`)).toBe(50_000n);
      expect(await balance('payouts-in-flight:mock:NGN')).toBe(0n);

      // Nothing is due again: paid drivers have no balance; the rejected one waits for new details.
      expect(await payouts()).toEqual({ sent: 0, paid: 0, failed: 0, pending: 0 });
      await setAccount(rejected.driverId, '0123459876');
      expect(await payouts()).toMatchObject({ sent: 1, paid: 1 });
      expect(await balance(`driver-earnings:${rejected.driverId}:NGN`)).toBe(0n);

      // The driver sees the payouts, and finance sees them without bank details.
      const earnings = await ctx
        .http()
        .get('/v1/drivers/me/earnings')
        .set(paid.headers)
        .expect(200);
      expect(earnings.body.balance).toEqual({ amountMinor: 0, currency: 'NGN' });
      expect(earnings.body.summary).toMatchObject({
        timeZone: 'Africa/Lagos',
        today: { amountMinor: 350_000, currency: 'NGN' },
        last7Days: { amountMinor: 350_000, currency: 'NGN' },
      });
      expect(earnings.body.payouts).toEqual([
        expect.objectContaining({
          amount: { amountMinor: 350_000, currency: 'NGN' },
          status: 'paid',
        }),
      ]);
      const list = await ctx.http().get('/v1/admin/finance/payouts').set(finance).expect(200);
      expect(list.body.payouts).toHaveLength(3);
      expect(JSON.stringify(list.body)).not.toContain('0123456789');
      await ctx.http().get('/v1/admin/finance/payouts').set(staff).expect(403);

      // Every finished payout matches its postings.
      expect((await reconcile()).discrepancies).toBe(0);
    });

    it('follows up a payout the bank has not answered and resends one the provider lost', async () => {
      const provider = ctx.app.get(MockPayoutProvider);
      const slow = await driverWithAccount('slow-driver@example.com', '0123459999');
      const lost = await driverWithAccount('lost-driver@example.com', '0123453333');
      await earn(slow.driverId, 200_000n);
      await earn(lost.driverId, 150_000n);

      // The batch never reaches the provider: both stay pending, their money in flight.
      provider.loseNextBatches = 1;
      expect(await payouts()).toEqual({ sent: 2, paid: 0, failed: 0, pending: 2 });
      expect(await balance('payouts-in-flight:mock:NGN')).toBe(350_000n);
      // While a payout is pending, new earnings wait: no second payout opens.
      await earn(slow.driverId, 150_000n);

      // The provider knows neither: both are resent with their own references. The bank pays
      // one at once and is still working on the other.
      expect(await payouts()).toEqual({ sent: 0, paid: 1, failed: 0, pending: 1 });
      expect(await ctx.prisma.driverPayout.count()).toBe(2);
      expect(await balance(`driver-earnings:${slow.driverId}:NGN`)).toBe(150_000n);
      const resent = await ctx.prisma.driverPayout.findMany({ orderBy: { createdAt: 'asc' } });
      expect(resent.map((row) => row.attempts)).toEqual([2, 2]);

      // The bank finishes; the waiting earnings go out in the same run (and wait at the bank).
      provider.settlePending();
      expect(await payouts()).toEqual({ sent: 1, paid: 1, failed: 0, pending: 1 });
      provider.settlePending();
      expect(await payouts()).toEqual({ sent: 0, paid: 1, failed: 0, pending: 0 });
      const rows = await ctx.prisma.driverPayout.findMany();
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.status === 'paid')).toBe(true);
      expect(await balance('payouts-in-flight:mock:NGN')).toBe(0n);
      expect(await balance(`driver-earnings:${slow.driverId}:NGN`)).toBe(0n);
      expect(await balance(`driver-earnings:${lost.driverId}:NGN`)).toBe(0n);
      expect((await reconcile()).discrepancies).toBe(0);
    });
  });
});
