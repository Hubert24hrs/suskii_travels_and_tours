import { Inject, Injectable, Logger } from '@nestjs/common';

import { money, type Money } from '@suskii/shared';

import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DriversService } from '../drivers/drivers.service';
import { Prisma } from '../generated/prisma/client';
import { PayoutProvider, type PayoutRequest, type PayoutResult } from '../ground/payouts';
import { PrismaService } from '../infra/prisma.service';
import type { AccountRef } from '../ledger/ledger-accounts';
import { LedgerService, transfer } from '../ledger/ledger.service';
import { driverPayouts } from '../telemetry/metrics';

export interface PayoutRun {
  sent: number;
  paid: number;
  failed: number;
  pending: number;
}

interface DueBalance {
  account_id: string;
  driver_id: string;
  currency: string;
}

interface OpenPayout {
  id: string;
  driverId: string;
  amount: Money;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** The bank rejected the account itself: retrying before the driver changes it cannot work. */
const ACCOUNT_REJECTED = 'account_rejected';

const earnings = (driverId: string, currency: string): AccountRef => ({
  kind: 'driver-earnings',
  driverId,
  currency,
});

/**
 * Driver payouts (ADR-051), run by the worker every DRIVER_PAYOUT_INTERVAL_HOURS. Approved
 * drivers with bank details and at least DRIVER_PAYOUT_MIN_MINOR earned get their whole balance
 * in one provider batch per run. Opening a payout moves the money from their earnings to
 * payouts-in-flight (`payout_sent`) under a lock on the earnings account; the bank's answer
 * settles it (`payout_settled`, out of our provider balance) or puts it back (`payout_failed`).
 * A partial unique index allows one pending payout per driver and currency, so overlapping runs
 * cannot pay twice; pending ones are followed up with the provider, and resent with the same
 * reference when the provider never received them. After `account_rejected`, a driver is paid
 * again only once their bank details change; suspended drivers are held until reinstated.
 */
@Injectable()
export class DriverPayoutsService {
  private readonly logger = new Logger(DriverPayoutsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly provider: PayoutProvider,
    private readonly drivers: DriversService,
  ) {}

  async run(): Promise<PayoutRun> {
    const run: PayoutRun = { sent: 0, paid: 0, failed: 0, pending: 0 };
    await this.followUp(run);
    const batchId = uuidv7();
    const opened: OpenPayout[] = [];
    for (const due of await this.dueBalances()) {
      const payout = await this.open(due, batchId);
      if (payout) opened.push(payout);
    }
    run.sent = opened.length;
    if (opened.length > 0) {
      driverPayouts.add(opened.length, { outcome: 'sent', provider: this.provider.name });
      await this.send(opened, run);
    }
    return run;
  }

  /** Earnings accounts due a payout, largest first, at most one provider batch. */
  private dueBalances(): Promise<DueBalance[]> {
    const minimum = BigInt(Math.max(this.config.DRIVER_PAYOUT_MIN_MINOR, 1));
    return this.prisma.$queryRaw<DueBalance[]>`
      SELECT a.id AS account_id, d.id AS driver_id, a.currency
      FROM ledger_accounts a
      JOIN drivers d ON a.code = 'driver-earnings:' || d.id::text || ':' || a.currency
      LEFT JOIN LATERAL (
        SELECT p.status, p.failure_reason, p.created_at
        FROM driver_payouts p
        WHERE p.driver_id = d.id AND p.currency = a.currency
        ORDER BY p.created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE a.code LIKE 'driver-earnings:%'
        AND a.balance_minor >= ${minimum}
        AND d.status = 'approved'
        AND d.payout_account_encrypted IS NOT NULL
        AND (
          latest.status IS NULL
          OR latest.status = 'paid'
          OR (
            latest.status = 'failed'
            AND (
              latest.failure_reason IS DISTINCT FROM ${ACCOUNT_REJECTED}
              OR latest.created_at < COALESCE(d.payout_account_updated_at, '-infinity'::timestamptz)
            )
          )
        )
      ORDER BY a.balance_minor DESC
      LIMIT ${this.provider.maxBatch}`;
  }

  /** Moves the whole balance to payouts-in-flight with a pending payout, or nothing. */
  private async open(due: DueBalance, batchId: string): Promise<OpenPayout | null> {
    const minimum = BigInt(Math.max(this.config.DRIVER_PAYOUT_MIN_MINOR, 1));
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Earnings credited meanwhile wait for this transaction; the balance read is final.
        const [locked] = await tx.$queryRaw<{ balance_minor: bigint }[]>`
          SELECT balance_minor FROM ledger_accounts WHERE id = ${due.account_id}::uuid FOR UPDATE`;
        const balance = locked?.balance_minor ?? 0n;
        if (balance < minimum) return null;
        const id = uuidv7();
        const amount = money(balance, due.currency);
        await tx.driverPayout.create({
          data: {
            id,
            driverId: due.driver_id,
            amountMinor: balance,
            currency: due.currency,
            provider: this.provider.name,
            batchId,
          },
        });
        await this.ledger.post(tx, {
          key: `payout:${id}:sent`,
          kind: 'payout_sent',
          lines: transfer(
            earnings(due.driver_id, due.currency),
            { kind: 'payouts-in-flight', provider: this.provider.name, currency: due.currency },
            amount,
          ),
        });
        return { id, driverId: due.driver_id, amount };
      });
    } catch (error) {
      // Another run opened this driver's payout first.
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  /** One provider batch; a batch without an answer stays pending for the next run. */
  private async send(payouts: OpenPayout[], run: PayoutRun): Promise<void> {
    const requests: { payout: OpenPayout; request: PayoutRequest }[] = [];
    for (const payout of payouts) {
      const driver = await this.prisma.driver.findUniqueOrThrow({
        where: { id: payout.driverId },
        select: { id: true, payoutAccountEncrypted: true },
      });
      const account = this.drivers.payoutAccount(driver);
      if (!account) {
        await this.apply(payout.id, { status: 'failed', failureReason: 'no_account' }, run);
        continue;
      }
      requests.push({
        payout,
        request: {
          reference: `payout:${payout.id}`,
          amount: payout.amount,
          bankCode: account.bankCode,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
        },
      });
    }
    if (requests.length === 0) return;
    await this.prisma.driverPayout.updateMany({
      where: { id: { in: requests.map((item) => item.payout.id) } },
      data: { attempts: { increment: 1 } },
    });
    let results: PayoutResult[];
    try {
      results = await this.provider.sendBatch(requests.map((item) => item.request));
    } catch (error) {
      this.logger.warn(
        { payouts: requests.length, reason: (error as Error).name },
        'payout batch got no answer; it is followed up next run',
      );
      run.pending += requests.length;
      return;
    }
    const byReference = new Map(results.map((result) => [result.reference, result]));
    for (const { payout, request } of requests) {
      const result = byReference.get(request.reference);
      if (!result) {
        run.pending += 1;
        continue;
      }
      await this.apply(payout.id, result, run);
    }
  }

  /** Pending payouts from earlier runs: ask the provider, and resend what it never received. */
  private async followUp(run: PayoutRun): Promise<void> {
    const pending = await this.prisma.driverPayout.findMany({
      where: { status: 'pending', provider: this.provider.name },
      orderBy: { createdAt: 'asc' },
      take: this.provider.maxBatch,
    });
    const resend: OpenPayout[] = [];
    for (const payout of pending) {
      let result: PayoutResult | null;
      try {
        result = await this.provider.status(`payout:${payout.id}`);
      } catch (error) {
        this.logger.warn(
          { payoutId: payout.id, reason: (error as Error).name },
          'payout status unavailable',
        );
        run.pending += 1;
        continue;
      }
      if (result) await this.apply(payout.id, result, run);
      else
        resend.push({
          id: payout.id,
          driverId: payout.driverId,
          amount: money(payout.amountMinor, payout.currency),
        });
    }
    if (resend.length > 0) await this.send(resend, run);
  }

  /** Records the bank's answer once; the ledger posting follows the status change. */
  private async apply(
    payoutId: string,
    result: Pick<PayoutResult, 'status' | 'failureReason'> & { providerReference?: string },
    run: PayoutRun,
  ): Promise<void> {
    if (result.status === 'pending') {
      if (result.providerReference) {
        await this.prisma.driverPayout.update({
          where: { id: payoutId },
          data: { providerReference: result.providerReference },
        });
      }
      run.pending += 1;
      return;
    }
    const changed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.driverPayout.updateMany({
        where: { id: payoutId, status: 'pending' },
        data:
          result.status === 'paid'
            ? { status: 'paid', settledAt: new Date(), providerReference: result.providerReference }
            : {
                status: 'failed',
                failureReason: result.failureReason ?? 'failed',
                providerReference: result.providerReference,
              },
      });
      if (count === 0) return false;
      const payout = await tx.driverPayout.findUniqueOrThrow({ where: { id: payoutId } });
      const amount = money(payout.amountMinor, payout.currency);
      const inFlight: AccountRef = {
        kind: 'payouts-in-flight',
        provider: payout.provider,
        currency: payout.currency,
      };
      await this.ledger.post(
        tx,
        result.status === 'paid'
          ? {
              key: `payout:${payout.id}:settled`,
              kind: 'payout_settled',
              lines: transfer(
                inFlight,
                { kind: 'psp', provider: payout.provider, currency: payout.currency },
                amount,
              ),
            }
          : {
              key: `payout:${payout.id}:failed`,
              kind: 'payout_failed',
              lines: transfer(inFlight, earnings(payout.driverId, payout.currency), amount),
            },
      );
      return true;
    });
    if (!changed) return;
    if (result.status === 'paid') run.paid += 1;
    else run.failed += 1;
    driverPayouts.add(1, { outcome: result.status, provider: this.provider.name });
  }
}
