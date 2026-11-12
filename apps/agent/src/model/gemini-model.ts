import { randomUUID } from 'node:crypto';

import {
  AgentModel,
  ModelError,
  type ModelFailure,
  type ModelMessage,
  type ModelRequest,
  type ModelToolCall,
  type ModelTurn,
} from './model.js';

/** How much a Gemini 3 (or later) model may think before it answers. */
export const GEMINI_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
export type GeminiThinkingLevel = (typeof GEMINI_THINKING_LEVELS)[number];

export interface GeminiModelOptions {
  apiKey: string;
  timeoutMs: number;
  /** Gemini 3 and later only (`thinkingConfig.thinkingLevel`); `low` when left out. */
  thinkingLevel?: GeminiThinkingLevel | undefined;
  /** Tests answer requests themselves; production uses the platform's fetch. */
  fetch?: typeof globalThis.fetch;
}

const API_URL = 'https://generativelanguage.googleapis.com/v1beta';
/** Ids this adapter makes for calls the API named none for; never sent back to it. */
const OWN_ID = 'gm_';

interface GeminiPart {
  text?: string;
  /** A summary of the model's thinking: never part of the answer. */
  thought?: boolean;
  functionCall?: { id?: string; name?: string; args?: unknown };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  /** Opaque state the model wants back with this part on the next request. */
  thoughtSignature?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
}

/** Finish reasons that mean the model, or a filter in front of it, declined to answer. */
const REFUSALS = new Set([
  'SAFETY',
  'RECITATION',
  'LANGUAGE',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
]);

/** HTTP answers that can pass on a second try or on the fallback model. */
const PASSING = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Google's Gemini through its `generateContent` REST call, confined to this adapter (ADR-109).
 * No SDK: one HTTPS request to one fixed host with the key in a header, redirects refused,
 * nothing retried here (the graph decides what a failure means) and nothing logged, since an
 * error body can repeat what was sent.
 *
 * Two families behave differently, and the model's name tells which:
 * - Gemini 2.5 Flash thinks only when asked to. Thinking is switched off (`thinkingBudget: 0`):
 *   thought tokens count against the output limit and are billed as output.
 * - Gemini 3 and later always think and hand back a signature with a function call, which must
 *   come back with that call on the next request or the request is refused. The signature
 *   travels on the tool call (`ModelToolCall.signature`) and is returned untouched.
 */
export class GeminiAgentModel extends AgentModel {
  readonly provider = 'gemini';
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly thinkingLevel: GeminiThinkingLevel;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: GeminiModelOptions) {
    super();
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.thinkingLevel = options.thinkingLevel ?? 'low';
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(request: ModelRequest, model: string): Promise<ModelTurn> {
    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: toContents(request.messages),
      ...(request.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  // The registry's JSON Schema as it is: this field takes JSON Schema itself.
                  parametersJsonSchema: tool.parameters,
                })),
              },
            ],
            toolConfig: {
              functionCallingConfig: request.toolChoice
                ? { mode: 'ANY', allowedFunctionNames: [request.toolChoice.name] }
                : { mode: 'AUTO' },
            },
          }
        : {}),
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens,
        ...thinkingOf(model, this.thinkingLevel),
      },
    };

    const timeout = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetch(
        `${API_URL}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.any([request.signal, timeout]),
        },
      );
    } catch {
      throw new ModelError(timeout.aborted || request.signal.aborted ? 'timeout' : 'unavailable');
    }
    if (!response.ok) throw new ModelError(failureOf(response.status));

    let data: GeminiResponse;
    try {
      data = (await response.json()) as GeminiResponse;
    } catch {
      throw new ModelError('unavailable');
    }
    return toTurn(data, model);
  }
}

/** A name such as `gemini-3.8-flash` or `gemini-2.5-flash-lite`: its major and minor version. */
function versionOf(model: string): { major: number; minor: number } | null {
  const match = /^gemini-(\d+)(?:\.(\d+))?/.exec(model);
  return match ? { major: Number(match[1]), minor: Number(match[2] ?? 0) } : null;
}

/** The thinking settings a model takes; nothing for one whose rules are not known here. */
function thinkingOf(
  model: string,
  level: GeminiThinkingLevel,
): { thinkingConfig?: Record<string, unknown> } {
  const version = versionOf(model);
  if (!version) return {};
  if (version.major >= 3) return { thinkingConfig: { thinkingLevel: level } };
  // 2.5 Flash and Flash-Lite may switch thinking off; 2.5 Pro may not, so it keeps its own.
  if (version.major === 2 && version.minor === 5 && model.includes('flash')) {
    return { thinkingConfig: { thinkingBudget: 0 } };
  }
  return {};
}

const failureOf = (status: number): ModelFailure =>
  PASSING.has(status) ? 'unavailable' : 'rejected';

/**
 * Our turns as `contents`: roles are `user` and `model`, and must alternate, so what follows a
 * model turn (its tool results, and any words after them) is one `user` content.
 */
function toContents(messages: readonly ModelMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const push = (role: GeminiContent['role'], parts: GeminiPart[]): void => {
    if (parts.length === 0) return;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const message of messages) {
    if (message.role === 'user') {
      push('user', [{ text: message.text }]);
    } else if (message.role === 'assistant') {
      push('model', [
        ...(message.text ? [{ text: message.text }] : []),
        // In the order the model made them: it checks that order against its signature.
        ...message.toolCalls.map((call): GeminiPart => ({
          functionCall: {
            name: call.name,
            args: call.arguments,
            ...(call.id.startsWith(OWN_ID) ? {} : { id: call.id }),
          },
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        })),
      ]);
    } else {
      push('user', [
        {
          functionResponse: {
            name: message.name,
            response: message.isError
              ? { error: message.content }
              : { output: parsed(message.content) },
            ...(message.toolCallId.startsWith(OWN_ID) ? {} : { id: message.toolCallId }),
          },
        },
      ]);
    }
  }
  return contents;
}

/** A tool's result as the JSON it is; text that is not JSON stays text. */
function parsed(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

function toTurn(data: GeminiResponse, asked: string): ModelTurn {
  const usage = {
    // Cached input is priced on its own, as the other providers' cache reads are.
    inputTokens: Math.max(
      0,
      (data.usageMetadata?.promptTokenCount ?? 0) -
        (data.usageMetadata?.cachedContentTokenCount ?? 0),
    ),
    // Thinking is billed as output.
    outputTokens:
      (data.usageMetadata?.candidatesTokenCount ?? 0) +
      (data.usageMetadata?.thoughtsTokenCount ?? 0),
    cacheReadTokens: data.usageMetadata?.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
  };
  const model = data.modelVersion ?? asked;
  const candidate = data.candidates?.[0];
  if (!candidate) {
    // The prompt itself was blocked: an answer, of a kind. Anything else is no answer at all.
    if (data.promptFeedback?.blockReason) {
      return { text: '', toolCalls: [], stop: 'refusal', usage, model };
    }
    throw new ModelError('unavailable');
  }
  const parts = candidate.content?.parts ?? [];
  const text = parts
    .flatMap((part) => (typeof part.text === 'string' && part.thought !== true ? [part.text] : []))
    .join('')
    .trim();
  const toolCalls = parts.flatMap((part): ModelToolCall[] => {
    const call = part.functionCall;
    if (!call || typeof call.name !== 'string' || call.name.length === 0) return [];
    return [
      {
        id:
          typeof call.id === 'string' && call.id.length > 0 ? call.id : `${OWN_ID}${randomUUID()}`,
        name: call.name,
        arguments:
          typeof call.args === 'object' && call.args !== null && !Array.isArray(call.args)
            ? (call.args as Record<string, unknown>)
            : {},
        ...(typeof part.thoughtSignature === 'string' ? { signature: part.thoughtSignature } : {}),
      },
    ];
  });
  const reason = candidate.finishReason ?? 'STOP';
  if (toolCalls.length > 0) return { text, toolCalls, stop: 'tool_use', usage, model };
  if (reason === 'MAX_TOKENS') return { text, toolCalls, stop: 'max_tokens', usage, model };
  if (REFUSALS.has(reason)) return { text, toolCalls, stop: 'refusal', usage, model };
  // A call the model could not form, or a stop nobody can explain: with nothing said, that is
  // no turn, and the fallback model gets its one try.
  if (reason !== 'STOP' && text.length === 0) throw new ModelError('unavailable');
  return { text, toolCalls, stop: 'end', usage, model };
}
