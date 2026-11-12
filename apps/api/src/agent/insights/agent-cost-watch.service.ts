import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AuditService } from '../../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { PrismaService } from '../../infra/prisma.service';
import { REDIS } from '../../infra/redis';
import { EmailProvider } from '../../notifications/email';
import { opsAlertTemplate } from '../../notifications/templates';
import { agentCostAlerts } from '../../telemetry/metrics';

import {
  costAlertLevel,
  monthKey,
  monthSpend,
  monthStartOf,
  type CostAlertLevel,
  type MonthSpend,
} from './agent-cost';
import type { AgentCostCheck } from './agent-insights.schemas';

/** A told alert is remembered for the rest of its month and a little beyond. */
const TOLD_SECONDS = 40 * 24 * 60 * 60;

const usd = (microUsd: number): string => (microUsd / 1_000_000).toFixed(2);

/**
 * Watches what the assistant costs over a month (ADR-106). The daily caps stop a bad day; this
 * says, once, when the month is heading past the figure the owner set, or is past it. It only
 * tells: it pauses nothing and changes no cap. Every figure is an estimate, the tokens the
 * models reported at the configured prices, and the alert says so.
 */
@Injectable()
export class AgentCostWatch {
  private readonly logger = new Logger(AgentCostWatch.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The month's spend so far and its forecast, from the runs' settled cost. */
  async month(now: Date = new Date()): Promise<MonthSpend> {
    const spent = await this.prisma.agentRun.aggregate({
      where: { startedAt: { gte: monthStartOf(now) } },
      _sum: { costMicroUsd: true },
    });
    return monthSpend(Number(spent._sum.costMicroUsd ?? 0n), now);
  }

  /**
   * The worker's sweep: reads the month and tells operations once per month and level when it
   * calls for it. A second replica, or a second sweep, finds the alert already told.
   */
  async check(now: Date = new Date()): Promise<AgentCostCheck> {
    const month = await this.month(now);
    const alertAtMicroUsd = this.config.AGENT_MONTHLY_ALERT_MICROUSD;
    const level = costAlertLevel(month, alertAtMicroUsd);
    const told = level !== null && (await this.claim(level, now));
    if (level !== null && told) await this.tell(level, month, now);
    return {
      toDateMicroUsd: month.toDateMicroUsd,
      forecastMicroUsd: month.forecastMicroUsd,
      alertAtMicroUsd,
      level,
      told,
    };
  }

  /** True for the one caller that gets to tell this month's alert at this level. */
  private async claim(level: CostAlertLevel, now: Date): Promise<boolean> {
    try {
      const set = await this.redis.set(
        `agent:cost-alert:${monthKey(now)}:${level}`,
        now.toISOString(),
        'EX',
        TOLD_SECONDS,
        'NX',
      );
      return set === 'OK';
    } catch {
      // Without the shared record an alert could repeat every sweep: better late than that.
      this.logger.warn('the assistant cost alert could not be claimed');
      return false;
    }
  }

  private async tell(level: CostAlertLevel, month: MonthSpend, now: Date): Promise<void> {
    const facts = {
      month: monthKey(now),
      level,
      spentSoFarUsd: usd(month.toDateMicroUsd),
      forecastUsd: usd(month.forecastMicroUsd),
      alertAtUsd: usd(this.config.AGENT_MONTHLY_ALERT_MICROUSD),
      daysElapsed: String(month.daysElapsed),
      daysInMonth: String(month.daysInMonth),
      basis: 'estimate: reported tokens at configured prices, not an invoice',
    };
    agentCostAlerts.add(1, { level });
    this.logger.warn({ kind: 'assistant cost', ...facts }, 'operations alert');
    try {
      await this.audit.record({
        action: 'agent.cost_alert',
        actorType: 'system',
        targetType: 'agent',
        metadata: facts,
      });
      const to = this.config.OPS_ALERT_EMAIL;
      if (to) {
        await this.email.send({
          to,
          ...opsAlertTemplate({ kind: 'assistant cost', bookingReference: null, facts }),
        });
      }
    } catch {
      // An alert that cannot be delivered never fails the sweep; the log line above stands.
      this.logger.warn('the assistant cost alert could not be delivered');
    }
  }
}
