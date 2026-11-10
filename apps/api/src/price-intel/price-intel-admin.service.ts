import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import {
  SCRAPE_VENDORS,
  normaliseDomain,
  type AutomatedAccessFinding,
  type PriceProduct,
  type ProxyClass,
  type ScrapeVendor,
  type SourcePolicyBasis,
} from '@suskii/shared';
import type { z } from 'zod';

import { conflict, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import { PrismaService } from '../infra/prisma.service';

import { PriceIntelBudget, type BudgetLine } from './price-intel-budget';
import { PriceIntelSwitches, type KillSwitch } from './price-intel-switches';
import type {
  BudgetInput,
  KillSwitchInput,
  PriceIntelOverview,
  scrapeJobListSchema,
  scrapingRegisterSchema,
} from './price-intel.schemas';
import { PriceIntelService } from './price-intel.service';
import { SCRAPE_PROVIDERS, type ScrapeProviders } from './scrape-providers';

/** A vendor that does not answer its health call in this long is shown as unknown. */
const HEALTH_TIMEOUT_MS = 5000;

/**
 * What staff see and switch for price intelligence (ADR-102): which vendors answer, what is
 * switched off, what has been spent against which cap, what was read and how it ended, and the
 * register of sites with their basis. Switching off needs no second check; switching back on
 * and changing a cap do (step-up on the routes). Every change is audited with codes only.
 */
@Injectable()
export class PriceIntelAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly switches: PriceIntelSwitches,
    private readonly budget: PriceIntelBudget,
    private readonly intel: PriceIntelService,
    @Inject(SCRAPE_PROVIDERS) private readonly providers: ScrapeProviders,
  ) {}

  async overview(): Promise<PriceIntelOverview> {
    const vendors = await Promise.all(
      [...this.providers.values()].map(async (provider) => {
        const health = await provider
          .health(AbortSignal.timeout(HEALTH_TIMEOUT_MS))
          .catch(() => null);
        return {
          vendor: provider.name,
          ok: health?.ok ?? null,
          remaining: health?.remaining ?? null,
          proxyClasses: [...provider.capabilities.proxyClasses],
          render: provider.capabilities.render,
        };
      }),
    );
    const sources = await this.prisma.priceSource.findMany({
      select: { domain: true, policy: { select: { status: true } } },
    });
    const count = (status: string): number =>
      sources.filter((source) => source.policy?.status === status).length;
    return {
      enabled: this.intel.enabled(),
      vendors,
      switches: await this.switches.list(),
      budgets: await this.budgets(sources.map((source) => source.domain)),
      sources: { review: count('review'), approved: count('approved'), blocked: count('blocked') },
    };
  }

  budgets(domains: readonly string[]): Promise<BudgetLine[]> {
    return this.budget.lines([
      ...[...this.providers.keys()].map((vendor) => ({
        scope: 'vendor' as const,
        subject: vendor,
      })),
      ...domains.map((domain) => ({ scope: 'domain' as const, subject: domain })),
    ]);
  }

  async stop(input: KillSwitchInput, staff: StaffActor): Promise<KillSwitch[]> {
    const subject = this.subjectOf(input);
    if (!(await this.switches.stop(input.scope, subject))) {
      throw conflict('price-intel-already-off', 'That is already switched off');
    }
    await this.audit.record({
      action: 'price_intel.switched_off',
      actorUserId: staff.userId,
      targetType: 'price_intel_switch',
      metadata: { scope: input.scope, subject },
      context: staff.context,
    });
    return this.switches.list();
  }

  async release(input: KillSwitchInput, staff: StaffActor): Promise<KillSwitch[]> {
    const subject = this.subjectOf(input);
    if (!(await this.switches.release(input.scope, subject))) {
      throw conflict('price-intel-not-off', 'That is not switched off');
    }
    await this.audit.record({
      action: 'price_intel.switched_on',
      actorUserId: staff.userId,
      targetType: 'price_intel_switch',
      metadata: { scope: input.scope, subject },
      context: staff.context,
    });
    return this.switches.list();
  }

  async setBudget(input: BudgetInput, staff: StaffActor): Promise<BudgetLine> {
    const subject = this.subjectOf(input);
    if (subject === null) throw new Error('a budget has a subject');
    if (input.dailyCapMicroUsd > input.monthlyCapMicroUsd) {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'price-intel-budget-order',
        'A day cannot be allowed more than its month',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const where = { scope_subject: { scope: input.scope, subject } };
      const before = await tx.providerBudget.findUnique({ where });
      const caps = {
        dailyCapMicroUsd: BigInt(input.dailyCapMicroUsd),
        monthlyCapMicroUsd: BigInt(input.monthlyCapMicroUsd),
      };
      await tx.providerBudget.upsert({
        where,
        create: { scope: input.scope, subject, ...caps },
        update: caps,
      });
      await this.audit.record(
        {
          action: 'price_intel.budget_changed',
          actorUserId: staff.userId,
          targetType: 'price_intel_budget',
          metadata: {
            scope: input.scope,
            subject,
            from: before
              ? {
                  dailyCapMicroUsd: Number(before.dailyCapMicroUsd),
                  monthlyCapMicroUsd: Number(before.monthlyCapMicroUsd),
                }
              : null,
            to: {
              dailyCapMicroUsd: input.dailyCapMicroUsd,
              monthlyCapMicroUsd: input.monthlyCapMicroUsd,
            },
          },
          context: staff.context,
        },
        tx,
      );
    });
    this.budget.invalidate();
    const [line] = await this.budget.lines([{ scope: input.scope, subject }]);
    if (!line) throw new Error('budget line missing after it was set');
    return line;
  }

  async jobs(filter: {
    sourceId?: string;
    limit: number;
  }): Promise<z.infer<typeof scrapeJobListSchema>> {
    const rows = await this.prisma.scrapeJob.findMany({
      where: filter.sourceId ? { sourceId: filter.sourceId } : {},
      include: { attempts: { orderBy: { id: 'asc' } }, source: { select: { domain: true } } },
      orderBy: { id: 'desc' },
      take: filter.limit,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        sourceId: row.sourceId,
        domain: row.source.domain,
        product: row.product as PriceProduct,
        query: row.query as Record<string, unknown>,
        trigger: row.trigger,
        status: row.status,
        failureClass: row.failureClass,
        costMicroUsd: Number(row.costMicroUsd),
        observationCount: row.observationCount,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        attempts: row.attempts.map((attempt) => ({
          vendor: attempt.vendor as ScrapeVendor,
          proxyClass: attempt.proxyClass as ProxyClass,
          outcome: attempt.outcome,
          httpStatus: attempt.httpStatus,
          rendered: attempt.rendered,
          durationMs: attempt.durationMs,
          costMicroUsd: Number(attempt.costMicroUsd),
          hasSnapshot: attempt.snapshotKey !== null,
        })),
      })),
    };
  }

  /** Every site with its status and basis: what `docs/legal/scraping-register.md` asks for. */
  async register(now: Date = new Date()): Promise<z.infer<typeof scrapingRegisterSchema>> {
    const rows = await this.prisma.priceSource.findMany({
      include: { policy: true },
      orderBy: { domain: 'asc' },
    });
    return {
      generatedAt: now.toISOString(),
      rows: rows.flatMap((row) =>
        row.policy
          ? [
              {
                domain: row.domain,
                name: row.name,
                status: row.policy.status,
                basis: row.policy.basis as SourcePolicyBasis | null,
                basisReference: row.policy.basisReference,
                robots: row.policy.robots as AutomatedAccessFinding,
                terms: row.policy.terms as AutomatedAccessFinding,
                products: row.products as PriceProduct[],
                vendors: row.policy.vendors as ScrapeVendor[],
                maxProxyClass: row.policy.maxProxyClass as ProxyClass,
                requestsPerMinute: row.policy.requestsPerMinute,
                decidedAt: row.policy.decidedAt?.toISOString() ?? null,
              },
            ]
          : [],
      ),
    };
  }

  /** The vendor or the domain a switch or a budget is about, checked; null for the global one. */
  private subjectOf(input: { scope: string; subject: string | null }): string | null {
    if (input.scope === 'global') return null;
    const subject =
      input.scope === 'vendor'
        ? (SCRAPE_VENDORS as readonly string[]).includes(input.subject ?? '')
          ? input.subject
          : null
        : normaliseDomain(input.subject ?? '');
    if (!subject) {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'price-intel-subject',
        input.scope === 'vendor' ? 'No such vendor' : 'Not a domain name',
      );
    }
    return subject;
  }
}
