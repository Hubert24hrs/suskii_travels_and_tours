import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

import {
  AGENT_NAMES,
  AGENT_TOOL_NAME_PATTERN,
  agentAudience,
  agentsFor,
  tierRuns,
  type AgentName,
  type AgentToolDenial,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import type { AgentToolCallStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { ErrorReporter } from '../telemetry/error-reporter';
import { agentToolCalls, agentToolDuration } from '../telemetry/metrics';

import { AgentFlags } from './agent-flags';
import { AgentGrants, type AgentGrant } from './agent-grants';
import { AgentPause } from './agent-pause';
import { AgentSettingsService } from './agent-settings.service';
import { AgentToolError, AgentToolRegistry, type AgentTool } from './agent-tool';
import type { agentToolAnswerSchema, agentToolCallSchema } from './agent.schemas';
import { AgentConfirmationsService } from './confirmations/agent-confirmations.service';

export type AgentToolCall = z.infer<typeof agentToolCallSchema>;
export type AgentToolAnswer = z.infer<typeof agentToolAnswerSchema>;

/** A tool that has not answered by now is given up on; searches are the slowest callers. */
export const AGENT_TOOL_TIMEOUT_MS = 25_000;
/** A name that is not a tool's is recorded under this, so the table never holds model text. */
const UNKNOWN_TOOL = 'unknown';
const MAX_ISSUES = 8;

/** Refusals of the gateway itself are `denied`; a tool that ran and could not answer `error`. */
const STATUS_OF: Record<AgentToolDenial, AgentToolCallStatus> = {
  disabled: 'denied',
  paused: 'denied',
  grant: 'denied',
  unknown_tool: 'denied',
  agent: 'denied',
  scope: 'denied',
  autonomy: 'denied',
  confirmation_required: 'denied',
  limit: 'denied',
  invalid: 'denied',
  not_found: 'error',
  refused: 'error',
  failed: 'error',
  timeout: 'timeout',
};

class ToolTimeout extends Error {}

/**
 * The only door between the agent service and the platform (ADR-101). Every call is decided
 * here, in this order: the assistant is on and not paused; the grant is ours, unexpired and for
 * a run that is still running; the run has calls left; the tool exists and is this agent's; the
 * grant opens the tool's scope; the tier may run at the current autonomy; the arguments fit.
 * Only then does the tool run, as the grant's caller, and only what its output schema names
 * goes back. A `commit` tool does not run at all: the gateway asks it what the traveller
 * would be confirming, stores that as a confirmation and answers with its id (ADR-107). Each
 * call is recorded with the names of its arguments, never their values.
 */
@Injectable()
export class AgentToolGateway {
  private readonly logger = new Logger(AgentToolGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: AgentFlags,
    private readonly pause: AgentPause,
    private readonly grants: AgentGrants,
    private readonly registry: AgentToolRegistry,
    private readonly settings: AgentSettingsService,
    private readonly confirmations: AgentConfirmationsService,
    private readonly errors: ErrorReporter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async call(toolName: string, request: AgentToolCall): Promise<AgentToolAnswer> {
    const started = Date.now();
    const tool = this.registry.get(toolName);
    const recorded = tool?.name ?? UNKNOWN_TOOL;
    const argumentKeys = Object.keys(request.arguments)
      .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key))
      .slice(0, 24);

    const grant = this.grants.open(request.grant);
    // Without a grant there is no run to record against; the metric still counts it.
    if (!grant) return this.finish(null, recorded, tool, request.agent, 'grant', [], started);

    const refuse = (reason: AgentToolDenial, issues?: AgentToolAnswer['issues']) =>
      this.finish(grant, recorded, tool, request.agent, reason, argumentKeys, started, issues);

    if (!this.flags.enabled()) return refuse('disabled');
    if (await this.pause.paused()) return refuse('paused');

    // One statement checks the run and takes one of its calls, so a model that keeps calling
    // (refused calls included) stops at the cap, and a finished run's grant is dead at once.
    const slot = await this.prisma.agentRun.updateMany({
      where: {
        id: grant.runId,
        status: 'running',
        toolCallCount: { lt: this.config.AGENT_RUN_MAX_TOOL_CALLS },
      },
      data: { toolCallCount: { increment: 1 } },
    });
    if (slot.count === 0) {
      const run = await this.prisma.agentRun.findUnique({
        where: { id: grant.runId },
        select: { status: true },
      });
      return refuse(run?.status === 'running' ? 'limit' : 'grant');
    }

    if (!tool || !AGENT_TOOL_NAME_PATTERN.test(toolName)) return refuse('unknown_tool');
    const agent = agentOf(request.agent, grant);
    if (!agent || !tool.agents.includes(agent)) return refuse('agent');
    if (!grant.scopes.includes(tool.scope)) return refuse('scope');
    const policy = await this.settings.policyFor(agent, tool.name);
    // An agent staff switched off calls nothing, whatever the agent service names.
    if (!policy.enabled) return refuse('agent');
    // Advice only prepares nothing: not a draft, and not a confirmation either.
    if (!tierRuns(tool.tier, policy.autonomy)) return refuse('autonomy');

    const input = tool.input.safeParse(request.arguments);
    if (!input.success) {
      return refuse(
        'invalid',
        input.error.issues.slice(0, MAX_ISSUES).map((issue) => ({
          path: issue.path.map(String).join('.'),
          code: issue.code,
        })),
      );
    }

    const abort = new AbortController();
    const context = { grant, agent, signal: abort.signal };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ToolTimeout()), AGENT_TOOL_TIMEOUT_MS);
    });
    try {
      if (tool.tier === 'commit') {
        // A commit is never run from here: it becomes a confirmation a person taps (ADR-107).
        const confirmationId = await Promise.race([
          this.confirmation(tool, input.data, context),
          timeout,
        ]);
        return await this.finish(
          grant,
          recorded,
          tool,
          request.agent,
          'confirmation_required',
          argumentKeys,
          started,
          undefined,
          confirmationId ? { confirmationId } : null,
        );
      }
      const output = await Promise.race([tool.run(input.data, context), timeout]);
      // Parsing strips every field the tool's schema does not name before a model sees it.
      const result = tool.output.parse(output);
      agentToolDuration.record(Date.now() - started, { tool: tool.name });
      await this.record(grant, tool, agent, 'ok', null, argumentKeys, started);
      return { status: 'ok', reason: null, result };
    } catch (error) {
      if (error instanceof ToolTimeout) {
        abort.abort();
        return refuse('timeout');
      }
      if (error instanceof AgentToolError) return refuse(error.code);
      // The error may quote data: the log and the report carry its class and the tool only.
      this.logger.warn(
        { tool: tool.name, error: error instanceof Error ? error.name : 'unknown' },
        'agent tool failed',
      );
      void this.errors.capture(error, { task: `agent-tool:${tool.name}` });
      return refuse('failed');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * What a commit tool would do, stored for the traveller to confirm. The tool checks, as the
   * grant's caller, that the action can be taken and says what the card shows; it changes
   * nothing. Only an account in a conversation can be asked: anyone else gets the bare refusal.
   */
  private async confirmation(
    tool: AgentTool,
    input: unknown,
    context: { grant: AgentGrant; agent: AgentName; signal: AbortSignal },
  ): Promise<string | null> {
    const { grant, agent } = context;
    if (!tool.prepare || !grant.userId || !grant.conversationId) return null;
    const draft = await tool.prepare(input, context);
    return this.confirmations.ask(
      { ...grant, userId: grant.userId, conversationId: grant.conversationId },
      agent,
      tool,
      input,
      draft,
    );
  }

  private async finish(
    grant: AgentGrant | null,
    recorded: string,
    tool: AgentTool | undefined,
    agent: string,
    reason: AgentToolDenial,
    argumentKeys: string[],
    started: number,
    issues?: AgentToolAnswer['issues'],
    result: Record<string, unknown> | null = null,
  ): Promise<AgentToolAnswer> {
    agentToolCalls.add(1, { tool: recorded, tier: tool?.tier ?? 'none', outcome: reason });
    if (grant) {
      await this.record(
        grant,
        // An unknown tool has no tier.
        tool ?? { name: recorded, tier: 'none' },
        (AGENT_NAMES as readonly string[]).includes(agent) ? agent : UNKNOWN_TOOL,
        STATUS_OF[reason],
        reason,
        argumentKeys,
        started,
      ).catch(() => undefined);
    }
    const status = STATUS_OF[reason];
    return { status, reason, result, ...(issues ? { issues } : {}) };
  }

  private async record(
    grant: AgentGrant,
    tool: { name: string; tier: string },
    agent: string,
    status: AgentToolCallStatus,
    reason: AgentToolDenial | null,
    argumentKeys: string[],
    started: number,
  ): Promise<void> {
    if (status === 'ok') agentToolCalls.add(1, { tool: tool.name, tier: tool.tier, outcome: 'ok' });
    await this.prisma.agentToolCall.create({
      data: {
        runId: grant.runId,
        agent,
        tool: tool.name,
        tier: tool.tier,
        status,
        reason,
        argumentKeys,
        durationMs: Date.now() - started,
      },
    });
  }
}

/** The calling agent, when it is one this grant's audience and channel may reach. */
function agentOf(name: string, grant: AgentGrant): AgentName | null {
  if (!(AGENT_NAMES as readonly string[]).includes(name)) return null;
  const agent = name as AgentName;
  if (agentAudience(agent) !== grant.audience) return null;
  return agentsFor(grant.channel).includes(agent) ? agent : null;
}
