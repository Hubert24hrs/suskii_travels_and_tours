import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  AGENT_NAMES,
  AGENT_SCOPES,
  AGENT_TOOL_NAME_PATTERN,
  AGENT_TOOL_TIERS,
  isForbiddenAgentTool,
  type AgentCard,
  type AgentConfirmationAmount,
  type AgentName,
  type AgentScope,
  type AgentToolDenial,
  type AgentToolTier,
  type MoneyWire,
} from '@suskii/shared';

import type { RequestContext } from '../common/request-context';

import type { AgentGrant } from './agent-grants';

/** Who a tool runs for: always the grant's caller, never a value the model supplied. */
export interface AgentToolContext {
  grant: AgentGrant;
  agent: AgentName;
  /** Aborted when the gateway gives up on the call. */
  signal: AbortSignal;
  /**
   * At the traveller's tap only: what `prepare` said the tool would do (a quoted refund), so
   * the action that runs is the one the card showed.
   */
  expected?: Record<string, unknown> | null;
  /**
   * At the traveller's tap only: the request the tap came in, so what the ordinary service
   * records about the action says where the traveller was, not where the assistant runs.
   */
  request?: RequestContext;
}

/** What a traveller is asked to confirm, built from the API's own records (ADR-107). */
export interface AgentConfirmationDraft {
  card: {
    kind: AgentCard['kind'];
    /** What it is about: a booking as "Lagos (LOS) to Abuja (ABV), Air Peace". No names. */
    title: string;
    /** Facts the traveller should see before tapping: dates and times. No sentences. */
    lines: string[];
    /** The money the action returns or keeps, each under a code the client words. */
    amounts?: { code: AgentConfirmationAmount; amount: MoneyWire }[];
    ref?: AgentCard['ref'];
  };
  /** Handed back to `run` at the tap as `context.expected`. */
  expected?: Record<string, unknown>;
  /** When what the card promises ends sooner than a confirmation does (a refund quote). */
  expiresAt?: Date;
}

/**
 * One thing an agent can ask the API to do (ADR-101, ADR-107). `input` is what the model may
 * send; `output` is everything that goes back to it, so a field that is not in the schema never
 * reaches a model. A tool calls the ordinary services with the grant's caller: it adds no way
 * around ownership checks, the state machine or the ledger.
 */
export interface AgentTool<Input = unknown, Output = unknown> {
  /** `area.action`, checked against `AGENT_TOOL_NAME_PATTERN` and the never-tools list. */
  name: string;
  /** What the model is told the tool is for. */
  description: string;
  tier: AgentToolTier;
  scope: AgentScope;
  /** The agents that may call it. */
  agents: readonly AgentName[];
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  /**
   * `commit` tools only. Checks, for the grant's caller, that the action can be taken now and
   * says what the traveller will be asked to confirm. It changes nothing. The gateway stores
   * the answer as a confirmation; `run` is then called only at the traveller's own tap.
   */
  prepare?(input: Input, context: AgentToolContext): Promise<AgentConfirmationDraft>;
  run(input: Input, context: AgentToolContext): Promise<Output>;
}

/** Keeps the input and output types of a tool together where it is declared. */
export const agentTool = <Input, Output>(tool: AgentTool<Input, Output>): AgentTool => tool;

/**
 * A refusal a tool raises itself: what was asked for does not exist for this caller
 * (`not_found`, also for someone else's record), its service said no (`refused`), or its
 * service could not answer just now (`failed`: a supplier that is down is not a fault of ours).
 */
export class AgentToolError extends Error {
  constructor(readonly code: Extract<AgentToolDenial, 'not_found' | 'refused' | 'failed'>) {
    super(`agent tool: ${code}`);
    this.name = 'AgentToolError';
  }
}

export interface AgentToolDescription {
  name: string;
  description: string;
  tier: AgentToolTier;
  scope: AgentScope;
  agents: AgentName[];
  /** JSON Schema of the arguments, for the model. */
  parameters: Record<string, unknown>;
}

/**
 * Every tool the gateway serves. A tool registers once at start-up; a name that is malformed,
 * taken, or says something an agent never does (ADR-107) stops the API from starting.
 */
@Injectable()
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (!AGENT_TOOL_NAME_PATTERN.test(tool.name)) {
      throw new Error(`Agent tool "${tool.name}" must be named area.action`);
    }
    if (isForbiddenAgentTool(tool.name)) {
      throw new Error(`"${tool.name}" names something an agent never does (ADR-107)`);
    }
    if (this.tools.has(tool.name)) throw new Error(`Agent tool "${tool.name}" is registered twice`);
    if (!AGENT_TOOL_TIERS.includes(tool.tier)) {
      throw new Error(`Agent tool "${tool.name}" has no tier`);
    }
    if (!AGENT_SCOPES.includes(tool.scope)) {
      throw new Error(`Agent tool "${tool.name}" has no scope`);
    }
    if (tool.agents.length === 0 || tool.agents.some((agent) => !AGENT_NAMES.includes(agent))) {
      throw new Error(`Agent tool "${tool.name}" must name the agents that may call it`);
    }
    if ((tool.tier === 'commit') !== (typeof tool.prepare === 'function')) {
      throw new Error(
        `Agent tool "${tool.name}": a commit says what will be confirmed (prepare), and only a commit does`,
      );
    }
    if (tool.description.trim().length < 20) {
      throw new Error(`Agent tool "${tool.name}" needs a description the model can use`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** What the agent service builds its tool list from, so the two never drift. */
  describe(): AgentToolDescription[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      tier: tool.tier,
      scope: tool.scope,
      agents: [...tool.agents],
      parameters: parametersOf(tool.input),
    }));
  }
}

function parametersOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
