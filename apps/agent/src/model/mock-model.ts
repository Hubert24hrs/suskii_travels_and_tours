import { AGENT_NAMES, type AgentName } from '@suskii/shared';

import { obviousAgent } from '../graph/pre-router.js';

import {
  AgentModel,
  ModelError,
  type ModelFailure,
  type ModelRequest,
  type ModelTurn,
  type ModelUsage,
} from './model.js';

/** A model turn as a fixture holds it: what was said and which tools were asked for. */
export interface RecordedTurn {
  text?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  stop?: ModelTurn['stop'];
  usage?: Partial<ModelUsage>;
  /** Fail the call instead of answering, to exercise retries and the fallback model. */
  fail?: ModelFailure;
}

/** Chooses the recorded turn for a request, or nothing to fall back on the sample answers. */
export type MockScript = (request: ModelRequest, model: string) => RecordedTurn | undefined;

/** What the mock says as a specialist when no recording covers the request. */
export const MOCK_SPECIALIST_ANSWER =
  'This is the sample assistant. No language model is connected in this environment, so I cannot answer questions yet.';

/** What it says after reading the status page, so a local stack shows a whole tool round trip. */
export const MOCK_STATUS_ANSWER =
  'This is the sample assistant. It read the status page through the tool gateway; no language model is connected in this environment.';

/** The tool the router is forced to call. */
export const ROUTE_TOOL = 'route';
/** The one tool the sample assistant calls by itself: public, read-only and free. */
const STATUS_TOOL = 'platform__status';

/**
 * The model used locally and in tests (ADR-106): it replays turns a script hands it and calls
 * no vendor. Without a script it routes by the pre-router's keywords and answers with one fixed
 * sentence, so a local stack runs end to end and nobody mistakes it for a model. Asked about the
 * platform's "status", it calls the status tool once first: the only way to see the service, the
 * gateway and a grant work together without a model.
 */
export class MockAgentModel extends AgentModel {
  readonly provider = 'mock';
  /** Every request it was given, for tests. */
  readonly requests: { request: ModelRequest; model: string }[] = [];
  private counter = 0;

  constructor(private script?: MockScript) {
    super();
  }

  use(script: MockScript | undefined): void {
    this.script = script;
    this.requests.length = 0;
  }

  complete(request: ModelRequest, model: string): Promise<ModelTurn> {
    this.requests.push({ request, model });
    if (request.signal.aborted) return Promise.reject(new ModelError('timeout'));
    const recorded = this.script?.(request, model) ?? sample(request);
    if (recorded.fail) return Promise.reject(new ModelError(recorded.fail));
    const toolCalls = (recorded.toolCalls ?? []).map((call) => ({
      id: `mock_${(this.counter += 1)}`,
      name: call.name,
      arguments: call.arguments,
    }));
    const text = recorded.text ?? '';
    return Promise.resolve({
      text,
      toolCalls,
      stop: recorded.stop ?? (toolCalls.length > 0 ? 'tool_use' : 'end'),
      usage: {
        // A fixture may state usage; otherwise about four characters a token, so budgets move.
        inputTokens: recorded.usage?.inputTokens ?? Math.ceil(sizeOf(request) / 4),
        outputTokens: recorded.usage?.outputTokens ?? Math.ceil((text.length + 40) / 4),
        cacheReadTokens: recorded.usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: recorded.usage?.cacheWriteTokens ?? 0,
      },
      model,
    });
  }
}

const sizeOf = (request: ModelRequest): number =>
  request.system.length +
  request.messages.reduce(
    (sum, message) => sum + ('text' in message ? message.text.length : message.content.length),
    0,
  );

function sample(request: ModelRequest): RecordedTurn {
  const last = [...request.messages].reverse().find((message) => message.role === 'user');
  if (request.role !== 'router') {
    const answered = request.messages.some((message) => message.role === 'tool');
    if (answered) return { text: MOCK_STATUS_ANSWER };
    const offered = request.tools.some((tool) => tool.name === STATUS_TOOL);
    return offered && last && /\bstatus\b/i.test(last.text)
      ? { toolCalls: [{ name: STATUS_TOOL, arguments: {} }] }
      : { text: MOCK_SPECIALIST_ANSWER };
  }
  const allowed = routable(request);
  const guess = last ? (obviousAgent(last.text) ?? staffGuess(last.text)) : null;
  const agent: AgentName = guess && allowed.includes(guess) ? guess : (allowed[0] ?? 'concierge');
  return { toolCalls: [{ name: ROUTE_TOOL, arguments: { agent } }] };
}

/** Enough to tell the staff agents apart on a local stack; the real router is a model. */
const STAFF_GUESSES: readonly (readonly [RegExp, AgentName])[] = [
  [/\b(refund|payout|reconcil|payment)/i, 'finance_prep'],
  [/\bpromo/i, 'marketing'],
  [/\b(queue|waiting|ticketing|backlog)/i, 'operations'],
  [/\b(sales|revenue|report)/i, 'business_intelligence'],
  [/\b(vendor|scrap|website|price intel)/i, 'price_intel'],
];

const staffGuess = (text: string): AgentName | null =>
  STAFF_GUESSES.find(([pattern]) => pattern.test(text))?.[1] ?? null;

/** The agents the router's tool offers in this request. */
function routable(request: ModelRequest): AgentName[] {
  const tool = request.tools.find((candidate) => candidate.name === ROUTE_TOOL);
  const properties = tool?.parameters.properties as { agent?: { enum?: unknown } } | undefined;
  const offered = Array.isArray(properties?.agent?.enum) ? properties.agent.enum : [];
  return (AGENT_NAMES as readonly AgentName[]).filter((agent) => offered.includes(agent));
}

/**
 * A script that hands out turns in order, per role: what a fixture of a whole run looks like.
 * When a role's turns run out the sample answers take over.
 */
export function scripted(turns: {
  router?: RecordedTurn[];
  specialist?: RecordedTurn[];
}): MockScript {
  const queues = { router: [...(turns.router ?? [])], specialist: [...(turns.specialist ?? [])] };
  return (request) => queues[request.role].shift();
}
