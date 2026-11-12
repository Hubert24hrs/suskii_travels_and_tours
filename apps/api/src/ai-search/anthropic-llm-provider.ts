import Anthropic from '@anthropic-ai/sdk';

import {
  LlmError,
  LlmProvider,
  type LlmExtraction,
  type LlmResult,
  type LlmUsage,
} from './llm-provider';

export interface AnthropicLlmOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Tests answer requests themselves; production uses the platform's fetch. */
  fetch?: typeof globalThis.fetch;
}

const API_URL = 'https://api.anthropic.com';

/**
 * Claude through the official SDK, confined to this adapter (ADR-061). Every setting the SDK
 * would otherwise read from the environment is fixed here: the host (no base-URL override), the
 * credential (no profiles or auth tokens), metadata-only traces with no trace context sent to a
 * third party, no SDK logging, redirects refused.
 */
export class AnthropicLlmProvider extends LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicLlmOptions) {
    super();
    this.client = new Anthropic({
      apiKey: options.apiKey,
      authToken: null,
      baseURL: API_URL,
      timeout: options.timeoutMs,
      maxRetries: 1,
      fetchOptions: { redirect: 'error' },
      ...(options.fetch ? { fetch: options.fetch } : {}),
      openTelemetry: { propagation: false, traces: { contentMode: 'metadata_only' } },
      logLevel: 'off',
    });
  }

  async extract(request: LlmExtraction): Promise<LlmResult> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.options.model,
        max_tokens: request.maxOutputTokens,
        // The fixed prompt is cached; the volatile input comes after the breakpoint.
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.input }],
        // No sampling parameters (removed from the API): a schema and low effort instead.
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: request.schema },
        },
      });
    } catch (error) {
      throw new LlmError(failureOf(error));
    }
    const usage = usageOf(message.usage);
    if (message.stop_reason === 'refusal') throw new LlmError('refused', usage);
    if (message.stop_reason !== 'end_turn') throw new LlmError('truncated', usage);
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    try {
      return { output: JSON.parse(text) as unknown, usage, model: message.model };
    } catch {
      throw new LlmError('invalid_output', usage);
    }
  }
}

function usageOf(usage: Anthropic.Usage): LlmUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Typed SDK errors, most specific first; a timeout may still be billed. */
function failureOf(error: unknown): LlmError['reason'] {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'unavailable';
  if (error instanceof Anthropic.RateLimitError) return 'unavailable';
  if (error instanceof Anthropic.InternalServerError) return 'unavailable';
  if (error instanceof Anthropic.APIError) return 'rejected';
  return 'unavailable';
}
