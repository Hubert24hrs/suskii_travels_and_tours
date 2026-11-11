import { Inject, Injectable } from '@nestjs/common';

import type { AgentPauseReason } from '@suskii/shared';

import { conflict, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../infra/prisma.service';
import { agentPauses } from '../telemetry/metrics';

import { AgentBudget } from './agent-budget';
import { AgentFlags } from './agent-flags';
import { AgentPause, type AgentPauseState } from './agent-pause';
import { AgentSettingsService } from './agent-settings.service';
import { AgentToolRegistry } from './agent-tool';
import type { AdminAgentOverview } from './agent.schemas';

/**
 * What staff see and switch in the AI Control Center (ADR-107). Pausing needs `ai:manage` and
 * nothing more, so it is one press in an incident; releasing the pause and changing autonomy
 * also need a fresh authenticator check. Every change is audited with codes only.
 */
@Injectable()
export class AgentAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly flags: AgentFlags,
    private readonly pauseSwitch: AgentPause,
    private readonly budget: AgentBudget,
    private readonly settings: AgentSettingsService,
    private readonly tools: AgentToolRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async overview(now = new Date()): Promise<AdminAgentOverview> {
    const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const [pause, todayMicroUsd, today, waiting, failedToday, autonomy, disabledAgents] =
      await Promise.all([
        this.pauseSwitch.state(),
        this.budget.spentToday(now),
        this.prisma.agentRun.count({ where: { startedAt: { gte: dayStart } } }),
        this.prisma.agentRun.count({ where: { status: 'waiting' } }),
        this.prisma.agentRun.count({ where: { status: 'failed', startedAt: { gte: dayStart } } }),
        this.settings.autonomy(),
        this.settings.disabledAgents(),
      ]);
    return {
      enabled: this.flags.enabled(),
      priceIntelEnabled: this.flags.priceIntel(),
      serviceConfigured: this.flags.configured(),
      pause,
      spend: { todayMicroUsd, dailyCapMicroUsd: this.config.AGENT_GLOBAL_DAILY_MICROUSD },
      runs: { today, waiting, failedToday },
      autonomy,
      disabledAgents,
      tools: this.tools.describe().map(({ name, description, tier, scope, agents }) => ({
        name,
        description,
        tier,
        scope,
        agents,
      })),
    };
  }

  async pause(reason: AgentPauseReason, staff: StaffActor): Promise<AgentPauseState> {
    if (!(await this.pauseSwitch.pause(reason))) {
      throw conflict('agent-already-paused', 'The assistant is already paused');
    }
    agentPauses.add(1, { change: 'paused', reason });
    await this.audit.record({
      action: 'agent.paused',
      actorUserId: staff.userId,
      targetType: 'agent',
      metadata: { reason },
      context: staff.context,
    });
    return this.pauseSwitch.state();
  }

  async resume(staff: StaffActor): Promise<AgentPauseState> {
    const before = await this.pauseSwitch.state();
    if (!(await this.pauseSwitch.resume())) {
      throw conflict('agent-not-paused', 'The assistant is not paused');
    }
    agentPauses.add(1, { change: 'resumed', reason: before.reason ?? 'other' });
    await this.audit.record({
      action: 'agent.resumed',
      actorUserId: staff.userId,
      targetType: 'agent',
      metadata: { reason: before.reason, pausedSince: before.since },
      context: staff.context,
    });
    return this.pauseSwitch.state();
  }
}
