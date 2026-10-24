import { Injectable, Logger } from '@nestjs/common';

import { equals, money, type Money } from '@suskii/shared';

import { BookingNotifications } from '../bookings/booking-notifications';
import {
  Prisma,
  type DiscrepancyKind,
  type DiscrepancySubject,
  type Payment,
} from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import type { PaymentVerification } from '../payments/payment-provider';
import { PaymentProviders } from '../payments/payment-providers';
import { reconciliationDiscrepancies } from '../telemetry/metrics';

const BATCH = 100;
/** A sweep starts no new provider call after this long (each call has its own timeout). */
const SWEEP_BUDGET_MS = 20_000;
/** Capture postings this recent are checked against their payment's status every sweep. */
const ORPHAN_WINDOW_DAYS = 7;
const CAPTURE_KINDS = ['payment_captured', 'payment_unapplied', 'wallet_payment'];

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export interface Finding {
  kind: DiscrepancyKind;
  subjectType: DiscrepancySubject;
  subjectId: string;
  bookingId: string | null;
  expected: Money | null;
  actual: Money | null;
}

type PaymentFacts = Pick<
  Payment,
  'id' | 'bookingId' | 'amountMinor' | 'currency' | 'requiresRefund' | 'failureReason'
>;

/**
 * What is wrong with a captured payment, given its capture posting (null when missing) and the
 * provider's answer (null when not asked). An amount the provider charged differently is
 * already refunded and audited (`amount_mismatch`), so only its presence in the ledger counts.
 */
export function paymentFindings(
  payment: PaymentFacts,
  captured: Money | null,
  verified: PaymentVerification | null,
): Finding[] {
  const expected = money(payment.amountMinor, payment.currency);
  const base = {
    subjectType: 'payment' as const,
    subjectId: payment.id,
    bookingId: payment.bookingId,
  };
  const findings: Finding[] = [];
  const knownMismatch = payment.requiresRefund && payment.failureReason === 'amount_mismatch';
  if (!captured) {
    findings.push({ ...base, kind: 'ledger_missing', expected, actual: null });
  } else if (!knownMismatch && !equals(captured, expected)) {
    findings.push({ ...base, kind: 'ledger_amount', expected, actual: captured });
  }
  if (verified?.status === 'failed') {
    findings.push({
      ...base,
      kind: 'provider_status',
      expected: captured ?? expected,
      actual: null,
    });
  } else if (verified?.status === 'succeeded' && verified.amount) {
    const booked = captured ?? expected;
    if (!equals(verified.amount, booked)) {
      findings.push({
        ...base,
        kind: 'provider_amount',
        expected: booked,
        actual: verified.amount,
      });
    }
  }
  return findings;
}

/** Findings for a refund or payout: each posting named must exist with the record's amount. */
export function postingFindings(
  subject: Pick<Finding, 'subjectType' | 'subjectId' | 'bookingId'>,
  expected: Money,
  postings: (Money | null)[],
): Finding[] {
  if (postings.some((posting) => posting === null)) {
    return [{ ...subject, kind: 'ledger_missing', expected, actual: null }];
  }
  const wrong = postings.find((posting) => posting && !equals(posting, expected));
  return wrong ? [{ ...subject, kind: 'ledger_amount', expected, actual: wrong }] : [];
}

/**
 * Ledger reconciliation (ADR-051), run by the worker every LEDGER_RECONCILE_INTERVAL_MINUTES:
 * each captured payment, settled refund and finished driver payout is compared once with its
 * ledger postings, and checkout payments also with the provider's own record. Capture postings
 * of the last week whose payment is not captured are flagged too. Differences become
 * discrepancies for finance (`finance:reconcile`) and an operations alert; nothing is changed
 * automatically. A payment the provider could not be asked about is tried again next sweep.
 */
@Injectable()
export class LedgerReconciliationService {
  private readonly logger = new Logger(LedgerReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly notifications: BookingNotifications,
  ) {}

  async run(
    now = new Date(),
  ): Promise<{ checked: number; discrepancies: number; unconfirmed: number }> {
    const stopStartingAt = Date.now() + SWEEP_BUDGET_MS;
    const findings: Finding[] = [];
    const payments = await this.checkPayments(now, stopStartingAt, findings);
    const refunds = await this.checkRefunds(now, findings);
    const payouts = await this.checkPayouts(now, findings);
    await this.checkOrphans(now, findings);

    let raised = 0;
    for (const finding of findings) if (await this.record(finding, now)) raised += 1;
    if (raised > 0) {
      this.logger.warn({ discrepancies: raised }, 'ledger reconciliation found discrepancies');
      await this.notifications.ops('ledger.discrepancy', null, { count: String(raised) });
    }
    return {
      checked: payments.checked + refunds + payouts,
      discrepancies: raised,
      unconfirmed: payments.unconfirmed,
    };
  }

  private async checkPayments(
    now: Date,
    stopStartingAt: number,
    findings: Finding[],
  ): Promise<{ checked: number; unconfirmed: number }> {
    const payments = await this.prisma.payment.findMany({
      where: { status: 'succeeded', ledgerCheckedAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    let checked = 0;
    let unconfirmed = 0;
    for (const payment of payments) {
      const provider =
        payment.kind === 'checkout' ? this.providers.find(payment.provider) : undefined;
      if (provider && Date.now() > stopStartingAt) break;
      checked += 1;
      const captured = await this.posted(`payment:${payment.id}:captured`);
      let verified: PaymentVerification | null = null;
      let answered = true;
      if (provider) {
        try {
          verified = await provider.verifyPayment({
            providerReference: payment.providerReference,
            providerTransactionId: payment.providerTransactionId,
            amount: money(payment.amountMinor, payment.currency),
          });
          if (
            verified.status === 'pending' ||
            (verified.status === 'succeeded' && !verified.amount)
          )
            unconfirmed += 1;
        } catch (error) {
          answered = false;
          unconfirmed += 1;
          this.logger.warn(
            { paymentId: payment.id, reason: (error as Error).name },
            'reconciliation could not verify a payment',
          );
        }
      }
      findings.push(...paymentFindings(payment, captured, verified));
      if (answered) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { ledgerCheckedAt: now },
        });
      }
    }
    return { checked, unconfirmed };
  }

  private async checkRefunds(now: Date, findings: Finding[]): Promise<number> {
    const refunds = await this.prisma.refund.findMany({
      where: { status: 'succeeded', ledgerCheckedAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    for (const refund of refunds) {
      // Wallet refunds post once; refunds to the card go out (initiated) and settle.
      const keys =
        refund.destination === 'wallet'
          ? [`refund:${refund.id}:to-wallet`]
          : [`refund:${refund.id}:initiated`, `refund:${refund.id}:settled`];
      findings.push(
        ...postingFindings(
          { subjectType: 'refund', subjectId: refund.id, bookingId: refund.bookingId },
          money(refund.amountMinor, refund.currency),
          await Promise.all(keys.map((key) => this.posted(key))),
        ),
      );
      await this.prisma.refund.update({ where: { id: refund.id }, data: { ledgerCheckedAt: now } });
    }
    return refunds.length;
  }

  private async checkPayouts(now: Date, findings: Finding[]): Promise<number> {
    const payouts = await this.prisma.driverPayout.findMany({
      where: { status: { in: ['paid', 'failed'] }, ledgerCheckedAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    for (const payout of payouts) {
      const keys = [
        `payout:${payout.id}:sent`,
        `payout:${payout.id}:${payout.status === 'paid' ? 'settled' : 'failed'}`,
      ];
      findings.push(
        ...postingFindings(
          { subjectType: 'payout', subjectId: payout.id, bookingId: null },
          money(payout.amountMinor, payout.currency),
          await Promise.all(keys.map((key) => this.posted(key))),
        ),
      );
      await this.prisma.driverPayout.update({
        where: { id: payout.id },
        data: { ledgerCheckedAt: now },
      });
    }
    return payouts.length;
  }

  /** Money the ledger says came in for a payment we do not hold as captured. */
  private async checkOrphans(now: Date, findings: Finding[]): Promise<void> {
    const since = new Date(now.getTime() - ORPHAN_WINDOW_DAYS * 86_400_000);
    const orphans = await this.prisma.$queryRaw<
      { payment_id: string; booking_id: string | null; currency: string; amount_minor: bigint }[]
    >`
      SELECT t.payment_id, t.booking_id, e.currency, SUM(e.amount_minor)::bigint AS amount_minor
      FROM ledger_transactions t
      JOIN payments p ON p.id = t.payment_id
      JOIN ledger_entries e ON e.transaction_id = t.id AND e.direction = 'debit'
      WHERE t.kind = ANY(${CAPTURE_KINDS}) AND t.created_at >= ${since} AND p.status <> 'succeeded'
      GROUP BY t.payment_id, t.booking_id, e.currency
      LIMIT ${BATCH}`;
    for (const orphan of orphans) {
      findings.push({
        kind: 'orphan_ledger',
        subjectType: 'payment',
        subjectId: orphan.payment_id,
        bookingId: orphan.booking_id,
        expected: null,
        actual: money(orphan.amount_minor, orphan.currency),
      });
    }
  }

  /** The amount a posting moved (its debits), or null when it was never posted. */
  private async posted(key: string): Promise<Money | null> {
    const transaction = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: key },
      select: {
        entries: { where: { direction: 'debit' }, select: { amountMinor: true, currency: true } },
      },
    });
    const first = transaction?.entries[0];
    if (!transaction || !first) return null;
    return money(
      transaction.entries.reduce((total, entry) => total + entry.amountMinor, 0n),
      first.currency,
    );
  }

  /**
   * Stores a finding once per subject and kind. Returns true when it is new, or when a
   * `corrected` resolution turned out wrong and it reopens; an `accepted` one stays resolved.
   */
  private async record(finding: Finding, now: Date): Promise<boolean> {
    const where = {
      subjectType: finding.subjectType,
      subjectId: finding.subjectId,
      kind: finding.kind,
    };
    const amounts = {
      currency: finding.expected?.currency ?? finding.actual?.currency ?? null,
      expectedMinor: finding.expected?.minor ?? null,
      actualMinor: finding.actual?.minor ?? null,
      lastSeenAt: now,
    };
    const existing = await this.prisma.reconciliationDiscrepancy.findUnique({
      where: { subjectType_subjectId_kind: where },
    });
    if (!existing) {
      try {
        await this.prisma.reconciliationDiscrepancy.create({
          data: { ...where, ...amounts, bookingId: finding.bookingId, detectedAt: now },
        });
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
      reconciliationDiscrepancies.add(1, { kind: finding.kind, subject: finding.subjectType });
      return true;
    }
    const reopen = existing.resolution === 'corrected';
    await this.prisma.reconciliationDiscrepancy.update({
      where: { id: existing.id },
      data: {
        ...amounts,
        ...(reopen
          ? { status: 'open', resolution: null, resolvedById: null, resolvedAt: null }
          : {}),
      },
    });
    if (reopen)
      reconciliationDiscrepancies.add(1, { kind: finding.kind, subject: finding.subjectType });
    return reopen;
  }
}
