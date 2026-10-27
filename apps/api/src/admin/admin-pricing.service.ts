import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ProblemDetailsException } from '../common/problem-details';
import type { FeeRule, MarkupRule, TaxRule, Vertical } from '../generated/prisma/client';
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
  taxRuleCheck,
  type adminFeeRuleSchema,
  type adminMarkupRuleSchema,
  type adminTaxRuleSchema,
  type FeeFields,
  type MarkupFields,
  type TaxFields,
} from './admin-pricing.schemas';

type AdminMarkupRule = z.infer<typeof adminMarkupRuleSchema>;
type AdminFeeRule = z.infer<typeof adminFeeRuleSchema>;
type AdminTaxRule = z.infer<typeof adminTaxRuleSchema>;

/** Cars fares already carry `CARS_VAT_BPS` (ADR-051); a whole-price rule there taxes them twice. */
const CARS_VERTICALS: readonly Vertical[] = ['buses', 'rides', 'rentals'];

function taxFields(row: TaxRule): TaxFields {
  return {
    country: row.country,
    code: row.code,
    label: row.label,
    rateBps: row.rateBps,
    basis: row.basis,
    vertical: row.vertical,
    active: row.active,
    registrationNumber: row.registrationNumber,
    validFrom: fromDate(row.validFrom),
    validTo: fromDate(row.validTo),
  };
}

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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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

  async listTaxes(
    country: string | undefined,
  ): Promise<{ sellerCountry: string; rules: AdminTaxRule[] }> {
    const rows = await this.prisma.taxRule.findMany({
      where: country ? { country } : {},
      orderBy: [{ country: 'asc' }, { code: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      sellerCountry: this.config.TAX_SELLER_COUNTRY,
      rules: rows.map((row) => ({ ...taxFields(row), ...timestamps(row) })),
    };
  }

  async createTax(input: TaxFields, staff: StaffActor): Promise<AdminTaxRule> {
    this.refuseCarsDoubleTax(input);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.taxRule.create({ data: storedTax(input) });
      await this.audit.record(
        {
          action: 'pricing.tax_created',
          actorUserId: staff.userId,
          targetType: 'tax_rule',
          targetId: created.id,
          context: staff.context,
          metadata: { changes: fieldChanges({}, input) },
        },
        tx,
      );
      return created;
    });
    this.pricing.invalidate();
    return { ...taxFields(row), ...timestamps(row) };
  }

  async updateTax(id: string, patch: Partial<TaxFields>, staff: StaffActor): Promise<AdminTaxRule> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.taxRule.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException();
      const before = taxFields(existing);
      const after = checkMerged(taxRuleCheck, { ...before, ...patch });
      this.refuseCarsDoubleTax(after);
      const changes = fieldChanges(before, after);
      if (!hasChanges(changes)) return existing;
      const updated = await tx.taxRule.update({ where: { id }, data: storedTax(after) });
      await this.audit.record(
        {
          action: 'pricing.tax_updated',
          actorUserId: staff.userId,
          targetType: 'tax_rule',
          targetId: id,
          context: staff.context,
          metadata: { changes },
        },
        tx,
      );
      return updated;
    });
    this.pricing.invalidate();
    return { ...taxFields(row), ...timestamps(row) };
  }

  /** A whole-price rule reaching a Cars vertical while Cars fares carry VAT (ADR-072). */
  private refuseCarsDoubleTax(rule: TaxFields): void {
    const reachesCars = rule.vertical === null || CARS_VERTICALS.includes(rule.vertical);
    if (rule.active && rule.basis === 'full' && reachesCars && this.config.CARS_VAT_BPS > 0) {
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'tax-overlaps-cars-vat',
        'Cars fares already include VAT',
        'Choose a vertical other than buses, rides or rentals, the margin basis, or set CARS_VAT_BPS to 0.',
      );
    }
  }
}

function storedTax(fields: TaxFields) {
  return { ...fields, validFrom: toDate(fields.validFrom), validTo: toDate(fields.validTo) };
}
