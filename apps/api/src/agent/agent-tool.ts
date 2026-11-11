import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  AGENT_NAMES,
  AGENT_SCOPES,
  AGENT_TOOL_NAME_PATTERN,
  AGENT_TOOL_TIERS,
  isForbiddenAgentTool,
  type AgentName,
  type AgentScope,
  type AgentToolDenial,
  type AgentToolTier,
} from '@suskii/shared';

import type { AgentGrant } from './agent-grants';

/** Who a tool runs for: always the grant's caller, never a value the model supplied. */
export interface AgentToolContext {
  grant: AgentGrant;
  agent: AgentName;
  /** Aborted when the gateway gives up on the call. */
  signal: AbortSignal;
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
