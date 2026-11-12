import { AGENT_NAMES, AGENT_TOOL_DENIALS, AGENT_TOOL_TIERS, type AgentName } from '@suskii/shared';
import { z } from 'zod';

/** A tool as the API's registry describes it: the agent service declares none of its own. */
const toolDescription = z.object({
  name: z.string().regex(/^[a-z][a-z_]{1,30}\.[a-z][a-z_]{1,30}$/),
  description: z.string().min(1).max(2000),
  tier: z.enum(AGENT_TOOL_TIERS),
  agents: z.array(z.enum(AGENT_NAMES)),
  parameters: z.record(z.string(), z.unknown()),
});
export type ToolDescription = z.infer<typeof toolDescription>;

const toolList = z.object({ tools: z.array(toolDescription).max(200) });

const toolAnswer = z.object({
  status: z.enum(['ok', 'denied', 'error', 'timeout']),
  reason: z.enum(AGENT_TOOL_DENIALS).nullable(),
  result: z.unknown(),
  issues: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
});
export type ToolAnswer = z.infer<typeof toolAnswer>;

export interface ToolCall {
  /** The sealed grant of the run, passed back unopened. */
  grant: string;
  agent: AgentName;
  arguments: Record<string, unknown>;
}

/**
 * The only way the agent service reaches the platform (ADR-101): the API's tool gateway. It
 * lists the tools and runs one for a grant; who the caller is and what they may reach is inside
 * the grant, which this service cannot read.
 */
export abstract class ToolGateway {
  abstract list(signal?: AbortSignal): Promise<ToolDescription[]>;
  abstract call(tool: string, call: ToolCall, signal: AbortSignal): Promise<ToolAnswer>;
}

export interface HttpToolGatewayOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

/** The gateway could not be reached or answered something that is not an answer. */
export class GatewayError extends Error {
  constructor(readonly reason: 'unreachable' | 'unauthorized' | 'invalid') {
    super(`tool gateway: ${reason}`);
    this.name = 'GatewayError';
  }
}

const LIST_TTL_MS = 5 * 60_000;

export class HttpToolGateway extends ToolGateway {
  private readonly fetchImpl: typeof globalThis.fetch;
  private cached: { at: number; tools: ToolDescription[] } | null = null;

  constructor(private readonly options: HttpToolGatewayOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** The registry changes only with an API release: one read serves five minutes of runs. */
  async list(signal?: AbortSignal): Promise<ToolDescription[]> {
    if (this.cached && Date.now() - this.cached.at < LIST_TTL_MS) return this.cached.tools;
    const body = await this.request('GET', '/v1/internal/agent-tools', undefined, signal);
    const parsed = toolList.safeParse(body);
    if (!parsed.success) throw new GatewayError('invalid');
    this.cached = { at: Date.now(), tools: parsed.data.tools };
    return parsed.data.tools;
  }

  async call(tool: string, call: ToolCall, signal: AbortSignal): Promise<ToolAnswer> {
    const body = await this.request(
      'POST',
      `/v1/internal/agent-tools/${encodeURIComponent(tool)}`,
      call,
      signal,
    );
    const parsed = toolAnswer.safeParse(body);
    if (!parsed.success) throw new GatewayError('invalid');
    return parsed.data;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
        method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new GatewayError('unreachable');
    }
    if (response.status === 401 || response.status === 404) throw new GatewayError('unauthorized');
    if (!response.ok) throw new GatewayError('unreachable');
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new GatewayError('invalid');
    }
  }
}
