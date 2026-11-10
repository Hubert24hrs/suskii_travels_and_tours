import { Inject, Injectable, Logger } from '@nestjs/common';

import { money } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../infra/prisma.service';
import { PaymentProviders } from '../payments/payment-providers';

import { PaymentEventsService } from './payment-events.service';

const RECHECK_AFTER_MS = 5 * 60_000;
/** A checkout still unpaid this long after it closed is given up on locally. */
const GIVE_UP_AFTER_MS = 24 * 3_600_000;
const BATCH = 20;
/** A sweep starts no new provider call after this long (each call has its own timeout). */
const SWEEP_BUDGET_MS = 20_000;

/**
 * Lost webhooks (ADR-016): pending payments whose checkout closed, or that are older than
 * PAYMENT_RECONCILE_AFTER_MINUTES, are verified with the provider. A settled outcome goes through
 * the webhook pipeline as `reconcile:{reference}:{status}`, so it is applied exactly once.
 * Company wallet top-ups (ADR-090) are checked the same way after the payments.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly events: PaymentEventsService,
  ) {}

  async reconcileDue(now = new Date()): Promise<{ checked: number; settled: number }> {
    const staleBefore = new Date(
      now.getTime() - this.config.PAYMENT_RECONCILE_AFTER_MINUTES * 60_000,
    );
    const payments = await this.prisma.payment.findMany({
      where: {
        status: 'pending',
        kind: 'checkout',
        // A share of a trip checkout (ADR-099) is settled through its trip payment, below.
        tripPaymentId: null,
        provider: { in: this.providers.all().map((provider) => provider.name) },
        OR: [{ expiresAt: { lt: now } }, { createdAt: { lt: staleBefore } }],
        AND: [
          {
            OR: [
              { reconciledAt: null },
              { reconciledAt: { lt: new Date(now.getTime() - RECHECK_AFTER_MS) } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    let settled = 0;
    let checked = 0;
    const stopStartingAt = Date.now() + SWEEP_BUDGET_MS;
    for (const payment of payments) {
      if (Date.now() > stopStartingAt) break;
      checked += 1;
      const provider = this.providers.find(payment.provider);
      if (!provider) continue;
      try {
        const verified = await provider.verifyPayment({
          providerReference: payment.providerReference,
          providerTransactionId: payment.providerTransactionId,
          amount: money(payment.amountMinor, payment.currency),
        });
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { reconciledAt: now },
        });
        if (verified.status === 'pending') {
          if (payment.expiresAt.getTime() < now.getTime() - GIVE_UP_AFTER_MS) {
            // A payment after this still arrives by webhook and is refunded as a late payment.
            await this.prisma.payment.updateMany({
              where: { id: payment.id, status: 'pending' },
              data: { status: 'expired', failureReason: 'never_completed' },
            });
          }
          continue;
        }
        const outcome = await this.events.apply(provider.name, {
          eventId: `reconcile:${payment.providerReference}:${verified.status}`,
          type: verified.status === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
          providerReference: payment.providerReference,
          providerTransactionId: verified.providerTransactionId,
          providerRefundId: null,
          refundId: null,
          amount: verified.amount,
          method: verified.method,
          occurredAt: now.toISOString(),
          failureReason: verified.failureReason,
        });
        if (outcome !== 'duplicate') settled += 1;
      } catch (error) {
        this.logger.warn(
          { paymentId: payment.id, reason: (error as Error).name },
          'payment reconciliation failed',
        );
      }
    }
    const trips = await this.reconcileTripPayments(now, staleBefore, stopStartingAt);
    const topUps = await this.reconcileTopUps(now, staleBefore, stopStartingAt);
    return {
      checked: checked + trips.checked + topUps.checked,
      settled: settled + trips.settled + topUps.settled,
    };
  }

  /**
   * Trip checkouts (ADR-099) whose webhook never came: verified with the provider at the trip's
   * total and fed through the pipeline under the trip payment's own reference, which settles
   * every booking's share at once.
   */
  private async reconcileTripPayments(
    now: Date,
    staleBefore: Date,
    stopStartingAt: number,
  ): Promise<{ checked: number; settled: number }> {
    const tripPayments = await this.prisma.tripPayment.findMany({
      where: {
        status: 'pending',
        provider: { in: this.providers.all().map((provider) => provider.name) },
        OR: [{ expiresAt: { lt: now } }, { createdAt: { lt: staleBefore } }],
        AND: [
          {
            OR: [
              { reconciledAt: null },
              { reconciledAt: { lt: new Date(now.getTime() - RECHECK_AFTER_MS) } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    let checked = 0;
    let settled = 0;
    for (const tripPayment of tripPayments) {
      if (Date.now() > stopStartingAt) break;
      checked += 1;
      const provider = this.providers.find(tripPayment.provider);
      if (!provider) continue;
      try {
        const verified = await provider.verifyPayment({
          providerReference: tripPayment.providerReference,
          providerTransactionId: tripPayment.providerTransactionId,
          amount: money(tripPayment.amountMinor, tripPayment.currency),
        });
        await this.prisma.tripPayment.update({
          where: { id: tripPayment.id },
          data: { reconciledAt: now },
        });
        if (verified.status === 'pending') {
          if (tripPayment.expiresAt.getTime() < now.getTime() - GIVE_UP_AFTER_MS) {
            // A payment after this still arrives by webhook: each share is taken or refunded.
            await this.prisma.$transaction([
              this.prisma.tripPayment.updateMany({
                where: { id: tripPayment.id, status: 'pending' },
                data: { status: 'expired', failureReason: 'never_completed' },
              }),
              this.prisma.payment.updateMany({
                where: { tripPaymentId: tripPayment.id, status: 'pending' },
                data: { status: 'expired', failureReason: 'never_completed' },
              }),
            ]);
          }
          continue;
        }
        const outcome = await this.events.apply(provider.name, {
          eventId: `reconcile:${tripPayment.providerReference}:${verified.status}`,
          type: verified.status === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
          providerReference: tripPayment.providerReference,
          providerTransactionId: verified.providerTransactionId,
          providerRefundId: null,
          refundId: null,
          amount: verified.amount,
          method: verified.method,
          occurredAt: now.toISOString(),
          failureReason: verified.failureReason,
        });
        if (outcome !== 'duplicate') settled += 1;
      } catch (error) {
        this.logger.warn(
          { tripPaymentId: tripPayment.id, reason: (error as Error).name },
          'trip payment reconciliation failed',
        );
      }
    }
    return { checked, settled };
  }

  private async reconcileTopUps(
    now: Date,
    staleBefore: Date,
    stopStartingAt: number,
  ): Promise<{ checked: number; settled: number }> {
    const topUps = await this.prisma.companyWalletTopUp.findMany({
      where: {
        status: 'pending',
        provider: { in: this.providers.all().map((provider) => provider.name) },
        OR: [{ expiresAt: { lt: now } }, { createdAt: { lt: staleBefore } }],
        AND: [
          {
            OR: [
              { reconciledAt: null },
              { reconciledAt: { lt: new Date(now.getTime() - RECHECK_AFTER_MS) } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    let checked = 0;
    let settled = 0;
    for (const topUp of topUps) {
      if (Date.now() > stopStartingAt) break;
      checked += 1;
      const provider = this.providers.find(topUp.provider);
      if (!provider) continue;
      try {
        const verified = await provider.verifyPayment({
          providerReference: topUp.providerReference,
          providerTransactionId: topUp.providerTransactionId,
          amount: money(topUp.amountMinor, topUp.currency),
        });
        await this.prisma.companyWalletTopUp.update({
          where: { id: topUp.id },
          data: { reconciledAt: now },
        });
        if (verified.status === 'pending') {
          if (topUp.expiresAt.getTime() < now.getTime() - GIVE_UP_AFTER_MS) {
            // A capture after this still arrives by webhook and is credited then.
            await this.prisma.companyWalletTopUp.updateMany({
              where: { id: topUp.id, status: 'pending' },
              data: { status: 'expired', failureReason: 'never_completed' },
            });
          }
          continue;
        }
        const outcome = await this.events.apply(provider.name, {
          eventId: `reconcile:${topUp.providerReference}:${verified.status}`,
          type: verified.status === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
          providerReference: topUp.providerReference,
          providerTransactionId: verified.providerTransactionId,
          providerRefundId: null,
          refundId: null,
          amount: verified.amount,
          method: verified.method,
          occurredAt: now.toISOString(),
          failureReason: verified.failureReason,
        });
        if (outcome !== 'duplicate') settled += 1;
      } catch (error) {
        this.logger.warn(
          { topUpId: topUp.id, reason: (error as Error).name },
          'top-up reconciliation failed',
        );
      }
    }
    return { checked, settled };
  }
}
