import { Injectable } from '@nestjs/common';

import { equals, money } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import type { CompanyWalletTopUp, Prisma } from '../generated/prisma/client';
import { LedgerService, transfer } from '../ledger/ledger.service';
import type { PaymentEvent } from '../payments/payment-provider';

type Tx = Prisma.TransactionClient;

/** The ledger key of a top-up's capture; the ledger reconciliation looks it up. */
export const topUpCaptureKey = (topUpId: string): string => `company-topup:${topUpId}:captured`;

/**
 * Company wallet top-ups on the money side (ADR-090): verified provider events and
 * reconciliation lookups for a top-up arrive through the payment webhook pipeline
 * (`PaymentEventsService`), which calls `applyProviderEvent` in its transaction when the
 * reference is not a booking payment. `BookingsModule` provides this class so the pipeline needs
 * no import of the companies module.
 *
 * Money the provider took is always credited, at the amount and currency it reports: a top-up
 * is the company's own money, so a late or different capture is kept in the wallet (audited)
 * rather than refunded.
 */
@Injectable()
export class CompanyTopUps {
  constructor(
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Applies a verified event for a top-up. Returns the outcome, or null when the reference is
   * not a top-up of this provider (the pipeline then answers `unknown_payment`).
   */
  async applyProviderEvent(tx: Tx, provider: string, event: PaymentEvent): Promise<string | null> {
    const reference = event.providerReference;
    if (!reference) return null;
    const found = await tx.companyWalletTopUp.findUnique({
      where: { providerReference: reference },
      select: { id: true, provider: true },
    });
    if (found?.provider !== provider) return null;
    // One event at a time per top-up.
    await tx.$queryRaw`SELECT id FROM company_wallet_top_ups WHERE id = ${found.id}::uuid FOR UPDATE`;
    const topUp = await tx.companyWalletTopUp.findUniqueOrThrow({ where: { id: found.id } });

    if (event.type === 'payment.failed' || event.type === 'checkout.expired') {
      if (topUp.status !== 'pending') return 'ignored';
      const failed = event.type === 'payment.failed';
      await tx.companyWalletTopUp.update({
        where: { id: topUp.id },
        data: {
          status: failed ? 'failed' : 'expired',
          failureReason: event.failureReason ?? (failed ? 'failed' : 'expired'),
        },
      });
      return failed ? 'topup_failed' : 'topup_expired';
    }
    if (event.type !== 'payment.succeeded') return 'ignored';
    if (topUp.status === 'succeeded') return 'already_succeeded';
    return this.credit(tx, provider, topUp, event);
  }

  private async credit(
    tx: Tx,
    provider: string,
    topUp: CompanyWalletTopUp,
    event: PaymentEvent,
  ): Promise<string> {
    const requested = money(topUp.amountMinor, topUp.currency);
    const received = event.amount ?? requested;
    const mismatch = !equals(received, requested);
    await tx.companyWalletTopUp.update({
      where: { id: topUp.id },
      data: {
        status: 'succeeded',
        succeededAt: new Date(event.occurredAt),
        providerTransactionId: event.providerTransactionId ?? topUp.providerTransactionId,
        method: event.method ?? topUp.method,
        failureReason: null,
        ...(mismatch ? { receivedMinor: received.minor, receivedCurrency: received.currency } : {}),
      },
    });
    await this.ledger.post(tx, {
      key: topUpCaptureKey(topUp.id),
      kind: 'company_topup_captured',
      lines: transfer(
        { kind: 'psp', provider, currency: received.currency },
        { kind: 'company-wallet', companyId: topUp.companyId, currency: received.currency },
        received,
      ),
    });
    await this.audit.record(
      {
        action: 'company_wallet.topped_up',
        actorType: 'system',
        targetType: 'company',
        targetId: topUp.companyId,
        metadata: {
          topUpId: topUp.id,
          amountMinor: received.minor.toString(),
          currency: received.currency,
          ...(topUp.status === 'pending' ? {} : { after: topUp.status }),
        },
      },
      tx,
    );
    if (mismatch) {
      await this.audit.record(
        {
          action: 'company_wallet.topup_amount_mismatch',
          actorType: 'system',
          targetType: 'company',
          targetId: topUp.companyId,
          metadata: {
            topUpId: topUp.id,
            expectedMinor: requested.minor.toString(),
            expectedCurrency: requested.currency,
            receivedMinor: received.minor.toString(),
            receivedCurrency: received.currency,
          },
        },
        tx,
      );
    }
    return mismatch ? 'topup_amount_mismatch' : 'topup_credited';
  }
}
