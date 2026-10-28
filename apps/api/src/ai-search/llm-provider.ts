/**
 * The one thing AI features ask of a language model (ADR-061, ADR-085): turn text into a JSON
 * object that matches a schema. Adapters live beside this file; domain code never sees a vendor
 * type.
 */

/** Token usage of one call, as the provider billed it. */
export interface LlmUsage {
  /** Input tokens billed at the full rate (not read from or written to the cache). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const NO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export interface LlmExtraction {
  /** Which feature asks: AI trip search (the default) or the support assistant. */
  purpose?: 'trip-query' | 'support-answer';
  /** Fixed instructions; providers that cache prompts cache this part. */
  system: string;
  /** The per-request text, already scrubbed of personal data. */
  input: string;
  /** JSON schema the output must match (structured outputs). */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface LlmResult {
  /** The parsed JSON object; callers validate it before use. */
  output: unknown;
  usage: LlmUsage;
  /** The model that answered, for logs and metrics. */
  model: string;
}

/**
 * Why a call produced nothing usable. `timeout` and `unavailable` may still be billed, so the
 * caller keeps its cost reservation for them.
 */
export type LlmFailure =
  'timeout' | 'unavailable' | 'rejected' | 'refused' | 'truncated' | 'invalid_output';

export class LlmError extends Error {
  constructor(
    readonly reason: LlmFailure,
    /** Usage when the provider reported it (a refusal or truncation is still billed). */
    readonly usage?: LlmUsage,
  ) {
    super(`LLM call failed: ${reason}`);
    this.name = 'LlmError';
  }
}

export abstract class LlmProvider {
  abstract readonly name: string;
  abstract extract(request: LlmExtraction): Promise<LlmResult>;
}
