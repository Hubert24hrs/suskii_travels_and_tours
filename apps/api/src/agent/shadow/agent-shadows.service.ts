import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AgentRunEnd, AgentRunRequest, AgentRunShadow } from '@suskii/shared';

import type { BudgetReservation } from '../../ai-search/ai-search-budget';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { PrismaService } from '../../infra/prisma.service';
import { agentShadowTurns } from '../../telemetry/metrics';
import { AgentBudget } from '../agent-budget';
import { runCostMicroUsd } from '../chat/agent-pricing';

/** What a run was allowed to try in its shadow, and the spend held for it. */
export interface ShadowPlan {
  prompts: string[];
  reservation: BudgetReservation;
}

/**
 * Shadow turns (ADR-106). A candidate prompt version answers nobody: it is tried beside a
 * share of travellers' turns, after the answer has gone out, and only how it did comes back
 * (which agent, how the turn ended, how many of its tool calls the live turn's results could
 * answer, what it cost). This service decides which runs are shadowed, holds the spend for
 * them apart from the assistant's own, and keeps the figures. It never sees a candidate's
 * words: the agent service does not send them.
 */
@Injectable()
export class AgentShadows {
  private readonly logger = new Logger(AgentShadows.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly budget: AgentBudget,
  ) {}

  /** Whether any run can be shadowed at all: candidates are named and a share is set. */
  get configured(): boolean {
    return (
      this.config.AGENT_SHADOW_PROMPTS.length > 0 && this.config.AGENT_SHADOW_SAMPLE_PERCENT > 0
    );
  }

  /**
   * The candidates to try beside a run, or null: for most runs, for a turn that is not a plain
   * message, for one that continues a turn waiting for a tap (a message written instead of
   * the tap: there is nothing to compare), and whenever the day's shadow spend is used up.
   * `draw` is a number from 0 up to 1 (a test passes its own).
   */
  async plan(
    input: AgentRunRequest['input'],
    continuesWaitingTurn: boolean,
    draw: number = Math.random(),
  ): Promise<ShadowPlan | null> {
    if (!this.configured || input.kind !== 'message' || continuesWaitingTurn) return null;
    if (draw * 100 >= this.config.AGENT_SHADOW_SAMPLE_PERCENT) return null;
    const reserved = await this.budget.reserveShadow();
    if (typeof reserved === 'string') {
      agentShadowTurns.add(1, { status: 'over_budget' });
      return null;
    }
    return { prompts: [...this.config.AGENT_SHADOW_PROMPTS], reservation: reserved };
  }

  /** Keeps what came of a shadow turn and settles its spend to what its model calls cost. */
  async record(
    runId: string,
    live: Pick<AgentRunEnd, 'agent'>,
    shadow: AgentRunShadow,
    plan: ShadowPlan,
  ): Promise<void> {
    const { costMicroUsd } = runCostMicroUsd(shadow.usage, this.config.AGENT_MODEL_PRICES);
    const tokens = shadow.usage.reduce(
      (sum, line) => ({
        input: sum.input + line.inputTokens,
        output: sum.output + line.outputTokens,
      }),
      { input: 0, output: 0 },
    );
    const data = {
      status: shadow.status,
      prompts: shadow.prompts,
      liveAgent: live.agent,
      agent: shadow.agent,
      outcome: shadow.outcome,
      steps: shadow.steps,
      replayed: shadow.replayed,
      missed: shadow.missed,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      costMicroUsd: BigInt(costMicroUsd),
    };
    await this.prisma.agentShadowRun.upsert({
      where: { runId },
      create: { runId, ...data },
      update: data,
    });
    agentShadowTurns.add(1, { status: shadow.status });
    // A turn that broke reports no usage but may have been billed: its reservation stands.
    if (shadow.status !== 'failed') {
      await this.budget.settle(plan.reservation, costMicroUsd).catch(() => undefined);
    }
  }

  /**
   * No line came back. When the traveller's turn did not end in an answer the agent service
   * never starts a shadow turn, so nothing was spent; otherwise one may have run and been
   * billed before the stream broke, and the reservation stands.
   */
  async unreported(plan: ShadowPlan, liveOutcome: AgentRunEnd['outcome'] | null): Promise<void> {
    if (liveOutcome === 'answered') {
      agentShadowTurns.add(1, { status: 'unreported' });
      this.logger.warn('a shadow turn was asked for and nothing came back');
      return;
    }
    await this.budget.settle(plan.reservation, 0).catch(() => undefined);
  }
}
