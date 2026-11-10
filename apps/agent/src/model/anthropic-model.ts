import Anthropic from '@anthropic-ai/sdk';

import {
  AgentModel,
  ModelError,
  type ModelFailure,
  type ModelMessage,
  type ModelRequest,
  type ModelTurn,
} from './model.js';

export interface AnthropicModelOptions {
  apiKey: string;
  timeoutMs: number;
  /** Tests answer requests themselves; production uses the platform's fetch. */
  fetch?: typeof globalThis.fetch;
}

const API_URL = 'https://api.anthropic.com';

/**
 * Claude through the official SDK, confined to this adapter (ADR-106). As in the API's adapter
 * (ADR-061), every setting the SDK would read from the environment is fixed here: the host, the
 * credential, metadata-only traces with no trace context sent out, no SDK logging, redirects
 * refused. The SDK retries nothing: the graph decides what a failure means.
 */
export class AnthropicAgentModel extends AgentModel {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;

  constructor(options: AnthropicModelOptions) {
    super();
    this.client = new Anthropic({
      apiKey: options.apiKey,
      authToken: null,
      baseURL: API_URL,
      timeout: options.timeoutMs,
      maxRetries: 0,
      fetchOptions: { redirect: 'error' },
      ...(options.fetch ? { fetch: options.fetch } : {}),
      openTelemetry: { propagation: false, traces: { contentMode: 'metadata_only' } },
      logLevel: 'off',
    });
  }

  async complete(request: ModelRequest, model: string): Promise<ModelTurn> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model,
          max_tokens: request.maxOutputTokens,
          // The fixed instructions are cached; the conversation comes after the breakpoint.
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: toMessages(request.messages),
          ...(request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: {
                    ...tool.parameters,
                    type: 'object' as const,
                  },
                })),
                tool_choice: request.toolChoice
                  ? { type: 'tool' as const, name: request.toolChoice.name }
                  : { type: 'auto' as const },
              }
            : {}),
          // No thinking blocks to carry between turns, and no sampling parameters: effort only.
          thinking: { type: 'disabled' },
          output_config: { effort: request.role === 'router' ? 'low' : 'medium' },
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw new ModelError(failureOf(error));
    }
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    const toolCalls = message.content.flatMap((block) =>
      block.type === 'tool_use'
        ? [
            {
              id: block.id,
              name: block.name,
              arguments:
                typeof block.input === 'object' && block.input !== null
                  ? (block.input as Record<string, unknown>)
                  : {},
            },
          ]
        : [],
    );
    return {
      text,
      toolCalls,
      stop:
        message.stop_reason === 'tool_use'
          ? 'tool_use'
          : message.stop_reason === 'refusal'
            ? 'refusal'
            : message.stop_reason === 'max_tokens' ||
                message.stop_reason === 'model_context_window_exceeded'
              ? 'max_tokens'
              : 'end',
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
      model: message.model,
    };
  }
}

/** Our turns as the Messages API wants them: tool results travel in the next user message. */
function toMessages(messages: readonly ModelMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const last = out.at(-1);
      // Words that follow tool results belong to the same user turn: roles must alternate.
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push({ type: 'text', text: message.text });
      } else if (last?.role === 'user' && typeof last.content === 'string') {
        last.content = `${last.content}\n\n${message.text}`;
      } else out.push({ role: 'user', content: message.text });
    } else if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: [
          ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
          ...message.toolCalls.map((call) => ({
            type: 'tool_use' as const,
            id: call.id,
            name: call.name,
            input: call.arguments,
          })),
        ],
      });
    } else {
      const result = {
        type: 'tool_result' as const,
        tool_use_id: message.toolCallId,
        content: message.content,
        is_error: message.isError,
      };
      const last = out.at(-1);
      // Several results of one assistant turn share one user message.
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(result);
      else out.push({ role: 'user', content: [result] });
    }
  }
  return out;
}

/** Typed SDK errors, most specific first. */
function failureOf(error: unknown): ModelFailure {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIUserAbortError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'unavailable';
  if (error instanceof Anthropic.RateLimitError) return 'unavailable';
  if (error instanceof Anthropic.InternalServerError) return 'unavailable';
  if (error instanceof Anthropic.APIError) return 'rejected';
  return 'unavailable';
}
