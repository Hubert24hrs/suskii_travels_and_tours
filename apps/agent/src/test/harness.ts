import { MemorySaver } from '@langchain/langgraph';
import {
  type AgentName,
  type AgentRunEnd,
  type AgentRunEvent,
  type AgentRunRequest,
} from '@suskii/shared';
import { pino } from 'pino';

import { AgentModelFactory } from '../model/factory.js';
import { MockAgentModel, type MockScript } from '../model/mock-model.js';
import { RunService } from '../runs.js';
import {
  ToolGateway,
  type ToolAnswer,
  type ToolCall,
  type ToolDescription,
} from '../tools/gateway.js';

export const GRANT = 'sealed-grant-0123456789abcdef-never-in-a-checkpoint';
export const THREAD = '0193a000-0000-7000-8000-00000000aaaa';
let runCounter = 0;

/** A tool as the API's registry would describe it. */
export const tool = (
  name: string,
  agents: AgentName[],
  tier: ToolDescription['tier'] = 'read',
): ToolDescription => ({
  name,
  description: `Test tool ${name} for the agent service's own tests.`,
  tier,
  agents,
  parameters: { type: 'object', properties: {}, additionalProperties: true },
});

export type ToolHandler = (call: ToolCall) => ToolAnswer | Promise<ToolAnswer>;

export const ok = (result: unknown): ToolAnswer => ({ status: 'ok', reason: null, result });
export const denied = (
  reason: NonNullable<ToolAnswer['reason']>,
  result: unknown = null,
): ToolAnswer => ({
  status:
    reason === 'timeout'
      ? 'timeout'
      : ['not_found', 'refused', 'failed'].includes(reason)
        ? 'error'
        : 'denied',
  reason,
  result,
});

/** Stands in for the API's tool gateway: answers from handlers and remembers every call. */
export class FakeGateway extends ToolGateway {
  readonly calls: { tool: string; call: ToolCall }[] = [];
  constructor(
    public tools: ToolDescription[],
    private readonly handlers: Record<string, ToolHandler> = {},
  ) {
    super();
  }

  list(): Promise<ToolDescription[]> {
    return Promise.resolve(this.tools);
  }

  async call(name: string, call: ToolCall): Promise<ToolAnswer> {
    this.calls.push({ tool: name, call });
    const handler = this.handlers[name];
    return handler ? handler(call) : denied('unknown_tool');
  }
}

export interface Harness {
  service: RunService;
  model: MockAgentModel;
  gateway: FakeGateway;
  saver: MemorySaver;
  send(
    text: string,
    over?: Partial<AgentRunRequest> & { script?: MockScript; signal?: AbortSignal },
  ): Promise<{ end: AgentRunEnd; events: AgentRunEvent[] }>;
  resume(
    confirmationId: string,
    decision: 'confirmed' | 'declined' | 'expired' | 'failed',
    facts?: Record<string, unknown>,
    script?: MockScript,
  ): Promise<{ end: AgentRunEnd; events: AgentRunEvent[] }>;
}

export const request = (over: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  runId: `0193a000-0000-7000-8000-${String((runCounter += 1)).padStart(12, '0')}`,
  threadId: THREAD,
  grant: GRANT,
  context: {
    audience: 'customer',
    channel: 'web',
    locale: 'en-NG',
    currency: 'NGN',
    country: 'NG',
    agents: ['concierge', 'flights', 'hotels', 'bookings', 'payments', 'support', 'disruption'],
    signedIn: true,
    today: '2026-11-10',
  },
  limits: { maxSteps: 8, timeoutMs: 20_000, maxOutputTokens: 800 },
  input: { kind: 'message', text: 'hello' },
  ...over,
});

export function harness(
  tools: ToolDescription[] = [],
  handlers: Record<string, ToolHandler> = {},
  options: { maxConcurrentRuns?: number } = {},
): Harness {
  const model = new MockAgentModel();
  const gateway = new FakeGateway(tools, handlers);
  const saver = new MemorySaver();
  const service = new RunService({
    models: new AgentModelFactory(model, {
      router: 'mock-router',
      specialist: 'mock-specialist',
      fallback: 'mock-fallback',
    }),
    gateway,
    checkpointer: saver,
    logger: pino({ level: 'silent' }),
    maxConcurrentRuns: options.maxConcurrentRuns ?? 5,
    toolTimeoutMs: 2000,
  });
  const run = async (
    body: AgentRunRequest,
    script: MockScript | undefined,
    signal: AbortSignal,
  ): Promise<{ end: AgentRunEnd; events: AgentRunEvent[] }> => {
    model.use(script);
    const events: AgentRunEvent[] = [];
    await service.run(body, (event) => events.push(event), signal);
    const ends = events.filter((event): event is AgentRunEnd => event.type === 'end');
    const [end] = ends;
    if (!end || ends.length !== 1 || events.at(-1)?.type !== 'end') {
      throw new Error(`a run must end exactly once, last: got ${ends.length}`);
    }
    return { end, events };
  };
  return {
    service,
    model,
    gateway,
    saver,
    send: (text, over = {}) => {
      const { script, signal, ...rest } = over;
      return run(
        request({ ...rest, input: { kind: 'message', text } }),
        script,
        signal ?? new AbortController().signal,
      );
    },
    resume: (confirmationId, decision, facts, script) =>
      run(
        request({
          input: { kind: 'resume', confirmationId, decision, ...(facts ? { facts } : {}) },
        }),
        script,
        new AbortController().signal,
      ),
  };
}

/** Everything a thread's checkpoints hold, as text: what a leak would have to be found in. */
export async function checkpointText(saver: MemorySaver, threadId = THREAD): Promise<string> {
  const parts: string[] = [];
  for await (const tuple of saver.list({ configurable: { thread_id: threadId } })) {
    parts.push(JSON.stringify(tuple));
  }
  return parts.join('\n');
}
