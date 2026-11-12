import { Injectable } from '@nestjs/common';

import { money, type Money } from '@suskii/shared';

import { uuidv7 } from '../common/uuid';
import type { LedgerDirection, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { accountSpec, type AccountRef, type LedgerKind } from './ledger-accounts';

type Tx = Prisma.TransactionClient;

export interface LedgerLine {
  account: AccountRef;
  direction: LedgerDirection;
  amount: Money;
}

export interface Posting {
  /** Business key: the same key is posted once, ever (`payment:{id}:captured`). */
  key: string;
  kind: LedgerKind;
  bookingId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  lines: LedgerLine[];
}

/** A debit on one account against a credit on another: most postings look like this. */
export function transfer(from: AccountRef, to: AccountRef, amount: Money): LedgerLine[] {
  return [
    { account: from, direction: 'debit', amount },
    { account: to, direction: 'credit', amount },
  ];
}

/** Raised when a posting would take a customer account below zero (ADR-017). */
export class InsufficientBalanceError extends Error {
  constructor() {
    super('The ledger account does not hold enough money for this movement');
    this.name = 'InsufficientBalanceError';
  }
}

const isBalanceViolation = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('ledger_accounts_non_negative');

/**
 * Double-entry postings (ADR-017). Always runs inside the caller's transaction so money moves
 * atomically with the state change that caused it. Balances, append-only rows, balance per
 * transaction and the non-negative rule are enforced by the database; this service adds
 * idempotency by business key and friendly errors.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Posts once per key; returns whether this call created the transaction. */
  async post(tx: Tx, posting: Posting): Promise<{ transactionId: string; created: boolean }> {
    if (posting.lines.length < 2) throw new Error('A ledger transaction needs at least two lines');
    for (const line of posting.lines) {
      if (line.amount.minor <= 0n) throw new Error('Ledger amounts must be positive');
      if (line.amount.currency !== line.account.currency) {
        throw new Error('Ledger line currency differs from its account');
      }
    }
    const id = uuidv7();
    // ON CONFLICT waits for a concurrent insert of the same key and then does nothing.
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO ledger_transactions (id, idempotency_key, kind, booking_id, payment_id, refund_id)
      VALUES (${id}::uuid, ${posting.key}, ${posting.kind}, ${posting.bookingId ?? null}::uuid,
              ${posting.paymentId ?? null}::uuid, ${posting.refundId ?? null}::uuid)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) {
      const existing = await tx.ledgerTransaction.findUniqueOrThrow({
        where: { idempotencyKey: posting.key },
        select: { id: true },
      });
      return { transactionId: existing.id, created: false };
    }

    const accountIds = new Map<string, string>();
    for (const line of posting.lines) {
      const spec = accountSpec(line.account);
      if (!accountIds.has(spec.code))
        accountIds.set(spec.code, await this.ensureAccount(tx, line.account));
    }
    try {
      await tx.ledgerEntry.createMany({
        data: posting.lines.map((line) => ({
          transactionId: id,
          accountId: accountIds.get(accountSpec(line.account).code) ?? '',
          direction: line.direction,
          amountMinor: line.amount.minor,
          currency: line.amount.currency,
        })),
      });
    } catch (error) {
      if (isBalanceViolation(error)) throw new InsufficientBalanceError();
      throw error;
    }
    return { transactionId: id, created: true };
  }

  /** Current balance in the account's normal direction (zero for an account never used). */
  async balance(tx: Tx | PrismaService, ref: AccountRef): Promise<Money> {
    const account = await tx.ledgerAccount.findUnique({
      where: { code: accountSpec(ref).code },
      select: { balanceMinor: true },
    });
    return money(account?.balanceMinor ?? 0n, ref.currency);
  }

  /** Whether a transaction with this key exists (for idempotent multi-step flows). */
  async posted(tx: Tx | PrismaService, key: string): Promise<boolean> {
    const found = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: key },
      select: { id: true },
    });
    return found !== null;
  }

  /** Wallet accounts of a user with a history of their latest movements. */
  async wallet(userId: string, limit = 20) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { userId, code: { startsWith: 'wallet:' } },
      orderBy: { currency: 'asc' },
    });
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { accountId: { in: accounts.map((account) => account.id) } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { transaction: { select: { kind: true, bookingId: true } } },
    });
    return { accounts, entries };
  }

  private async ensureAccount(tx: Tx, ref: AccountRef): Promise<string> {
    const spec = accountSpec(ref);
    await tx.$executeRaw`
      INSERT INTO ledger_accounts (id, code, type, currency, allow_negative, user_id, booking_id)
      VALUES (${uuidv7()}::uuid, ${spec.code}, ${spec.type}::"LedgerAccountType", ${spec.currency},
              ${spec.allowNegative}, ${spec.userId}::uuid, ${spec.bookingId}::uuid)
      ON CONFLICT (code) DO NOTHING`;
    const account = await tx.ledgerAccount.findUniqueOrThrow({
      where: { code: spec.code },
      select: { id: true },
    });
    return account.id;
  }
}
