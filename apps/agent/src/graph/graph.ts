import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import {
  AGENT_ANSWER_MAX,
  CUSTOMER_AGENTS,
  checkGrounding,
  leaksInstructions,
  namedTools,
  unsupportedOutcomes,
  type AgentAnswer,
  type AgentCard,
  type AgentModelUsage,
  type AgentName,
  type AgentNotice,
  type AgentRunEvent,
  type AgentRunOutcome,
  type AgentRunRequest,
  type StatusFact,
} from '@suskii/shared';

import { type AgentModelFactory } from '../model/factory.js';
import { ROUTE_TOOL } from '../model/mock-model.js';
import {
  ModelError,
  gatewayToolName,
  modelToolName,
  type ModelMessage,
  type ModelRole,
  type ModelToolSpec,
  type ModelTurn,
} from '../model/model.js';
import { ROUTER_PROMPT, promptFor, promptRef, rewriteInstruction } from '../prompts/prompts.js';
import { GatewayError, type ToolDescription, type ToolGateway } from '../tools/gateway.js';
import { cardsOf, renderForModel, statusFactsOf } from '../tools/render.js';

import { isGreeting, obviousAgent } from './pre-router.js';

/** Earlier turns kept for the model: enough to follow a conversation, bounded in cost. */
const HISTORY_MAX_MESSAGES = 20;
/** Tool calls one model turn may ask for; more are answered as not run. */
const TOOL_CALLS_PER_STEP = 6;
/** How many times the guard asks for a rewrite before a notice goes out instead. */
const MAX_REWRITES = 1;
/** The tool whose success makes the answer a handover to people. */
const HANDOVER_TOOL = 'support.handover';
const CARDS_MAX = 6;

/** How a turn ended, before it is an event: what the run service sends as `end`. */
export interface TurnResult {
  outcome: AgentRunOutcome;
  answer: AgentAnswer | null;
  notice: AgentNotice | null;
  confirmationId: string | null;
}

/** A tool call waiting for the traveller's tap (ADR-107). */
interface PendingConfirmation {
  toolCallId: string;
  tool: string;
  confirmationId: string;
}

/** What one run works with. It is reset when a new message starts a turn. */
export interface TurnState {
  agent: AgentName;
  agents: AgentName[];
  prompts: string[];
  /** This turn as the model sees it: the traveller's words, tool calls and their results. */
  messages: ModelMessage[];
  /**
   * What the traveller wrote in this turn, and nothing else: an answer may rest on it. The
   * model's own drafts and the guard's notes to the model are in `messages` and never here, or
   * a refused answer would become its own source.
   */
  said: string[];
  steps: number;
  usage: AgentModelUsage[];
  /** What tools returned in this turn, as the model read it: what an answer may rest on. */
  sources: { ref: string; text: string }[];
  cards: AgentCard[];
  statuses: StatusFact[];
  toolCounts: Record<string, number>;
  rewrites: number;
  handover: boolean;
  gatewayFailures: number;
  pending: PendingConfirmation | null;
  /** An answer the model wrote, waiting for the guard. */
  draft: string | null;
  result: TurnResult | null;
}

const emptyTurn = (): TurnState => ({
  agent: 'concierge',
  agents: [],
  prompts: [],
  messages: [],
  said: [],
  steps: 0,
  usage: [],
  sources: [],
  cards: [],
  statuses: [],
  toolCounts: {},
  rewrites: 0,
  handover: false,
  gatewayFailures: 0,
  pending: null,
  draft: null,
  result: null,
});

const replace = <T>(fallback: () => T) =>
  Annotation<T>({ reducer: (_current: T, next: T) => next, default: fallback });

/**
 * A thread's state, kept in the checkpointer (ADR-103): the conversation as the model saw it
 * (scrubbed words, answers, tool results as facts) and the turn in progress. It never holds a
 * grant, a name, a contact detail or a document: none of those ever enters this service's
 * state, and the grant lives only in the closure of the run that carries it.
 */
export const AgentState = Annotation.Root({
  /** Earlier turns: the traveller's scrubbed words and the answers they were given. */
  history: replace<ModelMessage[]>(() => []),
  /** The specialist that answered last, as a hint for the router. */
  lastAgent: replace<AgentName | null>(() => null),
  /** The message that starts a turn; null once the turn has taken it. */
  input: replace<string | null>(() => null),
  turn: replace<TurnState>(emptyTurn),
});
export type AgentStateValue = typeof AgentState.State;

/** What a confirmation node is resumed with. */
export interface ConfirmationResume {
  decision: 'confirmed' | 'declined' | 'expired' | 'failed';
  /** What the API's records say after the tap, under keys. */
  facts?: Record<string, unknown>;
  /** The traveller wrote something else instead of tapping: their (scrubbed) words. */
  next?: string;
}

/**
 * Everything one run needs and nothing a checkpoint may keep. The graph is built per run so
 * these stay in a closure: LangGraph copies plain `configurable` values into checkpoint
 * metadata, and a grant must never be stored (ADR-103).
 */
export interface RunDeps {
  request: AgentRunRequest;
  models: AgentModelFactory;
  gateway: ToolGateway;
  tools: readonly ToolDescription[];
  emit: (event: AgentRunEvent) => void;
  /** Aborted when the run's time is up or the caller went away. */
  signal: AbortSignal;
  toolTimeoutMs: number;
}

const ended = (
  outcome: AgentRunOutcome,
  notice: AgentNotice | null,
  answer: AgentAnswer | null = null,
): TurnResult => ({ outcome, answer, notice, confirmationId: null });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function addUsage(
  usage: readonly AgentModelUsage[],
  role: ModelRole,
  provider: string,
  turn: ModelTurn,
): AgentModelUsage[] {
  const next = usage.map((line) => ({ ...line }));
  let line = next.find(
    (entry) => entry.role === role && entry.provider === provider && entry.model === turn.model,
  );
  if (!line) {
    line = {
      role,
      provider,
      model: turn.model.slice(0, 64),
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    next.push(line);
  }
  line.calls += 1;
  line.inputTokens += turn.usage.inputTokens;
  line.outputTokens += turn.usage.outputTokens;
  line.cacheReadTokens += turn.usage.cacheReadTokens;
  line.cacheWriteTokens += turn.usage.cacheWriteTokens;
  return next.slice(0, 4);
}

/** The words of earlier turns, for the router: text only, short. */
const routerContext = (history: readonly ModelMessage[]): ModelMessage[] =>
  history
    .filter((message) => message.role !== 'tool')
    .slice(-4)
    .map((message) =>
      message.role === 'assistant'
        ? { role: 'assistant' as const, text: message.text.slice(0, 400), toolCalls: [] }
        : { role: 'user' as const, text: 'text' in message ? message.text : '' },
    );

/**
 * The supervisor and its specialists as one graph (ADR-101, ADR-106, ADR-107):
 *
 *   begin → route → think ⇄ act → check → finish
 *                     ↑      ↓
 *                     └─ confirm (waits for the traveller's tap)
 *
 * `route` picks the specialist, by rule when the message leaves no doubt and by the router
 * model otherwise. `think` is one model turn; `act` runs the tools it asked for through the
 * API's gateway; `check` is the guard between the model's words and the traveller. Nothing with
 * a side effect happens in `confirm` before its interrupt, because LangGraph runs an
 * interrupted node again from its start when it resumes.
 */
export function buildAgentGraph(deps: RunDeps, checkpointer: BaseCheckpointSaver) {
  const { request, models, emit } = deps;
  const { context, limits } = request;
  const allowed = context.agents.filter((agent) =>
    (CUSTOMER_AGENTS as readonly AgentName[]).includes(agent),
  );
  const fallbackAgent: AgentName = allowed.includes('concierge')
    ? 'concierge'
    : (allowed[0] ?? 'concierge');

  const outOfTime = (): boolean => deps.signal.aborted;

  const toolsFor = (agent: AgentName): ToolDescription[] =>
    deps.tools.filter((tool) => tool.agents.includes(agent));

  /** One model call, counted. Null when the model could not answer at all. */
  async function ask(
    turn: TurnState,
    role: ModelRole,
    call: Parameters<AgentModelFactory['complete']>[0],
  ): Promise<{ turn: TurnState; answer: ModelTurn | null; failure: 'timeout' | 'error' | null }> {
    try {
      const answer = await models.complete(call);
      return {
        turn: {
          ...turn,
          steps: turn.steps + 1,
          usage: addUsage(turn.usage, role, models.provider, answer),
        },
        answer,
        failure: null,
      };
    } catch (error) {
      // A model that could not answer in time is an error; a run out of time is a timeout.
      const known = error instanceof ModelError ? error.reason : 'unavailable';
      return {
        turn: { ...turn, steps: turn.steps + 1 },
        answer: null,
        failure: outOfTime() && known !== 'rejected' ? 'timeout' : 'error',
      };
    }
  }

  // --- begin: a new message starts a turn ------------------------------------------------------
  const begin = (state: AgentStateValue): Partial<AgentStateValue> => {
    const text = state.input ?? '';
    return {
      input: null,
      turn: { ...emptyTurn(), messages: [{ role: 'user', text }], said: [text] },
    };
  };

  // --- route: which specialist answers ---------------------------------------------------------
  const route = async (state: AgentStateValue): Promise<Partial<AgentStateValue>> => {
    const first = state.turn.messages[0];
    const text = first?.role === 'user' ? first.text : '';
    if (isGreeting(text)) {
      return {
        turn: {
          ...state.turn,
          agent: fallbackAgent,
          agents: [fallbackAgent],
          result: ended('answered', 'greeting'),
        },
      };
    }
    const obvious = obviousAgent(text);
    if (obvious && allowed.includes(obvious)) {
      return { turn: { ...state.turn, agent: obvious, agents: [obvious] } };
    }
    if (allowed.length <= 1) {
      return { turn: { ...state.turn, agent: fallbackAgent, agents: [fallbackAgent] } };
    }

    emit({ type: 'status', agent: fallbackAgent, phase: 'routing' });
    const asked = await ask(state.turn, 'router', {
      role: 'router',
      prompt: { id: ROUTER_PROMPT.id, version: ROUTER_PROMPT.version },
      system: ROUTER_PROMPT.render(context),
      messages: [
        ...routerContext(state.history),
        {
          role: 'user',
          text: state.lastAgent
            ? `${text}\n\n(The last answer came from: ${state.lastAgent}.)`
            : text,
        },
      ],
      tools: [
        {
          name: ROUTE_TOOL,
          description: 'Send the message to the specialist who should answer it.',
          parameters: {
            type: 'object',
            properties: { agent: { type: 'string', enum: allowed } },
            required: ['agent'],
            additionalProperties: false,
          },
        },
      ],
      toolChoice: { name: ROUTE_TOOL },
      maxOutputTokens: 128,
      signal: deps.signal,
    });
    const turn = { ...asked.turn, prompts: [...asked.turn.prompts, promptRef(ROUTER_PROMPT)] };
    if (asked.failure === 'timeout')
      return { turn: { ...turn, result: ended('timeout', 'timeout') } };
    // A router that fails or answers nonsense is not a reason to fail the traveller: the
    // concierge takes the message.
    const chosen = asked.answer?.toolCalls.find((call) => call.name === ROUTE_TOOL)?.arguments
      .agent;
    const agent =
      typeof chosen === 'string' && (allowed as string[]).includes(chosen)
        ? (chosen as AgentName)
        : fallbackAgent;
    return { turn: { ...turn, agent, agents: [agent] } };
  };

  // --- think: one model turn of the specialist -------------------------------------------------
  const think = async (state: AgentStateValue): Promise<Partial<AgentStateValue>> => {
    const { turn } = state;
    if (outOfTime()) return { turn: { ...turn, result: ended('timeout', 'timeout') } };
    if (turn.steps >= limits.maxSteps) {
      return { turn: { ...turn, result: ended('step_limit', 'limit') } };
    }
    const prompt = promptFor(turn.agent);
    const tools: ModelToolSpec[] = toolsFor(turn.agent).map((tool) => ({
      name: modelToolName(tool.name),
      description: tool.description,
      parameters: tool.parameters,
    }));
    emit({ type: 'status', agent: turn.agent, phase: 'thinking' });
    const asked = await ask(turn, 'specialist', {
      role: 'specialist',
      prompt: { id: prompt.id, version: prompt.version },
      system: prompt.render(context),
      messages: [...state.history, ...turn.messages],
      tools,
      maxOutputTokens: limits.maxOutputTokens,
      signal: deps.signal,
    });
    const ref = promptRef(prompt);
    const next: TurnState = {
      ...asked.turn,
      prompts: asked.turn.prompts.includes(ref) ? asked.turn.prompts : [...asked.turn.prompts, ref],
    };
    if (!asked.answer) {
      return {
        turn: {
          ...next,
          result:
            asked.failure === 'timeout'
              ? ended('timeout', 'timeout')
              : ended('model_error', 'unavailable'),
        },
      };
    }
    const answer = asked.answer;
    if (answer.stop === 'refusal') {
      return { turn: { ...next, result: ended('model_refused', 'cannot_answer') } };
    }
    if (answer.toolCalls.length > 0) {
      return {
        turn: {
          ...next,
          messages: [
            ...next.messages,
            { role: 'assistant', text: answer.text, toolCalls: answer.toolCalls },
          ],
        },
      };
    }
    if (answer.text.trim() === '') {
      return { turn: { ...next, result: ended('model_error', 'unavailable') } };
    }
    return { turn: { ...next, draft: answer.text.trim() } };
  };

  // --- act: run the tools the model asked for, through the gateway ------------------------------
  const act = async (state: AgentStateValue): Promise<Partial<AgentStateValue>> => {
    let turn = state.turn;
    const last = turn.messages.at(-1);
    const calls = last?.role === 'assistant' ? last.toolCalls : [];
    const results: ModelMessage[] = [];
    const reply = (id: string, name: string, content: unknown, isError: boolean): void => {
      results.push({
        role: 'tool',
        toolCallId: id,
        name,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        isError,
      });
    };

    let stop: TurnResult | null = null;
    let pending: PendingConfirmation | null = null;
    for (const [index, call] of calls.entries()) {
      const tool = gatewayToolName(call.name);
      const known = toolsFor(turn.agent).some((candidate) => candidate.name === tool);
      if (stop || pending || index >= TOOL_CALLS_PER_STEP || outOfTime()) {
        reply(call.id, call.name, { error: 'not_run' }, true);
        continue;
      }
      if (!known) {
        // Not one of this agent's tools: the gateway would refuse it too, and it costs a call.
        reply(call.id, call.name, { error: 'unknown_tool' }, true);
        continue;
      }
      emit({ type: 'status', agent: turn.agent, phase: 'tool', tool });
      let answer;
      try {
        answer = await deps.gateway.call(
          tool,
          { grant: request.grant, agent: turn.agent, arguments: call.arguments },
          AbortSignal.any([deps.signal, AbortSignal.timeout(deps.toolTimeoutMs)]),
        );
      } catch (error) {
        const failures = turn.gatewayFailures + 1;
        turn = { ...turn, gatewayFailures: failures };
        reply(call.id, call.name, { error: 'unavailable' }, true);
        // The platform is not answering: stop instead of spending model turns on errors.
        if (failures >= 2 || (error instanceof GatewayError && error.reason === 'unauthorized')) {
          stop = ended('failed', 'unavailable');
        }
        continue;
      }

      if (answer.status === 'ok') {
        const count = (turn.toolCounts[tool] ?? 0) + 1;
        const text = renderForModel(answer.result);
        turn = {
          ...turn,
          toolCounts: { ...turn.toolCounts, [tool]: count },
          sources: [...turn.sources, { ref: `${tool}#${count}`, text }].slice(-24),
          // The newest results first: they are what the answer is about.
          cards: [...cardsOf(answer.result), ...turn.cards].slice(0, CARDS_MAX),
          statuses: [...turn.statuses, ...statusFactsOf(answer.result)].slice(-60),
          handover: turn.handover || tool === HANDOVER_TOOL,
        };
        reply(call.id, call.name, text, false);
        continue;
      }

      const reason = answer.reason ?? 'failed';
      if (reason === 'confirmation_required') {
        const id = isRecord(answer.result) ? answer.result.confirmationId : undefined;
        if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
          pending = { toolCallId: call.id, tool, confirmationId: id };
          continue;
        }
      }
      if (reason === 'limit') stop = ended('tool_limit', 'limit');
      else if (reason === 'paused' || reason === 'disabled') stop = ended('paused', 'paused');
      else if (reason === 'grant') stop = ended('failed', 'unavailable');
      reply(
        call.id,
        call.name,
        { error: reason, ...(answer.issues ? { issues: answer.issues } : {}) },
        true,
      );
    }

    return {
      turn: {
        ...turn,
        messages: [...turn.messages, ...results],
        pending,
        result: stop,
      },
    };
  };

  // --- confirm: wait for the traveller's tap ----------------------------------------------------
  const confirm = (state: AgentStateValue): Partial<AgentStateValue> => {
    const { turn } = state;
    const pending = turn.pending;
    if (!pending) return {};
    // Nothing above this line has a side effect: this node runs again from the top on resume.
    const resumed = interrupt<{ confirmationId: string }, ConfirmationResume>({
      confirmationId: pending.confirmationId,
    });
    const facts = { confirmation: resumed.decision, ...(resumed.facts ?? {}) };
    const text = renderForModel(facts);
    const count = (turn.toolCounts[pending.tool] ?? 0) + 1;
    const messages: ModelMessage[] = [
      ...turn.messages,
      {
        role: 'tool',
        toolCallId: pending.toolCallId,
        name: modelToolName(pending.tool),
        content: text,
        isError: resumed.decision !== 'confirmed',
      },
    ];
    if (resumed.next) messages.push({ role: 'user', text: resumed.next });
    return {
      turn: {
        ...turn,
        messages,
        said: resumed.next ? [...turn.said, resumed.next] : turn.said,
        pending: null,
        result: null,
        draft: null,
        toolCounts: { ...turn.toolCounts, [pending.tool]: count },
        sources: [...turn.sources, { ref: `${pending.tool}#${count}`, text }].slice(-24),
        cards: [...cardsOf(resumed.facts), ...turn.cards].slice(0, CARDS_MAX),
        statuses: [...turn.statuses, ...statusFactsOf(resumed.facts)].slice(-60),
      },
    };
  };

  // --- check: the guard between the model's words and the traveller ----------------------------
  const check = (state: AgentStateValue): Partial<AgentStateValue> => {
    const { turn } = state;
    const draft = turn.draft ?? '';
    emit({ type: 'status', agent: turn.agent, phase: 'checking' });
    // Earlier turns hold the traveller's words and answers that passed this check; of this
    // turn, only what the traveller wrote counts.
    const spoken = [
      ...state.history.flatMap((message) => (message.role === 'tool' ? [] : [message.text])),
      ...turn.said,
    ];
    const grounding = checkGrounding(draft, [
      ...turn.sources.map((source) => source.text),
      ...spoken,
      `${context.today} ${context.currency}`,
    ]);
    const outcomes = unsupportedOutcomes(draft, turn.statuses);
    const tooLong = draft.length > AGENT_ANSWER_MAX;
    // Its own instructions read back, or its tools by name: not something a traveller is told.
    const disclosed =
      leaksInstructions(draft, [
        ROUTER_PROMPT.render(context),
        promptFor(turn.agent).render(context),
      ]) ||
      namedTools(
        draft,
        deps.tools.map((tool) => tool.name),
      ).length > 0;

    if (grounding.ok && outcomes.length === 0 && !tooLong && !disclosed) {
      const answer: AgentAnswer = {
        kind: turn.handover ? 'handover' : 'text',
        text: draft,
        cards: turn.cards.slice(0, CARDS_MAX),
        sources: turn.sources.map((source) => source.ref).slice(-24),
      };
      return {
        turn: {
          ...turn,
          draft: null,
          result: ended(turn.handover ? 'handover' : 'answered', null, answer),
        },
      };
    }
    if (turn.rewrites >= MAX_REWRITES) {
      return { turn: { ...turn, draft: null, result: ended('guard_blocked', 'cannot_answer') } };
    }
    return {
      turn: {
        ...turn,
        draft: null,
        rewrites: turn.rewrites + 1,
        messages: [
          ...turn.messages,
          { role: 'assistant', text: draft, toolCalls: [] },
          {
            role: 'user',
            text: tooLong
              ? 'Your last answer was too long to send. Write it again in a few short sentences.'
              : rewriteInstruction({
                  figures: grounding.figures,
                  contact: grounding.issues.includes('contact'),
                  outcomes,
                  disclosed,
                }),
          },
        ],
      },
    };
  };

  // --- finish: the turn becomes history ---------------------------------------------------------
  const finish = (state: AgentStateValue): Partial<AgentStateValue> => {
    const { turn } = state;
    // What the traveller said in this turn (never the guard's own instructions to the model).
    const first = turn.messages[0];
    const said: ModelMessage[] = first?.role === 'user' ? [first] : [];
    const answered: ModelMessage[] = turn.result?.answer
      ? [{ role: 'assistant', text: turn.result.answer.text, toolCalls: [] }]
      : [];
    // A turn that ended in a notice leaves the traveller's words without an answer: both are
    // dropped, so the next model call never sees two user messages in a row.
    const history =
      answered.length > 0
        ? [...state.history, ...said, ...answered].slice(-HISTORY_MAX_MESSAGES)
        : state.history;
    return {
      history: history[0]?.role === 'assistant' ? history.slice(1) : history,
      lastAgent: turn.agent,
      turn: { ...turn, messages: [], said: [], sources: [], draft: null },
    };
  };

  const afterRoute = (state: AgentStateValue): 'think' | 'finish' =>
    state.turn.result ? 'finish' : 'think';
  const afterThink = (state: AgentStateValue): 'act' | 'check' | 'finish' =>
    state.turn.result ? 'finish' : state.turn.draft !== null ? 'check' : 'act';
  const afterAct = (state: AgentStateValue): 'think' | 'confirm' | 'finish' =>
    state.turn.result ? 'finish' : state.turn.pending ? 'confirm' : 'think';
  const afterCheck = (state: AgentStateValue): 'think' | 'finish' =>
    state.turn.result ? 'finish' : 'think';

  return new StateGraph(AgentState)
    .addNode('begin', begin)
    .addNode('route', route)
    .addNode('think', think)
    .addNode('act', act)
    .addNode('confirm', confirm)
    .addNode('check', check)
    .addNode('finish', finish)
    .addEdge(START, 'begin')
    .addEdge('begin', 'route')
    .addConditionalEdges('route', afterRoute, ['think', 'finish'])
    .addConditionalEdges('think', afterThink, ['act', 'check', 'finish'])
    .addConditionalEdges('act', afterAct, ['think', 'confirm', 'finish'])
    .addEdge('confirm', 'think')
    .addConditionalEdges('check', afterCheck, ['think', 'finish'])
    .addEdge('finish', END)
    .compile({ checkpointer });
}

export type AgentGraph = ReturnType<typeof buildAgentGraph>;
