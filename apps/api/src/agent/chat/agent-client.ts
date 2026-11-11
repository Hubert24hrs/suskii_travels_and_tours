import {
  agentRunEventSchema,
  type AgentRunEnd,
  type AgentRunEvent,
  type AgentRunRequest,
} from '@suskii/shared';

/** What the API does with each event of a run as it arrives. */
export type AgentEventHandler = (event: AgentRunEvent) => void | Promise<void>;

/**
 * The agent service as the API sees it (ADR-101): start or resume a run and receive its events,
 * ending with exactly one `end`. Adapters never throw for a run that went wrong: they end it
 * with a code, so the caller has one path for every outcome.
 */
export abstract class AgentClient {
  abstract readonly name: 'http' | 'mock';
  abstract run(
    request: AgentRunRequest,
    onEvent: AgentEventHandler,
    signal: AbortSignal,
  ): Promise<void>;
}

export const AGENT_CLIENT = Symbol('AGENT_CLIENT');

const FAILED: AgentRunEnd = {
  type: 'end',
  outcome: 'failed',
  agent: 'concierge',
  agents: [],
  answer: null,
  notice: 'unavailable',
  confirmationId: null,
  prompts: [],
  steps: 0,
  usage: [],
};

/** A run that never reached the agent service, or whose stream broke before its end. */
export const failedRun = (outcome: AgentRunEnd['outcome'] = 'failed'): AgentRunEnd => ({
  ...FAILED,
  outcome,
  notice: outcome === 'timeout' ? 'timeout' : 'unavailable',
});

export interface HttpAgentClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}

/** A line of the stream is an event; one far longer than an answer is not ours. */
const MAX_LINE_BYTES = 64 * 1024;

/**
 * Calls the agent service's `POST /runs` and reads its newline-delimited events. Every line is
 * parsed with the shared schema; a line that does not fit, a broken stream or an unreachable
 * service ends the run as `failed`, and a second `end` is ignored.
 */
export class HttpAgentClient extends AgentClient {
  readonly name = 'http';
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly options: HttpAgentClientOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async run(
    request: AgentRunRequest,
    onEvent: AgentEventHandler,
    signal: AbortSignal,
  ): Promise<void> {
    let ended = false;
    const emit = async (event: AgentRunEvent): Promise<void> => {
      if (ended) return;
      if (event.type === 'end') ended = true;
      await onEvent(event);
    };
    try {
      const response = await this.fetchImpl(new URL('/runs', this.options.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify(request),
        redirect: 'error',
        signal,
      });
      if (!response.ok || !response.body) {
        await emit(failedRun());
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > MAX_LINE_BYTES * 4) break;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.length > 0) {
            const event = parse(line);
            // A line we cannot read means the stream is not what we agreed on: stop trusting it.
            if (!event) {
              await emit(failedRun());
              return;
            }
            await emit(event);
          }
          newline = buffer.indexOf('\n');
        }
        if (ended) break;
      }
    } catch {
      await emit(failedRun(signal.aborted ? 'timeout' : 'failed'));
      return;
    }
    await emit(failedRun());
  }
}

function parse(line: string): AgentRunEvent | null {
  if (line.length > MAX_LINE_BYTES) return null;
  try {
    const parsed = agentRunEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** What the mock answers when no script is set: one sentence that claims nothing. */
export const MOCK_AGENT_ANSWER =
  'This is the sample assistant. No language model is connected in this environment, so I cannot answer questions yet.';

/** Decides a mock run: emit events and finish with an `end`, or return nothing for the default. */
export type MockAgentScript = (
  request: AgentRunRequest,
  emit: (event: AgentRunEvent) => Promise<void>,
) => Promise<void> | void;

/**
 * The assistant inside the API, for tests and for a stack without the agent service. It calls
 * no model. A test hands it a script that plays the agent service's part (and may call the
 * tool gateway with the request's grant, as the real one would).
 */
export class MockAgentClient extends AgentClient {
  readonly name = 'mock';
  /** Every request it was given, for tests. */
  readonly requests: AgentRunRequest[] = [];
  private script: MockAgentScript | null = null;

  use(script: MockAgentScript | null): void {
    this.script = script;
    this.requests.length = 0;
  }

  async run(request: AgentRunRequest, onEvent: AgentEventHandler): Promise<void> {
    this.requests.push(request);
    let ended = false;
    const emit = async (event: AgentRunEvent): Promise<void> => {
      if (ended) return;
      const parsed = agentRunEventSchema.safeParse(event);
      // The mock is held to the same wire as the real service.
      const safe = parsed.success ? parsed.data : failedRun();
      if (safe.type === 'end') ended = true;
      await onEvent(safe);
    };
    try {
      await this.script?.(request, emit);
    } catch {
      await emit(failedRun());
    }
    if (ended) return;
    const agent = request.context.agents.includes('concierge')
      ? 'concierge'
      : (request.context.agents[0] ?? 'concierge');
    await emit({ type: 'status', agent, phase: 'thinking' });
    await emit({
      type: 'end',
      outcome: 'answered',
      agent,
      agents: [agent],
      answer: { kind: 'text', text: MOCK_AGENT_ANSWER, cards: [], sources: [] },
      notice: null,
      confirmationId: null,
      prompts: [`${agent}@1`],
      steps: 1,
      usage: [
        {
          role: 'specialist',
          provider: 'mock',
          model: 'mock-specialist',
          calls: 1,
          inputTokens: 200,
          outputTokens: 30,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ],
    });
  }
}
