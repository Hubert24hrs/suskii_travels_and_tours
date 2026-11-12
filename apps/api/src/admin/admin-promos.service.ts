import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import { Prisma, type PromoCode } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import {
  checkMerged,
  conflict,
  fieldChanges,
  fromDate,
  fromMinor,
  hasChanges,
  toDate,
  toMinor,
  type StaffActor,
} from './admin-helpers';
import {
  promoCheck,
  type adminPromoPageSchema,
  type adminPromoSchema,
  type PromoFields,
  type promoListQuerySchema,
} from './admin-promos.schemas';

type AdminPromo = z.infer<typeof adminPromoSchema>;
type PromoRow = PromoCode & { _count: { redemptions: number } };

const withCount = { _count: { select: { redemptions: true } } } as const;

function promoFields(row: PromoCode): PromoFields {
  return {
    code: row.code,
    description: row.description,
    type: row.type,
    value: Number(row.value),
    currency: row.currency,
    maxDiscountMinor: fromMinor(row.maxDiscountMinor),
    minSpendMinor: fromMinor(row.minSpendMinor),
    verticals: row.verticals,
    validFrom: fromDate(row.validFrom),
    validTo: fromDate(row.validTo),
    maxRedemptions: row.maxRedemptions,
    maxRedemptionsPerUser: row.maxRedemptionsPerUser,
    requiresAccount: row.requiresAccount,
    active: row.active,
  };
}

function stored(fields: PromoFields) {
  return {
    ...fields,
    value: BigInt(fields.value),
    maxDiscountMinor: toMinor(fields.maxDiscountMinor),
    minSpendMinor: toMinor(fields.minSpendMinor),
    validFrom: toDate(fields.validFrom),
    validTo: toDate(fields.validTo),
  };
}

const present = (row: PromoRow): AdminPromo => ({
  ...promoFields(row),
  id: row.id,
  redemptions: row._count.redemptions,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const codeTaken = () => conflict('promo-code-taken', 'Another promo already uses this code');

/**
 * Promo codes for staff (ADR-035). Codes are deactivated rather than deleted, and a code that has
 * been redeemed keeps its text so past bookings stay traceable.
 */
@Injectable()
export class AdminPromosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: z.infer<typeof promoListQuerySchema>,
  ): Promise<z.infer<typeof adminPromoPageSchema>> {
    const rows = await this.prisma.promoCode.findMany({
      where: {
        ...(query.q ? { code: { startsWith: query.q.toUpperCase() } } : {}),
        ...(query.active !== undefined ? { active: query.active } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: withCount,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(present),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async create(input: PromoFields, staff: StaffActor): Promise<AdminPromo> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.promoCode.create({ data: stored(input), include: withCount });
        await this.audit.record(
          {
            action: 'promo.created',
            actorUserId: staff.userId,
            targetType: 'promo_code',
            targetId: created.id,
            context: staff.context,
            metadata: { changes: fieldChanges({}, input, ['description']) },
          },
          tx,
        );
        return present(created);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeTaken();
      throw error;
    }
  }

  async update(id: string, patch: Partial<PromoFields>, staff: StaffActor): Promise<AdminPromo> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.promoCode.findUnique({ where: { id }, include: withCount });
        if (!existing) throw new NotFoundException();
        const before = promoFields(existing);
        const after = checkMerged(promoCheck, { ...before, ...patch });
        if (after.code !== before.code && existing._count.redemptions > 0) {
          throw conflict('promo-code-locked', 'A redeemed promo keeps its code');
        }
        const changes = fieldChanges(before, after, ['description']);
        if (!hasChanges(changes)) return present(existing);
        const updated = await tx.promoCode.update({
          where: { id },
          data: stored(after),
          include: withCount,
        });
        await this.audit.record(
          {
            action: 'promo.updated',
            actorUserId: staff.userId,
            targetType: 'promo_code',
            targetId: id,
            context: staff.context,
            metadata: { changes },
          },
          tx,
        );
        return present(updated);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw codeTaken();
      throw error;
    }
  }
}
