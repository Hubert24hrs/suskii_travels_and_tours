import { randomUUID } from 'node:crypto';

import { money } from '@suskii/shared';

import { InsufficientBalanceError, LedgerService, transfer } from '../src/ledger/ledger.service';

import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/** Ledger invariants enforced by the database (ADR-017). */
describe('double-entry ledger (e2e)', () => {
  let ctx: TestContext;
  let ledger: LedgerService;

  beforeAll(async () => {
    ctx = await createTestApp();
    ledger = ctx.app.get(LedgerService);
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const bookingId = randomUUID();
  const psp = { kind: 'psp', provider: 'mock', currency: 'NGN' } as const;
  const booking = { kind: 'booking', bookingId, currency: 'NGN' } as const;
  const unapplied = { kind: 'unapplied', currency: 'NGN' } as const;

  it('posts balanced transactions and keeps balances in each account normal direction', async () => {
    await ctx.prisma.$transaction((tx) =>
      ledger.post(tx, {
        key: 'payment:1:captured',
        kind: 'payment_captured',
        bookingId,
        lines: transfer(psp, booking, money(50_000_00n, 'NGN')),
      }),
    );
    expect((await ledger.balance(ctx.prisma, psp)).minor).toBe(50_000_00n);
    expect((await ledger.balance(ctx.prisma, booking)).minor).toBe(50_000_00n);
  });

  it('posts each key once, however often it is replayed', async () => {
    const post = () =>
      ctx.prisma.$transaction((tx) =>
        ledger.post(tx, {
          key: 'payment:2:captured',
          kind: 'payment_captured',
          lines: transfer(psp, booking, money(1_000_00n, 'NGN')),
        }),
      );
    const results = await Promise.all([post(), post(), post()]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect((await ledger.balance(ctx.prisma, booking)).minor).toBe(1_000_00n);
    expect(await ctx.prisma.ledgerEntry.count()).toBe(2);
  });

  it('refuses to take a customer account below zero, even under concurrency', async () => {
    await ctx.prisma.$transaction((tx) =>
      ledger.post(tx, {
        key: 'payment:3:captured',
        kind: 'payment_captured',
        lines: transfer(psp, booking, money(10_000_00n, 'NGN')),
      }),
    );
    const refund = (key: string) =>
      ctx.prisma.$transaction((tx) =>
        ledger.post(tx, {
          key,
          kind: 'refund_initiated',
          lines: transfer(
            booking,
            { kind: 'refunds-in-flight', provider: 'mock', currency: 'NGN' },
            money(7_000_00n, 'NGN'),
          ),
        }),
      );
    const outcomes = await Promise.allSettled([refund('refund:a'), refund('refund:b')]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(InsufficientBalanceError);
    expect((await ledger.balance(ctx.prisma, booking)).minor).toBe(3_000_00n);
    // The failed attempt left nothing behind.
    expect(
      (await ctx.prisma.ledgerTransaction.count({ where: { idempotencyKey: 'refund:b' } })) +
        (await ctx.prisma.ledgerTransaction.count({ where: { idempotencyKey: 'refund:a' } })),
    ).toBe(1);
  });

  it('rejects an unbalanced transaction at commit', async () => {
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        await ledger.post(tx, {
          key: 'seed',
          kind: 'payment_captured',
          lines: transfer(psp, unapplied, money(100n, 'NGN')),
        });
        const account = await tx.ledgerAccount.findUniqueOrThrow({
          where: { code: 'unapplied:NGN' },
        });
        const extra = await tx.ledgerTransaction.create({
          data: { idempotencyKey: 'broken', kind: 'payment_captured' },
        });
        await tx.ledgerEntry.create({
          data: {
            transactionId: extra.id,
            accountId: account.id,
            direction: 'credit',
            amountMinor: 100n,
            currency: 'NGN',
          },
        });
      }),
    ).rejects.toThrow(/does not balance/);
    expect(await ctx.prisma.ledgerEntry.count()).toBe(0);
  });

  it('rejects entries in another currency than their account', async () => {
    await ctx.prisma.$transaction((tx) =>
      ledger.post(tx, {
        key: 'seed',
        kind: 'payment_captured',
        lines: transfer(psp, unapplied, money(100n, 'NGN')),
      }),
    );
    const account = await ctx.prisma.ledgerAccount.findUniqueOrThrow({
      where: { code: 'unapplied:NGN' },
    });
    await expect(
      ctx.prisma.$transaction(async (tx) => {
        const transaction = await tx.ledgerTransaction.create({
          data: { idempotencyKey: 'mixed', kind: 'payment_captured' },
        });
        await tx.ledgerEntry.create({
          data: {
            transactionId: transaction.id,
            accountId: account.id,
            direction: 'debit',
            amountMinor: 1n,
            currency: 'USD',
          },
        });
      }),
    ).rejects.toThrow(/does not match its account/);
  });

  it('keeps entries and transactions append-only', async () => {
    await ctx.prisma.$transaction((tx) =>
      ledger.post(tx, {
        key: 'seed',
        kind: 'payment_captured',
        lines: transfer(psp, unapplied, money(100n, 'NGN')),
      }),
    );
    await expect(
      ctx.prisma.$executeRawUnsafe('UPDATE ledger_entries SET amount_minor = 1'),
    ).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRawUnsafe('DELETE FROM ledger_transactions')).rejects.toThrow(
      /append-only/,
    );
  });
});
