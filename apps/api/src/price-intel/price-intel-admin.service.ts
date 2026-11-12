import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import {
  SCRAPE_VENDORS,
  normaliseDomain,
  type PriceProduct,
  type ProxyClass,
  type ScrapeVendor,
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
  PriceIntelHealth,
  PriceIntelOverview,
  scrapeJobListSchema,
  scrapingRegisterSchema,
} from './price-intel.schemas';
import { PriceIntelService } from './price-intel.service';
import { PriceSourcesService } from './price-sources.service';
import { ScrapeBreakers } from './scrape-breakers';
import { SCRAPE_PROVIDERS, type ScrapeProviders } from './scrape-providers';
import { scrapingRegisterRows } from './scraping-register';

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
    private readonly sources: PriceSourcesService,
    private readonly breakers: ScrapeBreakers,
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

  /**
   * How reading has gone in the last hours: each vendor's and each site's attempts, the share
   * that gave a usable page and the share the site refused, the median time, what it cost per
   * usable read and per price kept, which vendors are being skipped, and the sites whose pages
   * stopped yielding prices.
   */
  async health(hours: number, now = new Date()): Promise<PriceIntelHealth> {
    const from = new Date(now.getTime() - hours * 3_600_000);
    interface ReadRow {
      attempts: bigint;
      ok: bigint;
      blocked: bigint;
      median_ms: number | null;
      cost: bigint | null;
    }
    const [vendorRows, siteRows, kept, drift] = await Promise.all([
      this.prisma.$queryRaw<(ReadRow & { vendor: string })[]>`
        SELECT vendor,
               count(*) AS attempts,
               count(*) FILTER (WHERE outcome = 'ok') AS ok,
               count(*) FILTER (WHERE outcome = 'blocked') AS blocked,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS median_ms,
               sum(cost_micro_usd) AS cost
          FROM scrape_attempts
         WHERE created_at >= ${from}
         GROUP BY vendor`,
      this.prisma.$queryRaw<(ReadRow & { source_id: string; domain: string })[]>`
        SELECT s.id AS source_id, s.domain,
               count(*) AS attempts,
               count(*) FILTER (WHERE a.outcome = 'ok') AS ok,
               count(*) FILTER (WHERE a.outcome = 'blocked') AS blocked,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY a.duration_ms) AS median_ms,
               sum(a.cost_micro_usd) AS cost
          FROM scrape_attempts a
          JOIN scrape_jobs j ON j.id = a.job_id
          JOIN price_sources s ON s.id = j.source_id
         WHERE a.created_at >= ${from}
         GROUP BY s.id, s.domain
         ORDER BY attempts DESC
         LIMIT 30`,
      this.prisma.priceObservation.groupBy({
        by: ['sourceId'],
        where: { observedAt: { gte: from }, status: { not: 'rejected' } },
        _count: { _all: true },
      }),
      this.sources.list(),
    ]);
    const reads = (row: ReadRow) => {
      const attempts = Number(row.attempts);
      const ok = Number(row.ok);
      const blocked = Number(row.blocked);
      const share = (part: number): number | null =>
        attempts > 0 ? Math.round((part * 10_000) / attempts) : null;
      return {
        attempts,
        ok,
        blocked,
        successRateBps: share(ok),
        blockRateBps: share(blocked),
        medianMs: row.median_ms === null ? null : Math.round(row.median_ms),
        costMicroUsd: Number(row.cost ?? 0n),
      };
    };
    const vendors = await Promise.all(
      [...this.providers.keys()].map(async (vendor) => {
        const row = vendorRows.find((candidate) => candidate.vendor === vendor);
        const line = reads(row ?? { attempts: 0n, ok: 0n, blocked: 0n, median_ms: null, cost: 0n });
        return {
          vendor,
          ...line,
          costPerSuccessMicroUsd: line.ok > 0 ? Math.round(line.costMicroUsd / line.ok) : null,
          breakerOpen: await this.breakers.vendorOpen(vendor),
        };
      }),
    );
    return {
      from: from.toISOString(),
      to: now.toISOString(),
      vendors,
      sites: siteRows.map((row) => {
        const line = reads(row);
        const observations =
          kept.find((candidate) => candidate.sourceId === row.source_id)?._count._all ?? 0;
        return {
          domain: row.domain,
          ...line,
          observations,
          costPerObservationMicroUsd:
            observations > 0 ? Math.round(line.costMicroUsd / observations) : null,
        };
      }),
      drift: drift.flatMap((site) =>
        site.drift
          ? [
              {
                domain: site.domain,
                since: site.drift.since,
                parserVersion: site.drift.parserVersion,
              },
            ]
          : [],
      ),
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

  /** Every site with its status and basis: what `docs/legal/scraping-register.md` holds. */
  async register(now: Date = new Date()): Promise<z.infer<typeof scrapingRegisterSchema>> {
    return { generatedAt: now.toISOString(), rows: await scrapingRegisterRows(this.prisma) };
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
