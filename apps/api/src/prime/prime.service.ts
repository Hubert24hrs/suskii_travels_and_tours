import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { toWire, type PrimeBenefits } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { storedPlanPrices } from '../bookings/inhouse-catalog';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { Prisma, type PrimePlan } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { currentPrime, storedBenefits } from './prime-status';
import type {
  adminPrimePlanSchema,
  CreatePrimePlan,
  myPrimeSchema,
  primePlanSchema,
  UpdatePrimePlan,
} from './prime.schemas';

type PlanDto = z.infer<typeof primePlanSchema>;
type AdminPlanDto = z.infer<typeof adminPrimePlanSchema>;

/** Benefits as customers see them: the margin share stays internal (ADR-030). */
export const benefitsView = (benefits: PrimeBenefits) => ({
  memberFares: benefits.markupShareBps > 0,
  waivedFeeCodes: benefits.waivedFeeCodes,
  prioritySupport: benefits.prioritySupport,
});

const slugTaken = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'slug-taken',
    'Slug already in use',
    'Choose another slug for this plan.',
  );

/** Suskii Prime plans (staff-managed data) and the signed-in member's status (ADR-030). */
@Injectable()
export class PrimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async published(currency: string | undefined): Promise<PlanDto[]> {
    const plans = await this.prisma.primePlan.findMany({
      where: { status: 'published' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map((plan) => {
      const prices = storedPlanPrices(plan.prices);
      const price = currency ? prices.find((entry) => entry.currency === currency) : prices[0];
      return {
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        summary: plan.summary,
        period: plan.period,
        price: price ? toWire(price) : null,
        prices: prices.map(toWire),
        benefits: benefitsView(storedBenefits(plan.benefits)),
        sample: plan.sample,
      };
    });
  }

  async mine(userId: string, now = new Date()): Promise<z.infer<typeof myPrimeSchema>> {
    const [status, terms] = await Promise.all([
      currentPrime(this.prisma, userId, now),
      this.prisma.primeMembership.findMany({
        where: { userId },
        orderBy: { startsAt: 'desc' },
        include: { plan: { select: { slug: true, name: true, period: true } } },
      }),
    ]);
    const current = status ? terms.find((term) => term.id === status.membershipId) : undefined;
    return {
      member: status !== null,
      current:
        status && current
          ? {
              plan: current.plan,
              startsAt: current.startsAt.toISOString(),
              until: status.until.toISOString(),
              benefits: benefitsView(status.benefits),
            }
          : null,
      terms: terms.map((term) => ({
        id: term.id,
        planName: term.plan.name,
        status: term.status,
        startsAt: term.startsAt.toISOString(),
        endsAt: term.endsAt.toISOString(),
        bookingId: term.bookingId,
      })),
    };
  }

  // --- Admin -------------------------------------------------------------------------

  async adminList(): Promise<AdminPlanDto[]> {
    const [plans, counts] = await Promise.all([
      this.prisma.primePlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.primeMembership.groupBy({
        by: ['planId'],
        where: { status: 'active', endsAt: { gt: new Date() } },
        _count: { _all: true },
      }),
    ]);
    const active = new Map(counts.map((row) => [row.planId, row._count._all]));
    return plans.map((plan) => this.adminView(plan, active.get(plan.id) ?? 0));
  }

  async create(
    input: CreatePrimePlan,
    actor: { userId: string; context: RequestContext },
  ): Promise<AdminPlanDto> {
    try {
      const plan = await this.prisma.$transaction(async (tx) => {
        const created = await tx.primePlan.create({
          data: {
            slug: input.slug,
            name: input.name,
            summary: input.summary,
            period: input.period,
            prices: input.prices,
            benefits: input.benefits,
            sortOrder: input.sortOrder,
          },
        });
        await this.audit.record(
          {
            action: 'prime.plan_created',
            actorUserId: actor.userId,
            targetType: 'prime_plan',
            targetId: created.id,
            context: actor.context,
          },
          tx,
        );
        return created;
      });
      return this.adminView(plan, 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw slugTaken();
      }
      throw error;
    }
  }

  async update(
    planId: string,
    input: UpdatePrimePlan,
    actor: { userId: string; context: RequestContext },
  ): Promise<AdminPlanDto> {
    const plan = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.primePlan.findUnique({ where: { id: planId } });
      if (!existing) throw new NotFoundException();
      const updated = await tx.primePlan.update({
        where: { id: planId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.prices !== undefined ? { prices: input.prices } : {}),
          ...(input.benefits !== undefined ? { benefits: input.benefits } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'prime.plan_updated',
          actorUserId: actor.userId,
          targetType: 'prime_plan',
          targetId: planId,
          context: actor.context,
          metadata: {
            fields: Object.keys(input),
            ...(input.status ? { status: input.status } : {}),
          },
        },
        tx,
      );
      return updated;
    });
    const active = await this.prisma.primeMembership.count({
      where: { planId, status: 'active', endsAt: { gt: new Date() } },
    });
    return this.adminView(plan, active);
  }

  private adminView(plan: PrimePlan, activeMembers: number): AdminPlanDto {
    return {
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      summary: plan.summary,
      period: plan.period,
      prices: storedPlanPrices(plan.prices).map(toWire),
      benefits: storedBenefits(plan.benefits),
      status: plan.status,
      sample: plan.sample,
      sortOrder: plan.sortOrder,
      activeMembers,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}
