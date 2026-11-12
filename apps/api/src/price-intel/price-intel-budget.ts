import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { budgetAlertLevel, type ScrapeVendor } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';

/**
 * Checks four counters against their caps and adds to all of them in one step, so two reads at
 * once cannot both pass and overspend. Returns 0 when reserved, else the 1-based index of the
 * counter that refuses.
 */
const RESERVE = `
local amount = tonumber(ARGV[1])
for i = 1, 4 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') + amount > tonumber(ARGV[i + 1]) then return i end
end
for i = 1, 4 do
  redis.call('INCRBY', KEYS[i], amount)
  redis.call('EXPIRE', KEYS[i], ARGV[5 + i])
end
return 0
`;

const SETTLE = `
local delta = tonumber(ARGV[1])
for _, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then
    local value = redis.call('INCRBY', key, delta)
    if value < 0 then redis.call('SET', key, 0, 'KEEPTTL') end
  end
end
return 0
`;

const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;
const MONTH_TTL_SECONDS = 40 * 24 * 60 * 60;
/** Budget rows change rarely; a short memory copy keeps a read to no database call. */
const CAP_CACHE_MS = 30_000;

export const BUDGET_SCOPES = ['vendor', 'domain'] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];
export type BudgetPeriod = 'day' | 'month';

export type BudgetRefusal = 'vendor_day' | 'vendor_month' | 'domain_day' | 'domain_month';
const REFUSALS: readonly BudgetRefusal[] = [
  'vendor_day',
  'vendor_month',
  'domain_day',
  'domain_month',
];

export interface SpendReservation {
  keys: [string, string, string, string];
  reserved: number;
}

export interface BudgetAlert {
  scope: BudgetScope;
  subject: string;
  period: BudgetPeriod;
  level: 50 | 80 | 100;
  spentMicroUsd: number;
  capMicroUsd: number;
}

export interface BudgetLine {
  scope: BudgetScope;
  subject: string;
  dailyCapMicroUsd: number;
  monthlyCapMicroUsd: number;
  spentTodayMicroUsd: number;
  spentThisMonthMicroUsd: number;
  /** False while the caps are the defaults from settings. */
  set: boolean;
}

const dayOf = (now: Date): string => now.toISOString().slice(0, 10);
const monthOf = (now: Date): string => now.toISOString().slice(0, 7);
const spendKey = (scope: BudgetScope, subject: string, period: string): string =>
  `pi:spend:${scope}:${subject}:${period}`;

/**
 * What reading may cost (ADR-102): per UTC day and month, per vendor and per site. A read
 * reserves its estimate before a vendor is called and settles to what the vendor reports; at a
 * cap nothing more is read until the period ends or an admin raises the cap. Crossing 50, 80
 * and 100% of a cap is reported once each per period.
 */
@Injectable()
export class PriceIntelBudget {
  private caps: { at: number; rows: Map<string, { daily: number; monthly: number }> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Reserves `amount` for a call by `vendor` to `domain`, or says which cap refuses it. */
  async reserve(
    vendor: ScrapeVendor,
    domain: string,
    amount: number,
    now: Date = new Date(),
  ): Promise<SpendReservation | BudgetRefusal> {
    const vendorCaps = await this.capsFor('vendor', vendor);
    const domainCaps = await this.capsFor('domain', domain);
    const keys: SpendReservation['keys'] = [
      spendKey('vendor', vendor, dayOf(now)),
      spendKey('vendor', vendor, monthOf(now)),
      spendKey('domain', domain, dayOf(now)),
      spendKey('domain', domain, monthOf(now)),
    ];
    const result = Number(
      await this.redis.eval(
        RESERVE,
        4,
        ...keys,
        Math.max(0, Math.round(amount)),
        vendorCaps.daily,
        vendorCaps.monthly,
        domainCaps.daily,
        domainCaps.monthly,
        DAY_TTL_SECONDS,
        MONTH_TTL_SECONDS,
        DAY_TTL_SECONDS,
        MONTH_TTL_SECONDS,
      ),
    );
    if (result !== 0) return REFUSALS[result - 1] ?? 'vendor_day';
    return { keys, reserved: Math.max(0, Math.round(amount)) };
  }

  /** Replaces a reservation with what the call cost (0 when nothing was fetched). */
  async settle(reservation: SpendReservation, actual: number): Promise<void> {
    const delta = Math.max(0, Math.round(actual)) - reservation.reserved;
    if (delta === 0) return;
    await this.redis.eval(SETTLE, 4, ...reservation.keys, delta);
  }

  /**
   * The thresholds a vendor's and a site's spend have newly crossed. Each is returned once per
   * period (a Redis marker remembers it), so the caller can tell staff without repeating itself.
   */
  async newAlerts(
    vendor: ScrapeVendor,
    domain: string,
    now: Date = new Date(),
  ): Promise<BudgetAlert[]> {
    const alerts: BudgetAlert[] = [];
    for (const [scope, subject] of [
      ['vendor', vendor],
      ['domain', domain],
    ] as const) {
      const caps = await this.capsFor(scope, subject);
      for (const [period, label, cap, ttl] of [
        ['day', dayOf(now), caps.daily, DAY_TTL_SECONDS],
        ['month', monthOf(now), caps.monthly, MONTH_TTL_SECONDS],
      ] as const) {
        const spent = Number((await this.redis.get(spendKey(scope, subject, label))) ?? 0);
        const level = budgetAlertLevel(spent, cap);
        if (level === null) continue;
        const marker = `pi:alert:${scope}:${subject}:${label}:${level}`;
        if ((await this.redis.set(marker, '1', 'EX', ttl, 'NX')) !== 'OK') continue;
        alerts.push({ scope, subject, period, level, spentMicroUsd: spent, capMicroUsd: cap });
      }
    }
    return alerts;
  }

  /** Caps and spend of the given vendors and sites, for the console. */
  async lines(
    subjects: readonly { scope: BudgetScope; subject: string }[],
    now: Date = new Date(),
  ): Promise<BudgetLine[]> {
    await this.loadCaps(true);
    const lines: BudgetLine[] = [];
    for (const { scope, subject } of subjects) {
      const caps = await this.capsFor(scope, subject);
      const [today, month] = await this.redis.mget(
        spendKey(scope, subject, dayOf(now)),
        spendKey(scope, subject, monthOf(now)),
      );
      lines.push({
        scope,
        subject,
        dailyCapMicroUsd: caps.daily,
        monthlyCapMicroUsd: caps.monthly,
        spentTodayMicroUsd: Number(today ?? 0),
        spentThisMonthMicroUsd: Number(month ?? 0),
        set: caps.set,
      });
    }
    return lines;
  }

  /** Forgets the memory copy of the caps after an admin changed one. */
  invalidate(): void {
    this.caps = null;
  }

  private async capsFor(
    scope: BudgetScope,
    subject: string,
  ): Promise<{ daily: number; monthly: number; set: boolean }> {
    const rows = await this.loadCaps(false);
    const row = rows.get(`${scope}:${subject}`);
    if (row) return { ...row, set: true };
    return scope === 'vendor'
      ? {
          daily: this.config.PRICE_INTEL_VENDOR_DAILY_MICROUSD,
          monthly: this.config.PRICE_INTEL_VENDOR_MONTHLY_MICROUSD,
          set: false,
        }
      : {
          daily: this.config.PRICE_INTEL_DOMAIN_DAILY_MICROUSD,
          monthly: this.config.PRICE_INTEL_DOMAIN_MONTHLY_MICROUSD,
          set: false,
        };
  }

  private async loadCaps(fresh: boolean): Promise<Map<string, { daily: number; monthly: number }>> {
    if (!fresh && this.caps && Date.now() - this.caps.at < CAP_CACHE_MS) return this.caps.rows;
    const rows = await this.prisma.providerBudget.findMany();
    const map = new Map(
      rows.map((row) => [
        `${row.scope}:${row.subject}`,
        { daily: Number(row.dailyCapMicroUsd), monthly: Number(row.monthlyCapMicroUsd) },
      ]),
    );
    this.caps = { at: Date.now(), rows: map };
    return map;
  }
}
