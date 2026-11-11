import { Command, GraphRecursionError, type BaseCheckpointSaver } from '@langchain/langgraph';
import {
  type AgentModelUsage,
  type AgentName,
  type AgentRunEnd,
  type AgentRunEvent,
  type AgentRunRequest,
} from '@suskii/shared';

import {
  buildAgentGraph,
  type AgentStateValue,
  type ConfirmationResume,
  type TurnResult,
} from './graph/graph.js';
import { type Logger } from './logger.js';
import { type AgentModelFactory } from './model/factory.js';
import { type ToolDescription, type ToolGateway } from './tools/gateway.js';

export interface RunServiceOptions {
  models: AgentModelFactory;
  gateway: ToolGateway;
  checkpointer: BaseCheckpointSaver;
  logger: Logger;
  maxConcurrentRuns: number;
  toolTimeoutMs: number;
}

const NOTHING: Pick<AgentRunEnd, 'agent' | 'agents' | 'prompts' | 'steps' | 'usage'> = {
  agent: 'concierge',
  agents: [],
  prompts: [],
  steps: 0,
  usage: [],
};

/**
 * Runs one request of the API through the graph (ADR-101) and reports it as events: status
 * lines while it works and exactly one `end`. A run is bounded in time, in model turns and in
 * tool calls; whatever goes wrong, the caller gets an `end` with a code and never an exception,
 * a stack or a provider's message.
 */
export class RunService {
  private active = 0;
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
      return;
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
        return;
      }
      const graph = buildAgentGraph(
        {
          request,
          models: this.options.models,
          gateway: this.options.gateway,
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
      const pendingId = (before.values as Partial<AgentStateValue>).turn?.pending?.confirmationId;

      const { input } = request;
      if (input.kind === 'resume') {
        if (!waiting || pendingId !== input.confirmationId) {
          // Nothing is waiting for this confirmation: there is no turn to continue.
          finish(failed('failed'));
          return;
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
        return;
      }
      finish(turn.result ?? failed('failed'), facts);
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
    } finally {
      this.active -= 1;
      this.threads.delete(request.threadId);
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
