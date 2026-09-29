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
    return { checked, settled };
  }
}
