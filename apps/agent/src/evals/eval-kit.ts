import { readFileSync } from 'node:fs';

import { MemorySaver } from '@langchain/langgraph';
import {
  AGENT_NAMES,
  AGENT_SCOPES,
  AGENT_TOOL_TIERS,
  CUSTOMER_AGENTS,
  agentScopesFor,
  staffAgentsFor,
  type AgentAudience,
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

/** The confirmation the miniature gateway answers a commit tool with. */
export const EVAL_CONFIRMATION_ID = '0193a000-0000-7000-8000-0000000c0ffe';

export interface ToolAttempt {
  tool: string;
  agent: AgentName;
  outcome: 'ok' | AgentToolDenial;
  arguments: Record<string, unknown>;
  /** What a call that ran returned. */
  result?: unknown;
}

const referencePlace = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('airport'),
    code: z.string(),
    name: z.string(),
    cityName: z.string().nullable(),
    countryCode: z.string(),
    countryName: z.string(),
    timeZone: z.string(),
  }),
  z.object({
    type: z.literal('city'),
    id: z.string(),
    name: z.string(),
    countryCode: z.string(),
    countryName: z.string(),
    airports: z.array(z.object({ code: z.string(), name: z.string() })),
  }),
]);
type ReferencePlace = z.infer<typeof referencePlace>;
let places: ReferencePlace[] | null = null;

/**
 * Reference data every case shares (ADR-112): `catalog.places`, answered from `places.json` as
 * the catalog answers it, for a case that gives no answer of its own. The tool tells a model to
 * resolve every place before a search ("never guess a code"); a model that does so must not be
 * marked down because a case was written as if it already knew LOS and ABV.
 */
export function sharedAnswer(name: string, args: Record<string, unknown>): unknown {
  if (name !== 'catalog.places') return undefined;
  places ??= z.object({ places: z.array(referencePlace) }).parse(fixture('places.json')).places;
  const query = (typeof args.query === 'string' ? args.query : '').trim().toLowerCase();
  const types = Array.isArray(args.types) ? args.types : ['airport', 'city'];
  const limit = typeof args.limit === 'number' ? args.limit : 5;
  const words = (place: ReferencePlace): string[] =>
    place.type === 'airport'
      ? [place.code, place.name, place.cityName ?? '', place.countryName, place.countryCode]
      : [place.name, place.countryName, place.countryCode, ...place.airports.map((a) => a.code)];
  return {
    places: places
      .filter((place) => types.includes(place.type))
      .filter(
        (place) =>
          query.length > 0 && words(place).some((word) => word.toLowerCase().includes(query)),
      )
      .slice(0, limit),
  };
}

const answer = (reason: AgentToolDenial, result: unknown = null): ToolAnswer => ({
  status: ['not_found', 'refused', 'failed'].includes(reason) ? 'error' : 'denied',
  reason,
  result,
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether arguments fit a tool's parameters, as far as an eval needs to know: every required
 * name is there, no name is one the tool does not take, and a value with a fixed set is one of
 * the set. The API validates in full with the tool's own schema; this is what decides that
 * "remember my meal" has no key to be remembered under.
 */
export function fitsParameters(parameters: unknown, args: Record<string, unknown>): boolean {
  if (!isObject(parameters)) return true;
  const properties = isObject(parameters.properties) ? parameters.properties : {};
  const required = Array.isArray(parameters.required) ? parameters.required : [];
  if (required.some((name) => typeof name === 'string' && !(name in args))) return false;
  for (const [name, value] of Object.entries(args)) {
    const property = properties[name];
    if (property === undefined) {
      if (parameters.additionalProperties === false) return false;
      continue;
    }
    if (isObject(property) && Array.isArray(property.enum) && !property.enum.includes(value)) {
      return false;
    }
  }
  return true;
}

/**
 * The API's tool gateway in miniature: the same checks in the same order (tool, agent, scope,
 * arguments, tier) for the scopes a grant carries, answering from the case's fixtures. It
 * remembers every attempt, so an eval can say what a model tried and what actually ran.
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
      this.attempts.push({
        tool: name,
        agent: call.agent,
        outcome,
        arguments: call.arguments,
        ...(outcome === 'ok' ? { result: result.result } : {}),
      });
      return Promise.resolve(result);
    };
    const tool = this.tools.find((candidate) => candidate.name === name);
    if (!tool) return note('unknown_tool', answer('unknown_tool'));
    if (!tool.agents.includes(call.agent)) return note('agent', answer('agent'));
    if (!this.scopes.includes(tool.scope)) return note('scope', answer('scope'));
    if (!fitsParameters(tool.parameters, call.arguments)) return note('invalid', answer('invalid'));
    if (tool.tier === 'commit') {
      return note(
        'confirmation_required',
        answer('confirmation_required', { confirmationId: EVAL_CONFIRMATION_ID }),
      );
    }
    const result = name in this.results ? this.results[name] : sharedAnswer(name, call.arguments);
    if (result === undefined) return note('not_found', answer('not_found'));
    return note('ok', { status: 'ok', reason: null, result });
  }

  /** The tools that ran, with what they returned. */
  get ran(): { tool: string; result: unknown }[] {
    return this.attempts
      .filter((attempt) => attempt.outcome === 'ok')
      .map((attempt) => ({ tool: attempt.tool, result: attempt.result }));
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
 * What a run of a case is told about its caller. A staff case is a super admin in the console,
 * who reaches every staff agent; a traveller's case is the website.
 */
export function evalContext(caller: {
  audience: AgentAudience;
  locale: string;
  signedIn: boolean;
}): AgentRunContext {
  const staff = caller.audience === 'staff';
  return {
    audience: caller.audience,
    channel: staff ? 'console' : 'web',
    locale: caller.locale,
    currency: 'NGN',
    country: 'NG',
    agents: staff
      ? staffAgentsFor(
          agentScopesFor({ userId: 'staff', roles: ['super_admin'], channel: 'console' }),
        )
      : [...CUSTOMER_AGENTS],
    signedIn: staff || caller.signedIn,
    today: EVAL_TODAY,
  };
}

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
  /** `staff`: a super admin in the console, who reaches every staff agent (ADR-107). */
  audience?: AgentAudience | undefined;
}): Promise<EvalRun> {
  const staff = options.audience === 'staff';
  const scopes = staff
    ? agentScopesFor({ userId: 'staff', roles: ['super_admin'], channel: 'console' })
    : agentScopesFor({
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
  const context = evalContext({
    audience: staff ? 'staff' : 'customer',
    locale: options.locale,
    signedIn: options.signedIn,
  });
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

/**
 * How long a test waits for a whole suite. A suite is dozens of runs of the graph; on a build
 * machine that runs every workspace's tests at once it has taken ten times what it takes alone,
 * past the test runner's own five seconds.
 */
export const EVAL_SUITE_TIMEOUT_MS = 120_000;

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
