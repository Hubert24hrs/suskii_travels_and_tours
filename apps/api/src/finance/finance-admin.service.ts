import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { money, toWire } from '@suskii/shared';

import { conflict, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import type { ReconciliationDiscrepancy } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type {
  adminPayoutListSchema,
  discrepancyListSchema,
  discrepancySchema,
  payoutQuerySchema,
  resolveDiscrepancySchema,
} from './finance.schemas';

const LIMIT = 200;

/** Finance's view of reconciliation and payouts (`finance:reconcile`, ADR-051). */
@Injectable()
export class FinanceAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async discrepancies(status: 'open' | 'resolved'): Promise<z.infer<typeof discrepancyListSchema>> {
    const rows = await this.prisma.reconciliationDiscrepancy.findMany({
      where: { status },
      orderBy: { detectedAt: status === 'open' ? 'asc' : 'desc' },
      take: LIMIT,
    });
    return { discrepancies: rows.map(present) };
  }

  /**
   * `corrected` asks the next sweep to compare the record again (it reopens if still wrong);
   * `accepted` closes it for good. Audited with the resolution only.
   */
  async resolve(
    id: string,
    input: z.output<typeof resolveDiscrepancySchema>,
    actor: StaffActor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reconciliationDiscrepancy.updateMany({
        where: { id, status: 'open' },
        data: {
          status: 'resolved',
          resolution: input.resolution,
          resolvedById: actor.userId,
          resolvedAt: new Date(),
        },
      });
      const row = await tx.reconciliationDiscrepancy.findUnique({ where: { id } });
      if (!row) throw new NotFoundException();
      if (count === 0)
        throw conflict('discrepancy-resolved', 'This discrepancy is already resolved');
      if (input.resolution === 'corrected') {
        const where = { id: row.subjectId };
        const data = { ledgerCheckedAt: null };
        if (row.subjectType === 'payment') await tx.payment.updateMany({ where, data });
        else if (row.subjectType === 'refund') await tx.refund.updateMany({ where, data });
        else if (row.subjectType === 'company_topup')
          await tx.companyWalletTopUp.updateMany({ where, data });
        else await tx.driverPayout.updateMany({ where, data });
      }
      await this.audit.record(
        {
          action: 'reconciliation.discrepancy_resolved',
          actorUserId: actor.userId,
          targetType: 'reconciliation_discrepancy',
          targetId: id,
          context: actor.context,
          metadata: { resolution: input.resolution, kind: row.kind, subjectType: row.subjectType },
        },
        tx,
      );
    });
  }

  async payouts(
    query: z.output<typeof payoutQuerySchema>,
  ): Promise<z.infer<typeof adminPayoutListSchema>> {
    const payouts = await this.prisma.driverPayout.findMany({
      where: query.status ? { status: query.status } : {},
      include: { driver: { select: { givenNames: true, surname: true } } },
      orderBy: { createdAt: 'desc' },
      take: LIMIT,
    });
    return {
      payouts: payouts.map((payout) => ({
        id: payout.id,
        driverId: payout.driverId,
        driverName: `${payout.driver.givenNames} ${payout.driver.surname}`,
        amount: toWire(money(payout.amountMinor, payout.currency)),
        status: payout.status,
        provider: payout.provider,
        failureReason: payout.failureReason,
        batchId: payout.batchId,
        attempts: payout.attempts,
        createdAt: payout.createdAt.toISOString(),
        settledAt: payout.settledAt?.toISOString() ?? null,
      })),
    };
  }
}

function present(row: ReconciliationDiscrepancy): z.infer<typeof discrepancySchema> {
  const amount = (minor: bigint | null) =>
    minor === null || !row.currency ? null : toWire(money(minor, row.currency));
  return {
    id: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    bookingId: row.bookingId,
    expected: amount(row.expectedMinor),
    actual: amount(row.actualMinor),
    status: row.status,
    resolution: row.resolution,
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    detectedAt: row.detectedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}
