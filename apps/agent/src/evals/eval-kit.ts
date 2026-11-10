import { readFileSync } from 'node:fs';

import { MemorySaver } from '@langchain/langgraph';
import {
  AGENT_NAMES,
  AGENT_SCOPES,
  AGENT_TOOL_TIERS,
  CUSTOMER_AGENTS,
  agentScopesFor,
  type AgentModelUsage,
  type AgentName,
  type AgentRunContext,
  type AgentRunEnd,
  type AgentScope,
  type AgentToolDenial,
} from '@suskii/shared';
import { pino } from 'pino';
import { z } from 'zod';

import { AgentModelFactory } from '../model/factory.js';
import { MockAgentModel, ROUTE_TOOL, type RecordedTurn } from '../model/mock-model.js';
import { AgentModel, type ModelRequest, type ModelRole, type ModelTurn } from '../model/model.js';
import { RunService } from '../runs.js';
import {
  ToolGateway,
  type ToolAnswer,
  type ToolCall,
  type ToolDescription,
} from '../tools/gateway.js';

/**
 * What the three agent evals share (ADR-106): the tool list the API ships, a gateway stand-in
 * that decides as the real one does, and a way to run one message through the whole graph with
 * recorded model turns or with the configured model. No eval reaches the API or a database.
 */

const evalTool = z.object({
  name: z.string(),
  description: z.string(),
  tier: z.enum(AGENT_TOOL_TIERS),
  scope: z.enum(AGENT_SCOPES),
  agents: z.array(z.enum(AGENT_NAMES)),
  parameters: z.record(z.string(), z.unknown()),
});
export type EvalTool = z.infer<typeof evalTool>;

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../evals/${name}`, import.meta.url), 'utf8')) as unknown;

/**
 * The tools as the API's registry describes them: a snapshot an API test keeps in step
 * (`agent-tools.e2e-spec.ts`), since this workspace cannot import the API.
 */
export function loadTools(): EvalTool[] {
  return z.object({ tools: z.array(evalTool) }).parse(fixture('tools.json')).tools;
}

/** Reads and checks a suite's cases. */
export function loadSuite<T>(name: string, schema: z.ZodType<T>): T {
  return schema.parse(fixture(name));
}

/** A commit tool as sub-phase E registers them, for cases about confirmations. */
export const COMMIT_TOOL: EvalTool = {
  name: 'bookings.cancel',
  description: "Cancel one of the traveller's own bookings under its terms, after they confirm.",
  tier: 'commit',
  scope: 'account',
  agents: ['bookings'],
  parameters: {
    type: 'object',
    properties: { bookingId: { type: 'string' } },
    required: ['bookingId'],
    additionalProperties: false,
  },
};
export const EVAL_CONFIRMATION_ID = '0193a000-0000-7000-8000-0000000c0ffe';

export interface ToolAttempt {
  tool: string;
  agent: AgentName;
  outcome: 'ok' | AgentToolDenial;
  arguments: Record<string, unknown>;
}

const answer = (reason: AgentToolDenial, result: unknown = null): ToolAnswer => ({
  status: ['not_found', 'refused', 'failed'].includes(reason) ? 'error' : 'denied',
  reason,
  result,
});

/**
 * The API's tool gateway in miniature: the same checks in the same order (tool, agent, scope,
 * tier) for the scopes a grant carries, answering from the case's fixtures. It remembers every
 * attempt, so an eval can say what a model tried and what actually ran.
 */
export class EvalGateway extends ToolGateway {
  readonly attempts: ToolAttempt[] = [];

  constructor(
    private readonly tools: readonly EvalTool[],
    private readonly scopes: readonly AgentScope[],
    private readonly results: Readonly<Record<string, unknown>>,
  ) {
    super();
  }

  list(): Promise<ToolDescription[]> {
    return Promise.resolve(
      this.tools.map(({ name, description, tier, agents, parameters }) => ({
        name,
        description,
        tier,
        agents,
        parameters,
      })),
    );
  }

  call(name: string, call: ToolCall): Promise<ToolAnswer> {
    const note = (outcome: ToolAttempt['outcome'], result: ToolAnswer): Promise<ToolAnswer> => {
      this.attempts.push({ tool: name, agent: call.agent, outcome, arguments: call.arguments });
      return Promise.resolve(result);
    };
    const tool = this.tools.find((candidate) => candidate.name === name);
    if (!tool) return note('unknown_tool', answer('unknown_tool'));
    if (!tool.agents.includes(call.agent)) return note('agent', answer('agent'));
    if (!this.scopes.includes(tool.scope)) return note('scope', answer('scope'));
    if (tool.tier === 'commit') {
      return note(
        'confirmation_required',
        answer('confirmation_required', { confirmationId: EVAL_CONFIRMATION_ID }),
      );
    }
    if (!(name in this.results)) return note('not_found', answer('not_found'));
    return note('ok', { status: 'ok', reason: null, result: this.results[name] });
  }

  /** The tools that ran, with what they returned. */
  get ran(): { tool: string; result: unknown }[] {
    return this.attempts
      .filter((attempt) => attempt.outcome === 'ok')
      .map((attempt) => ({ tool: attempt.tool, result: this.results[attempt.tool] }));
  }

  /** Calls that ran for a tool the grant or the agent does not cover: must always be none. */
  get ranOutsideGrant(): ToolAttempt[] {
    return this.attempts.filter((attempt) => {
      if (attempt.outcome !== 'ok') return false;
      const tool = this.tools.find((candidate) => candidate.name === attempt.tool);
      return (
        !tool ||
        tool.tier === 'commit' ||
        !tool.agents.includes(attempt.agent) ||
        !this.scopes.includes(tool.scope)
      );
    });
  }
}

/** The model under evaluation and the names its roles run under. */
export interface LiveModel {
  model: AgentModel;
  names: { router: string; specialist: string; fallback: string };
}

/**
 * One role from the model under evaluation and the other from a recording: the routing eval
 * needs no specialist's answer, and the other two must not depend on the router's mood.
 */
class SplitModel extends AgentModel {
  constructor(
    private readonly live: AgentModel,
    private readonly recorded: AgentModel,
    private readonly liveRole: ModelRole,
  ) {
    super();
  }

  get provider(): string {
    return this.live.provider;
  }

  complete(request: ModelRequest, model: string): Promise<ModelTurn> {
    return (request.role === this.liveRole ? this.live : this.recorded).complete(request, model);
  }
}

export const routeTo = (agent: AgentName): RecordedTurn => ({
  toolCalls: [{ name: ROUTE_TOOL, arguments: { agent } }],
});

export interface EvalRun {
  end: AgentRunEnd;
  gateway: EvalGateway;
  /** Whether the router model was asked, or a rule decided. */
  routerAsked: boolean;
}

let threads = 0;

/**
 * One message through the whole service: a fresh thread, the graph, the guard. `live` names the
 * role the model under evaluation plays; without it every turn comes from the recording.
 */
export async function runMessage(options: {
  text: string;
  tools: readonly EvalTool[];
  results: Readonly<Record<string, unknown>>;
  signedIn: boolean;
  locale: string;
  recorded: { router: RecordedTurn[]; specialist: RecordedTurn[] };
  live?: { role: ModelRole; model: LiveModel } | undefined;
  maxSteps?: number;
}): Promise<EvalRun> {
  const scopes = agentScopesFor({
    userId: options.signedIn ? 'traveller' : null,
    roles: options.signedIn ? ['customer'] : [],
    channel: 'web',
  });
  const gateway = new EvalGateway(options.tools, scopes, options.results);
  const queues = {
    router: [...options.recorded.router],
    specialist: [...options.recorded.specialist],
  };
  const recorded = new MockAgentModel((request) => queues[request.role].shift());
  let routerAsked = false;
  const counting = new (class extends AgentModel {
    constructor(private readonly inner: AgentModel) {
      super();
    }
    get provider(): string {
      return this.inner.provider;
    }
    complete(request: ModelRequest, model: string): Promise<ModelTurn> {
      if (request.role === 'router') routerAsked = true;
      return this.inner.complete(request, model);
    }
  })(
    options.live ? new SplitModel(options.live.model.model, recorded, options.live.role) : recorded,
  );
  const names = options.live?.model.names ?? {
    router: 'mock-router',
    specialist: 'mock-specialist',
    fallback: 'mock-fallback',
  };
  const service = new RunService({
    models: new AgentModelFactory(counting, names),
    gateway,
    checkpointer: new MemorySaver(),
    logger: pino({ level: 'silent' }),
    maxConcurrentRuns: 1,
    toolTimeoutMs: 5000,
  });
  const context: AgentRunContext = {
    audience: 'customer',
    channel: 'web',
    locale: options.locale,
    currency: 'NGN',
    country: 'NG',
    agents: [...CUSTOMER_AGENTS],
    signedIn: options.signedIn,
    today: EVAL_TODAY,
  };
  const sequence = String((threads += 1)).padStart(12, '0');
  let end: AgentRunEnd | null = null;
  await service.run(
    {
      runId: `0193a000-0000-7000-8000-${sequence}`,
      threadId: `0193a000-0000-7000-9000-${sequence}`,
      grant: 'eval-grant-never-read-by-the-agent-service',
      context,
      limits: {
        maxSteps: options.maxSteps ?? 8,
        timeoutMs: options.live ? 90_000 : 20_000,
        maxOutputTokens: 800,
      },
      input: { kind: 'message', text: options.text },
    },
    (event) => {
      if (event.type === 'end') end = event;
    },
    new AbortController().signal,
  );
  if (!end) throw new Error('a run must end');
  return { end, gateway, routerAsked };
}

/** The day every eval case is written for: dates in fixtures are after it. */
export const EVAL_TODAY = '2026-11-10';

/** Adds up what the model under evaluation used, per model. */
export function addUsage(total: Map<string, AgentModelUsage>, usage: AgentModelUsage[]): void {
  for (const line of usage) {
    const key = `${line.provider}/${line.model}`;
    const sum = total.get(key);
    if (!sum) {
      total.set(key, { ...line });
      continue;
    }
    sum.calls += line.calls;
    sum.inputTokens += line.inputTokens;
    sum.outputTokens += line.outputTokens;
    sum.cacheReadTokens += line.cacheReadTokens;
    sum.cacheWriteTokens += line.cacheWriteTokens;
  }
}

export const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;
