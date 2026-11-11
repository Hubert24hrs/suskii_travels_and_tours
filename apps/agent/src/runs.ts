import {
  Command,
  GraphRecursionError,
  MemorySaver,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import {
  type AgentModelUsage,
  type AgentName,
  type AgentRunEnd,
  type AgentRunEvent,
  type AgentRunRequest,
  type AgentRunShadow,
} from '@suskii/shared';

import {
  buildAgentGraph,
  type AgentStateValue,
  type ConfirmationResume,
  type TurnResult,
} from './graph/graph.js';
import { type Logger } from './logger.js';
import { type AgentModelFactory } from './model/factory.js';
import {
  CANDIDATE_PROMPTS,
  ROUTER_PROMPT,
  STAFF_ROUTER_PROMPT,
  promptFor,
  promptsWith,
  type Prompt,
} from './prompts/prompts.js';
import {
  ToolGateway,
  type ToolAnswer,
  type ToolCall,
  type ToolDescription,
} from './tools/gateway.js';

export interface RunServiceOptions {
  models: AgentModelFactory;
  gateway: ToolGateway;
  checkpointer: BaseCheckpointSaver;
  logger: Logger;
  maxConcurrentRuns: number;
  toolTimeoutMs: number;
  /** The candidate prompts a shadow turn may try (ADR-106); the shipped ones by default. */
  candidates?: readonly Prompt[];
  /** Shadow turns in progress at once; more are skipped, never queued. */
  maxConcurrentShadows?: number;
}

const NOTHING: Pick<AgentRunEnd, 'agent' | 'agents' | 'prompts' | 'steps' | 'usage'> = {
  agent: 'concierge',
  agents: [],
  prompts: [],
  steps: 0,
  usage: [],
};

/** One tool call as a key: the tool and its arguments, whatever order they were written in. */
function callKey(tool: string, args: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([name, entry]) => [name, canonical(entry)]),
      );
    }
    return value;
  };
  return `${tool}\n${JSON.stringify(canonical(args))}`;
}

/** The real gateway, remembering what each call of a live turn was answered. */
class RecordingGateway extends ToolGateway {
  readonly answers = new Map<string, ToolAnswer>();

  constructor(private readonly inner: ToolGateway) {
    super();
  }

  list(signal?: AbortSignal): Promise<ToolDescription[]> {
    return this.inner.list(signal);
  }

  async call(tool: string, call: ToolCall, signal: AbortSignal): Promise<ToolAnswer> {
    const answer = await this.inner.call(tool, call, signal);
    this.answers.set(callKey(tool, call.arguments), answer);
    return answer;
  }
}

/**
 * The gateway of a shadow turn (ADR-106): it reaches nothing. A call the live turn made is
 * answered with what the live turn was answered; any other call is refused. So a candidate
 * prompt cannot run a tool, start a confirmation or spend a supplier's or a vendor's budget,
 * whatever it asks for.
 */
class ReplayGateway extends ToolGateway {
  replayed = 0;
  missed = 0;

  constructor(
    private readonly tools: readonly ToolDescription[],
    private readonly answers: ReadonlyMap<string, ToolAnswer>,
  ) {
    super();
  }

  list(): Promise<ToolDescription[]> {
    return Promise.resolve([...this.tools]);
  }

  call(tool: string, call: ToolCall): Promise<ToolAnswer> {
    const recorded = this.answers.get(callKey(tool, call.arguments));
    // Only what a tool returned is replayed: a refusal the live turn met is a refusal again.
    if (recorded && recorded.reason !== 'confirmation_required') {
      this.replayed += 1;
      return Promise.resolve(recorded);
    }
    this.missed += 1;
    return Promise.resolve({ status: 'denied', reason: 'refused', result: null });
  }
}

/** What a shadow turn starts from: the live turn's own start, and what its tools returned. */
interface ShadowSeed {
  history: AgentStateValue['history'];
  lastAgent: AgentStateValue['lastAgent'];
  text: string;
  tools: ToolDescription[];
  answers: ReadonlyMap<string, ToolAnswer>;
  /** The agents that worked on the live turn. */
  agents: AgentName[];
}

/**
 * Runs one request of the API through the graph (ADR-101) and reports it as events: status
 * lines while it works and exactly one `end`. A run is bounded in time, in model turns and in
 * tool calls; whatever goes wrong, the caller gets an `end` with a code and never an exception,
 * a stack or a provider's message.
 *
 * When the request asks for it, and the turn was a plain message that got an answer, the same
 * turn is then run once more with candidate prompts (ADR-106) and one `shadow` line follows
 * the `end`. That second turn is not the traveller's: it starts from a copy of where the live
 * turn started, keeps its checkpoints in memory only, cannot call a tool, and nothing it
 * writes leaves this process.
 */
export class RunService {
  private active = 0;
  private shadows = 0;
  private readonly threads = new Set<string>();

  constructor(private readonly options: RunServiceOptions) {}

  /** Runs in progress, for the health answer. */
  get running(): number {
    return this.active;
  }

  async run(
    request: AgentRunRequest,
    emit: (event: AgentRunEvent) => void,
    caller: AbortSignal,
  ): Promise<void> {
    const seed = await this.live(request, emit, caller);
    if (seed) emit(await this.shadow(request, seed, caller));
  }

  /** The traveller's turn. Returns what a shadow turn would start from, when one is due. */
  private async live(
    request: AgentRunRequest,
    emit: (event: AgentRunEvent) => void,
    caller: AbortSignal,
  ): Promise<ShadowSeed | null> {
    const { logger } = this.options;
    const finish = (
      result: TurnResult,
      facts: Pick<AgentRunEnd, 'agent' | 'agents' | 'prompts' | 'steps' | 'usage'> = NOTHING,
    ): void => {
      emit({ type: 'end', ...result, ...facts });
      logger.info(
        { runId: request.runId, outcome: result.outcome, agent: facts.agent, steps: facts.steps },
        'run ended',
      );
    };
    const failed = (outcome: TurnResult['outcome']): TurnResult => ({
      outcome,
      answer: null,
      notice:
        outcome === 'timeout' ? 'timeout' : outcome === 'step_limit' ? 'limit' : 'unavailable',
      confirmationId: null,
    });

    // One instance takes a bounded number of runs, and one thread runs one at a time: two
    // writers on a thread's checkpoints would lose one of the turns.
    if (this.active >= this.options.maxConcurrentRuns || this.threads.has(request.threadId)) {
      finish(failed('failed'));
      return null;
    }
    this.active += 1;
    this.threads.add(request.threadId);
    const timeout = AbortSignal.timeout(request.limits.timeoutMs);
    const signal = AbortSignal.any([caller, timeout]);
    let facts = NOTHING;
    try {
      let tools: ToolDescription[];
      try {
        tools = await this.options.gateway.list(signal);
      } catch {
        finish(failed('failed'));
        return null;
      }
      // What the tools return is kept only when a shadow turn may follow, and only in memory.
      const recording = request.shadow ? new RecordingGateway(this.options.gateway) : null;
      const graph = buildAgentGraph(
        {
          request,
          models: this.options.models,
          gateway: recording ?? this.options.gateway,
          tools,
          emit,
          signal,
          toolTimeoutMs: this.options.toolTimeoutMs,
        },
        this.options.checkpointer,
      );
      const config = {
        configurable: { thread_id: request.threadId },
        // begin, route and finish, then at most think, act and check per model turn.
        recursionLimit: request.limits.maxSteps * 4 + 12,
        signal,
      };

      const before = await graph.getState(config);
      const waiting = before.tasks.some((task) => task.interrupts.length > 0);
      const started = before.values as Partial<AgentStateValue>;
      const pendingId = started.turn?.pending?.confirmationId;

      const { input } = request;
      if (input.kind === 'resume') {
        if (!waiting || pendingId !== input.confirmationId) {
          // Nothing is waiting for this confirmation: there is no turn to continue.
          finish(failed('failed'));
          return null;
        }
        const resume: ConfirmationResume = {
          decision: input.decision,
          ...(input.facts ? { facts: input.facts } : {}),
        };
        await graph.invoke(new Command({ resume }), config);
      } else if (waiting) {
        // The traveller wrote instead of tapping: the confirmation is not given, and their
        // words continue the same turn.
        const resume: ConfirmationResume = { decision: 'declined', next: input.text };
        await graph.invoke(new Command({ resume }), config);
      } else {
        await graph.invoke({ input: input.text }, config);
      }

      const after = await graph.getState(config);
      const { turn } = after.values as AgentStateValue;
      facts = {
        agent: turn.agent,
        agents: turn.agents,
        prompts: turn.prompts.slice(0, 8),
        steps: turn.steps,
        usage: turn.usage,
      };
      if (after.tasks.some((task) => task.interrupts.length > 0) && turn.pending) {
        finish(
          {
            outcome: 'confirmation',
            answer: null,
            notice: null,
            confirmationId: turn.pending.confirmationId,
          },
          facts,
        );
        return null;
      }
      const result = turn.result ?? failed('failed');
      finish(result, facts);
      // A shadow turn follows a plain message that got an answer, and nothing else: a turn
      // that waited for a tap, was resumed or ended in a notice has nothing to compare.
      if (!recording || input.kind !== 'message' || waiting || result.outcome !== 'answered') {
        return null;
      }
      return {
        history: started.history ?? [],
        lastAgent: started.lastAgent ?? null,
        text: input.text,
        tools,
        answers: recording.answers,
        agents: [...new Set([...turn.agents, turn.agent])],
      };
    } catch (error) {
      const outcome = timeout.aborted
        ? 'timeout'
        : caller.aborted
          ? 'cancelled'
          : error instanceof GraphRecursionError
            ? 'step_limit'
            : 'failed';
      if (outcome === 'failed') {
        // The error may quote a prompt or a result: its class is all the log gets.
        logger.error(
          { runId: request.runId, error: error instanceof Error ? error.name : 'unknown' },
          'run failed',
        );
      }
      finish(failed(outcome), facts);
      return null;
    } finally {
      // The thread is free before any shadow turn starts: the traveller's next message never
      // waits for one.
      this.active -= 1;
      this.threads.delete(request.threadId);
    }
  }

  /** The same turn with the candidates, compared as codes and counts. Never throws. */
  private async shadow(
    request: AgentRunRequest,
    seed: ShadowSeed,
    caller: AbortSignal,
  ): Promise<AgentRunShadow> {
    const asked = request.shadow?.prompts ?? [];
    const none = (status: AgentRunShadow['status']): AgentRunShadow => ({
      type: 'shadow',
      status,
      prompts: asked,
      outcome: null,
      agent: null,
      steps: 0,
      replayed: 0,
      missed: 0,
      usage: [],
    });
    const { prompts, unknown } = promptsWith(asked, this.options.candidates ?? CANDIDATE_PROMPTS);
    if (unknown.length > 0) return none('unknown_prompt');
    // A candidate for an agent that did not work on this turn would never be reached (the
    // routers are the live ones): running the turn again would compare nothing and cost a
    // model call. A router candidate may send the turn anywhere, so it always runs.
    const ids = new Set(asked.map((ref) => ref.slice(0, ref.indexOf('@'))));
    const reachable =
      ids.has(ROUTER_PROMPT.id) ||
      ids.has(STAFF_ROUTER_PROMPT.id) ||
      seed.agents.some((agent) => ids.has(promptFor(agent).id));
    if (!reachable) return none('not_used');
    if (this.shadows >= (this.options.maxConcurrentShadows ?? 2)) return none('busy');

    this.shadows += 1;
    const signal = AbortSignal.any([caller, AbortSignal.timeout(request.limits.timeoutMs)]);
    const gateway = new ReplayGateway(seed.tools, seed.answers);
    try {
      const graph = buildAgentGraph(
        {
          request,
          models: this.options.models,
          gateway,
          tools: seed.tools,
          // Nobody is waiting on a shadow turn: it has no status lines.
          emit: () => undefined,
          signal,
          toolTimeoutMs: this.options.toolTimeoutMs,
          prompts,
        },
        // Its own checkpoints, in memory, gone with this call: the thread is never touched.
        new MemorySaver(),
      );
      const config = {
        configurable: { thread_id: `shadow-${request.runId}` },
        recursionLimit: request.limits.maxSteps * 4 + 12,
        signal,
      };
      await graph.invoke(
        { history: seed.history, lastAgent: seed.lastAgent, input: seed.text },
        config,
      );
      const { turn } = (await graph.getState(config)).values as AgentStateValue;
      const used = turn.prompts.filter((ref) => asked.includes(ref));
      const report: AgentRunShadow = {
        type: 'shadow',
        status: used.length > 0 ? 'compared' : 'not_used',
        prompts: used.length > 0 ? used : asked,
        outcome: turn.result?.outcome ?? 'failed',
        agent: turn.agent,
        steps: turn.steps,
        replayed: gateway.replayed,
        missed: gateway.missed,
        usage: turn.usage,
      };
      this.options.logger.info(
        { runId: request.runId, status: report.status, outcome: report.outcome },
        'shadow turn ended',
      );
      return report;
    } catch (error) {
      this.options.logger.warn(
        { runId: request.runId, error: error instanceof Error ? error.name : 'unknown' },
        'shadow turn failed',
      );
      return none('failed');
    } finally {
      this.shadows -= 1;
    }
  }
}

/** Usage summed per model, for callers that want one figure. */
export function totalTokens(usage: readonly AgentModelUsage[]): { input: number; output: number } {
  return usage.reduce(
    (sum, line) => ({
      input: sum.input + line.inputTokens,
      output: sum.output + line.outputTokens,
    }),
    { input: 0, output: 0 },
  );
}

export type { AgentName };
