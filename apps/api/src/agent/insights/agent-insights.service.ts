import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AGENT_APPROVAL_DAYS,
  AGENT_CONFIRMATION_MINUTES,
  AGENT_CONVERSATION_MESSAGE_LIMIT,
  AGENT_MESSAGE_MAX,
  type AgentAudience,
  type AgentChannel,
} from '@suskii/shared';

import type { StaffActor } from '../../admin/admin-helpers';
import { scrubQuery } from '../../ai-search/scrub';
import { AuditService } from '../../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import type { AgentConversation, AgentRun, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { AgentConversationsService } from '../chat/agent-conversations.service';

import type {
  AdminAgentConversation,
  AdminAgentConversationSummary,
  AdminAgentCost,
  AdminAgentLimits,
  AdminAgentQuality,
  AdminAgentRun,
  AdminAgentRunQuery,
  AdminAgentRunTrace,
} from './agent-insights.schemas';

const DAY_MS = 86_400_000;
const day = (date: Date): string => date.toISOString().slice(0, 10);
const startOfDay = (date: Date): Date => new Date(`${day(date)}T00:00:00.000Z`);

/** Outcomes that mean the run broke, as opposed to ending as designed. */
const FAILED_OUTCOMES = ['failed', 'model_error', 'timeout'];
/** The tools that search what Suskii sells: a conversation that ran one looked for a trip. */
const SEARCH_TOOLS = [
  'flights.search',
  'hotels.search',
  'cars.rentals',
  'cars.buses',
  'packages.search',
  'tours.search',
];

interface Spend {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

interface SumRow {
  _count: { _all: number };
  _sum: { inputTokens: number | null; outputTokens: number | null; costMicroUsd: bigint | null };
}

const spendOf = (row: SumRow): Spend => ({
  runs: row._count._all,
  inputTokens: row._sum.inputTokens ?? 0,
  outputTokens: row._sum.outputTokens ?? 0,
  costMicroUsd: Number(row._sum.costMicroUsd ?? 0n),
});

const SUM = { inputTokens: true, outputTokens: true, costMicroUsd: true } as const;

/**
 * What staff see of the assistant's work (ADR-105, ADR-107): runs with the tools they called,
 * travellers' conversations with contact details removed, what it cost and how its answers
 * fared. All of it is read from the operations records, which hold ids, counts and codes; only
 * the conversation monitor opens what was said, and every such read is audited.
 */
@Injectable()
export class AgentInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: AgentConversationsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // --- Runs --------------------------------------------------------------------------------

  async runs(
    query: AdminAgentRunQuery,
  ): Promise<{ items: AdminAgentRun[]; nextCursor: string | null }> {
    const where: Prisma.AgentRunWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.agent ? { agent: query.agent } : {}),
      ...(query.audience ? { audience: query.audience } : {}),
      // Ids are time-ordered (UUID v7): the newest run first, and the cursor is the last id.
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };
    const rows = await this.prisma.agentRun.findMany({
      where,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((row) => this.run(row)),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /** One run with every call it made through the gateway, in order. */
  async trace(runId: string): Promise<AdminAgentRunTrace> {
    const row = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: { toolCalls: { orderBy: { id: 'asc' } } },
    });
    if (!row) throw new NotFoundException();
    return {
      ...this.run(row),
      toolCalls: row.toolCalls.map((call) => ({
        id: call.id,
        agent: call.agent,
        tool: call.tool,
        tier:
          call.tier === 'read' || call.tier === 'propose' || call.tier === 'commit'
            ? call.tier
            : 'none',
        status: call.status,
        reason: call.reason,
        argumentKeys: call.argumentKeys,
        durationMs: call.durationMs,
        createdAt: call.createdAt.toISOString(),
      })),
    };
  }

  // --- The conversation monitor ----------------------------------------------------------------

  /** Travellers' conversations, newest first. Staff conversations are their owners' alone. */
  async conversationList(
    cursor: string | undefined,
    limit: number,
  ): Promise<{ items: AdminAgentConversationSummary[]; nextCursor: string | null }> {
    const rows = await this.prisma.agentConversation.findMany({
      where: { audience: 'customer', ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return {
      items: items.map((row) => this.summary(row)),
      nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * One traveller's conversation as the model saw it: contact details, card-like and
   * document-like numbers removed. The read is audited with the conversation's id only.
   */
  async conversation(conversationId: string, staff: StaffActor): Promise<AdminAgentConversation> {
    const row = await this.prisma.agentConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { id: 'asc' } } },
    });
    if (row?.audience !== 'customer') throw new NotFoundException();
    await this.audit.record({
      action: 'agent.conversation_viewed',
      actorUserId: staff.userId,
      targetType: 'agent_conversation',
      targetId: row.id,
      context: staff.context,
    });
    return {
      ...this.summary(row),
      messages: row.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => {
          const shown = this.conversations.message(message);
          return {
            id: shown.id,
            role: shown.role,
            kind: shown.kind,
            agent: shown.agent,
            text: scrubQuery(shown.text),
            notice: shown.notice,
            cards: shown.cards.length,
            feedback: shown.feedback,
            runId: message.runId,
            createdAt: shown.createdAt,
          };
        }),
    };
  }

  // --- Cost ----------------------------------------------------------------------------------

  async cost(days: number, now = new Date()): Promise<AdminAgentCost> {
    const from = new Date(startOfDay(now).getTime() - (days - 1) * DAY_MS);
    const where = { startedAt: { gte: from } };
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const [total, byAgent, byModel, byChannel, byDay, topAccounts, month] = await Promise.all([
      this.prisma.agentRun.aggregate({ where, _count: { _all: true }, _sum: SUM }),
      this.prisma.agentRun.groupBy({ by: ['agent'], where, _count: { _all: true }, _sum: SUM }),
      this.prisma.agentRun.groupBy({
        by: ['model'],
        where: { ...where, model: { not: null } },
        _count: { _all: true },
        _sum: SUM,
      }),
      this.prisma.agentRun.groupBy({
        by: ['channel', 'audience'],
        where,
        _count: { _all: true },
        _sum: { costMicroUsd: true },
      }),
      this.prisma.$queryRaw<{ day: Date; runs: bigint; cost: bigint | null }[]>`
        SELECT date_trunc('day', started_at AT TIME ZONE 'UTC') AS day,
               count(*) AS runs, sum(cost_micro_usd) AS cost
          FROM agent_runs
         WHERE started_at >= ${from}
         GROUP BY 1
         ORDER BY 1`,
      this.prisma.$queryRaw<{ user_id: string; runs: bigint; cost: bigint | null }[]>`
        SELECT c.user_id, count(*) AS runs, sum(r.cost_micro_usd) AS cost
          FROM agent_runs r
          JOIN agent_conversations c ON c.id = r.conversation_id
         WHERE r.started_at >= ${from} AND c.user_id IS NOT NULL AND c.audience = 'customer'
         GROUP BY c.user_id
         ORDER BY cost DESC NULLS LAST, runs DESC
         LIMIT 10`,
      this.prisma.agentRun.aggregate({
        where: { startedAt: { gte: monthStart } },
        _sum: { costMicroUsd: true },
      }),
    ]);
    const byCost = <T extends { costMicroUsd: number }>(rows: T[]): T[] =>
      rows.sort((a, b) => b.costMicroUsd - a.costMicroUsd);
    const toDateMicroUsd = Number(month._sum.costMicroUsd ?? 0n);
    // The part of the month that has passed, with today counted by the hour.
    const elapsed = (now.getTime() - monthStart.getTime()) / DAY_MS;
    return {
      from: day(from),
      to: day(now),
      basis: 'usage_at_configured_prices',
      total: spendOf(total),
      byDay: byDay.map((row) => ({
        day: day(row.day),
        runs: Number(row.runs),
        costMicroUsd: Number(row.cost ?? 0n),
      })),
      byAgent: byCost(byAgent.map((row) => ({ agent: row.agent, ...spendOf(row) }))),
      byModel: byCost(byModel.map((row) => ({ model: row.model ?? '', ...spendOf(row) }))),
      byChannel: byCost(
        byChannel.map((row) => ({
          channel: row.channel as AgentChannel,
          audience: row.audience as AgentAudience,
          runs: row._count._all,
          costMicroUsd: Number(row._sum.costMicroUsd ?? 0n),
        })),
      ),
      topAccounts: topAccounts.map((row) => ({
        userId: row.user_id,
        runs: Number(row.runs),
        costMicroUsd: Number(row.cost ?? 0n),
      })),
      month: {
        toDateMicroUsd,
        forecastMicroUsd: elapsed > 0 ? Math.round((toDateMicroUsd / elapsed) * daysInMonth) : 0,
        daysElapsed: Math.max(1, Math.ceil(elapsed)),
        daysInMonth,
      },
      caps: {
        globalDailyMicroUsd: this.config.AGENT_GLOBAL_DAILY_MICROUSD,
        userDailyMicroUsd: this.config.AGENT_USER_DAILY_MICROUSD,
        guestDailyMicroUsd: this.config.AGENT_GUEST_DAILY_MICROUSD,
      },
    };
  }

  // --- Quality -------------------------------------------------------------------------------

  async quality(days: number, now = new Date()): Promise<AdminAgentQuality> {
    const from = new Date(startOfDay(now).getTime() - (days - 1) * DAY_MS);
    // A run that still works has no outcome to count yet.
    const where = { startedAt: { gte: from }, outcome: { not: null } };
    const [outcomes, prompts, feedback, promptFeedback] = await Promise.all([
      this.prisma.agentRun.groupBy({ by: ['outcome'], where, _count: { _all: true } }),
      this.prisma.agentRun.groupBy({
        by: ['promptVersion', 'outcome'],
        where: { ...where, promptVersion: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.agentMessage.groupBy({
        by: ['feedback'],
        where: { createdAt: { gte: from }, feedback: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ prompt_version: string; feedback: string; n: bigint }[]>`
        SELECT r.prompt_version, m.feedback::text AS feedback, count(*) AS n
          FROM agent_messages m
          JOIN agent_runs r ON r.id = m.run_id
         WHERE m.created_at >= ${from} AND m.feedback IS NOT NULL AND r.prompt_version IS NOT NULL
         GROUP BY 1, 2`,
    ]);
    const [scores, funnel] = await Promise.all([
      this.prisma.agentConversation.groupBy({
        by: ['rating'],
        where: { ratedAt: { gte: from }, rating: { not: null } },
        _count: { _all: true },
      }),
      // Travellers' conversations started in the period, counted once per step they reached.
      this.prisma.$queryRaw<
        {
          conversations: bigint;
          answered: bigint;
          searched: bigint;
          asked_for_a_price: bigint;
          asked_to_confirm: bigint;
          confirmed: bigint;
          handed_over: bigint;
        }[]
      >`
        SELECT count(*) AS conversations,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM agent_runs r
                  WHERE r.conversation_id = c.id AND r.outcome = 'answered')) AS answered,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM agent_tool_calls t JOIN agent_runs r ON r.id = t.run_id
                  WHERE r.conversation_id = c.id AND t.status = 'ok'
                    AND t.tool = ANY(${SEARCH_TOOLS}))) AS searched,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM agent_tool_calls t JOIN agent_runs r ON r.id = t.run_id
                  WHERE r.conversation_id = c.id AND t.status = 'ok'
                    AND t.tool = 'quotes.request')) AS asked_for_a_price,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM agent_confirmations k
                  WHERE k.conversation_id = c.id)) AS asked_to_confirm,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM agent_confirmations k
                  WHERE k.conversation_id = c.id AND k.status = 'confirmed')) AS confirmed,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM agent_runs r
                  WHERE r.conversation_id = c.id AND r.outcome = 'handover')) AS handed_over
          FROM agent_conversations c
         WHERE c.created_at >= ${from} AND c.audience = 'customer'`,
    ]);
    const rated = scores.reduce((sum, row) => sum + row._count._all, 0);
    const points = scores.reduce((sum, row) => sum + (row.rating ?? 0) * row._count._all, 0);
    const reached = funnel[0];
    const runsWith = (outcome: string): number =>
      outcomes.find((row) => row.outcome === outcome)?._count._all ?? 0;
    const thumbs = (value: 'up' | 'down'): number =>
      feedback.find((row) => row.feedback === value)?._count._all ?? 0;
    const versions = [...new Set(prompts.map((row) => row.promptVersion ?? ''))].sort();
    return {
      from: day(from),
      to: day(now),
      runs: outcomes.reduce((sum, row) => sum + row._count._all, 0),
      answered: runsWith('answered'),
      handovers: runsWith('handover'),
      guardBlocked: runsWith('guard_blocked'),
      failed: FAILED_OUTCOMES.reduce((sum, outcome) => sum + runsWith(outcome), 0),
      outcomes: outcomes
        .map((row) => ({ outcome: row.outcome ?? '', runs: row._count._all }))
        .sort((a, b) => b.runs - a.runs),
      feedback: { up: thumbs('up'), down: thumbs('down') },
      ratings: {
        rated,
        averageTenths: rated > 0 ? Math.round((points * 10) / rated) : null,
        scores: [1, 2, 3, 4, 5].map((score) => ({
          score,
          conversations: scores.find((row) => row.rating === score)?._count._all ?? 0,
        })),
      },
      funnel: {
        conversations: Number(reached?.conversations ?? 0n),
        answered: Number(reached?.answered ?? 0n),
        searched: Number(reached?.searched ?? 0n),
        askedForAPrice: Number(reached?.asked_for_a_price ?? 0n),
        askedToConfirm: Number(reached?.asked_to_confirm ?? 0n),
        confirmed: Number(reached?.confirmed ?? 0n),
        handedOver: Number(reached?.handed_over ?? 0n),
      },
      prompts: versions.map((promptVersion) => {
        const of = (outcome?: string): number =>
          prompts
            .filter(
              (row) => row.promptVersion === promptVersion && (!outcome || row.outcome === outcome),
            )
            .reduce((sum, row) => sum + row._count._all, 0);
        const voted = (value: string): number =>
          Number(
            promptFeedback.find(
              (row) => row.prompt_version === promptVersion && row.feedback === value,
            )?.n ?? 0n,
          );
        return {
          promptVersion,
          runs: of(),
          answered: of('answered'),
          guardBlocked: of('guard_blocked'),
          up: voted('up'),
          down: voted('down'),
        };
      }),
    };
  }

  // --- Limits --------------------------------------------------------------------------------

  /** The limits the assistant runs under, as configured: read here, changed in the settings. */
  limits(): AdminAgentLimits {
    const { config } = this;
    return {
      runMaxSteps: config.AGENT_RUN_MAX_STEPS,
      runMaxToolCalls: config.AGENT_RUN_MAX_TOOL_CALLS,
      runTimeoutMs: config.AGENT_RUN_TIMEOUT_MS,
      grantTtlSeconds: config.AGENT_GRANT_TTL_SECONDS,
      maxOutputTokens: config.AGENT_MAX_OUTPUT_TOKENS,
      runReserveMicroUsd: config.AGENT_RUN_RESERVE_MICROUSD,
      userDailyMicroUsd: config.AGENT_USER_DAILY_MICROUSD,
      guestDailyMicroUsd: config.AGENT_GUEST_DAILY_MICROUSD,
      globalDailyMicroUsd: config.AGENT_GLOBAL_DAILY_MICROUSD,
      confirmationMinutes: AGENT_CONFIRMATION_MINUTES,
      approvalDays: AGENT_APPROVAL_DAYS,
      messageMax: AGENT_MESSAGE_MAX,
      conversationMessageLimit: AGENT_CONVERSATION_MESSAGE_LIMIT,
      models: Object.entries(config.AGENT_MODEL_PRICES)
        .map(([model, price]) => ({
          model,
          inputPerMillion: price.input,
          outputPerMillion: price.output,
          cacheReadPerMillion: price.cacheRead,
          cacheWritePerMillion: price.cacheWrite,
        }))
        .sort((a, b) => a.model.localeCompare(b.model)),
    };
  }

  private run(row: AgentRun): AdminAgentRun {
    return {
      id: row.id,
      conversationId: row.conversationId,
      audience: row.audience as AgentAudience,
      channel: row.channel as AgentChannel,
      agent: row.agent,
      agents: row.agents,
      trigger: row.trigger,
      status: row.status,
      outcome: row.outcome,
      model: row.model,
      promptVersion: row.promptVersion,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costMicroUsd: Number(row.costMicroUsd),
      steps: row.steps,
      toolCallCount: row.toolCallCount,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
    };
  }

  private summary(row: AgentConversation): AdminAgentConversationSummary {
    return {
      id: row.id,
      reference: row.reference,
      channel: row.channel as AgentChannel,
      locale: row.locale,
      userId: row.userId,
      status: row.status,
      messageCount: row.messageCount,
      handedOver: row.handoverConversationId !== null,
      lastMessageAt: row.lastMessageAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
