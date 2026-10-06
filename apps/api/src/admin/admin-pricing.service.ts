import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import type { FeeRule, MarkupRule, Vertical } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { PricingService } from '../pricing/pricing.service';

import {
  checkMerged,
  fieldChanges,
  fromDate,
  fromMinor,
  hasChanges,
  toDate,
  toMinor,
  type StaffActor,
} from './admin-helpers';
import {
  feeRuleCheck,
  markupRuleCheck,
  type adminFeeRuleSchema,
  type adminMarkupRuleSchema,
  type FeeFields,
  type MarkupFields,
} from './admin-pricing.schemas';

type AdminMarkupRule = z.infer<typeof adminMarkupRuleSchema>;
type AdminFeeRule = z.infer<typeof adminFeeRuleSchema>;

function markupFields(row: MarkupRule): MarkupFields {
  return {
    name: row.name,
    vertical: row.vertical,
    priority: row.priority,
    active: row.active,
    channel: row.channel,
    userTier: row.userTier,
    supplier: row.supplier,
    originCode: row.originCode,
    destinationCode: row.destinationCode,
    originCountry: row.originCountry,
    destinationCountry: row.destinationCountry,
    carrierCode: row.carrierCode,
    cabinClass: row.cabinClass,
    type: row.type,
    value: Number(row.value),
    currency: row.currency,
    minAmountMinor: fromMinor(row.minAmountMinor),
    maxAmountMinor: fromMinor(row.maxAmountMinor),
    validFrom: fromDate(row.validFrom),
    validTo: fromDate(row.validTo),
  };
}

function feeFields(row: FeeRule): FeeFields {
  return {
    code: row.code,
    label: row.label,
    vertical: row.vertical,
    active: row.active,
    sortOrder: row.sortOrder,
    channel: row.channel,
    userTier: row.userTier,
    type: row.type,
    value: Number(row.value),
    currency: row.currency,
    basis: row.basis,
    minAmountMinor: fromMinor(row.minAmountMinor),
    maxAmountMinor: fromMinor(row.maxAmountMinor),
    validFrom: fromDate(row.validFrom),
    validTo: fromDate(row.validTo),
  };
}

/** Database columns for the money and time fields both rule kinds share. */
function storedAdjustment(fields: MarkupFields | FeeFields) {
  return {
    value: BigInt(fields.value),
    minAmountMinor: toMinor(fields.minAmountMinor),
    maxAmountMinor: toMinor(fields.maxAmountMinor),
    validFrom: toDate(fields.validFrom),
    validTo: toDate(fields.validTo),
  };
}

const timestamps = (row: { id: string; createdAt: Date; updatedAt: Date }) => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Markup and fee rules for staff (ADR-008, ADR-035). Rules are deactivated rather than deleted;
 * every change is audited with the values it changed and clears the pricing rule cache, so the
 * next search or quote uses it.
 */
@Injectable()
export class AdminPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  async listMarkups(vertical: Vertical | undefined): Promise<{ rules: AdminMarkupRule[] }> {
    const rows = await this.prisma.markupRule.findMany({
      where: vertical ? { vertical } : {},
      orderBy: [{ vertical: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
    });
    return { rules: rows.map((row) => ({ ...markupFields(row), ...timestamps(row) })) };
  }

  async createMarkup(input: MarkupFields, staff: StaffActor): Promise<AdminMarkupRule> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.markupRule.create({
        data: { ...input, ...storedAdjustment(input) },
      });
      await this.audit.record(
        {
          action: 'pricing.markup_created',
          actorUserId: staff.userId,
          targetType: 'markup_rule',
          targetId: created.id,
          context: staff.context,
          metadata: { changes: fieldChanges({}, input) },
        },
        tx,
      );
      return created;
    });
    this.pricing.invalidate();
    return { ...markupFields(row), ...timestamps(row) };
  }

  async updateMarkup(
    id: string,
    patch: Partial<MarkupFields>,
    staff: StaffActor,
  ): Promise<AdminMarkupRule> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.markupRule.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException();
      const before = markupFields(existing);
      const after = checkMerged(markupRuleCheck, { ...before, ...patch });
      const changes = fieldChanges(before, after);
      if (!hasChanges(changes)) return existing;
      const updated = await tx.markupRule.update({
        where: { id },
        data: { ...after, ...storedAdjustment(after) },
      });
      await this.audit.record(
        {
          action: 'pricing.markup_updated',
          actorUserId: staff.userId,
          targetType: 'markup_rule',
          targetId: id,
          context: staff.context,
          metadata: { changes },
        },
        tx,
      );
      return updated;
    });
    this.pricing.invalidate();
    return { ...markupFields(row), ...timestamps(row) };
  }

  async listFees(vertical: Vertical | undefined): Promise<{ rules: AdminFeeRule[] }> {
    const rows = await this.prisma.feeRule.findMany({
      where: vertical ? { vertical } : {},
      orderBy: [{ vertical: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { rules: rows.map((row) => ({ ...feeFields(row), ...timestamps(row) })) };
  }

  async createFee(input: FeeFields, staff: StaffActor): Promise<AdminFeeRule> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.feeRule.create({ data: { ...input, ...storedAdjustment(input) } });
      await this.audit.record(
        {
          action: 'pricing.fee_created',
          actorUserId: staff.userId,
          targetType: 'fee_rule',
          targetId: created.id,
          context: staff.context,
          metadata: { changes: fieldChanges({}, input) },
        },
        tx,
      );
      return created;
    });
    this.pricing.invalidate();
    return { ...feeFields(row), ...timestamps(row) };
  }

  async updateFee(id: string, patch: Partial<FeeFields>, staff: StaffActor): Promise<AdminFeeRule> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.feeRule.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException();
      const before = feeFields(existing);
      const after = checkMerged(feeRuleCheck, { ...before, ...patch });
      const changes = fieldChanges(before, after);
      if (!hasChanges(changes)) return existing;
      const updated = await tx.feeRule.update({
        where: { id },
        data: { ...after, ...storedAdjustment(after) },
      });
      await this.audit.record(
        {
          action: 'pricing.fee_updated',
          actorUserId: staff.userId,
          targetType: 'fee_rule',
          targetId: id,
          context: staff.context,
          metadata: { changes },
        },
        tx,
      );
      return updated;
    });
    this.pricing.invalidate();
    return { ...feeFields(row), ...timestamps(row) };
  }
}
