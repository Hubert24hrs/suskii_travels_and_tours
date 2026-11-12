/**
 * What the graphs ask of a language model (ADR-106): one turn of a conversation that may call
 * tools. Vendor types stay in the adapters beside this file; the graphs never see one.
 */

/** Which model a step deserves: deciding where a message goes is cheap work, answering is not. */
export type ModelRole = 'router' | 'specialist';

export interface ModelToolSpec {
  /** As the model sees it: `flights__search` for the tool `flights.search`. */
  name: string;
  description: string;
  /** JSON Schema of the arguments, from the API's tool registry. */
  parameters: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ModelMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ModelToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError: boolean };

export interface ModelRequest {
  role: ModelRole;
  /** The prompt that produced `system`, for the run record and for the mock's recordings. */
  prompt: { id: string; version: number };
  system: string;
  messages: ModelMessage[];
  tools: ModelToolSpec[];
  /** Force one tool (the router's `route`), or let the model decide. */
  toolChoice?: { name: string };
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ModelTurn {
  text: string;
  toolCalls: ModelToolCall[];
  stop: 'end' | 'tool_use' | 'max_tokens' | 'refusal';
  usage: ModelUsage;
  /** The model that answered, as the provider names it. */
  model: string;
}

/**
 * Why a call produced no turn. `timeout` and `unavailable` can pass on a second try or on the
 * fallback model; `rejected` (a bad request, a bad key) cannot.
 */
export type ModelFailure = 'timeout' | 'unavailable' | 'rejected';

export class ModelError extends Error {
  constructor(readonly reason: ModelFailure) {
    super(`model call failed: ${reason}`);
    this.name = 'ModelError';
  }
}

export abstract class AgentModel {
  abstract readonly provider: string;
  abstract complete(request: ModelRequest, model: string): Promise<ModelTurn>;
}

export const NO_USAGE: ModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** The gateway names tools `area.action`; a model's tool name may not hold a dot. */
export const modelToolName = (tool: string): string => tool.replace('.', '__');
export const gatewayToolName = (name: string): string => name.replace('__', '.');
