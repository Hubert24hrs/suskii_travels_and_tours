import { Injectable } from '@nestjs/common';

import { LlmError, LlmProvider, NO_USAGE, type LlmUsage } from '../../ai-search/llm-provider';
import { scrubQuery } from '../../ai-search/scrub';

import { checkAnswer, type AnswerCheckFailure } from './assistant-checks';
import type { AssistantFact } from './assistant-facts';
import {
  SUPPORT_ANSWER_JSON_SCHEMA,
  supportAnswerOutputSchema,
  supportAssistantInput,
  supportAssistantSystem,
  type AssistantFaq,
} from './assistant-prompt';

/** Room for the model's (low-effort) thinking plus a short answer. */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 1024;
/** Conservative: fewer characters per token than most text, so a reservation covers it. */
const CHARS_PER_TOKEN = 3;
/** The traveller's words sent to the model, after scrubbing. */
export const ASSISTANT_MESSAGE_MAX = 2_000;

export interface AnswerRequest {
  faqs: readonly AssistantFaq[];
  facts: readonly AssistantFact[];
  /** The traveller's unanswered messages, oldest first, as written. */
  messages: readonly string[];
}

/** Why the assistant handed over: its checks, nothing left to ask, the spend caps or the model. */
export type HandoverReason =
  AnswerCheckFailure | 'nothing_to_answer' | 'budget' | 'invalid_output' | LlmError['reason'];

export type AnswerOutcome =
  | { kind: 'answer'; text: string; sources: string[]; usage: LlmUsage; model: string }
  | { kind: 'handover'; reason: HandoverReason; usage: LlmUsage };

export interface PreparedAnswer {
  system: string;
  input: string;
  /** For the cost reservation: the most input tokens the call can bill. */
  promptTokens: number;
}

/**
 * The after-hours assistant's one question to the model (ADR-085), with no storage or budget:
 * scrub the traveller's words, ask for structured output, validate it and check every claim
 * against the sources. The service and the eval both use it.
 */
@Injectable()
export class SupportAnswerer {
  constructor(private readonly provider: LlmProvider) {}

  /** The prompt for a request; null when nothing is left to answer after scrubbing. */
  prepare(request: AnswerRequest): PreparedAnswer | null {
    const message = scrubQuery(request.messages.join('\n')).slice(0, ASSISTANT_MESSAGE_MAX);
    if (message === '' || /^(\[removed\]\s*)+$/.test(message)) return null;
    const system = supportAssistantSystem(request.faqs);
    const input = supportAssistantInput(request.facts, message);
    return {
      system,
      input,
      promptTokens: Math.ceil((system.length + input.length) / CHARS_PER_TOKEN),
    };
  }

  async answer(request: AnswerRequest, prepared = this.prepare(request)): Promise<AnswerOutcome> {
    if (!prepared) return { kind: 'handover', reason: 'nothing_to_answer', usage: NO_USAGE };
    let output: unknown;
    let usage: LlmUsage;
    let model: string;
    try {
      const result = await this.provider.extract({
        purpose: 'support-answer',
        system: prepared.system,
        input: prepared.input,
        schema: SUPPORT_ANSWER_JSON_SCHEMA,
        maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
      });
      ({ output, usage, model } = result);
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      return { kind: 'handover', reason: error.reason, usage: error.usage ?? NO_USAGE };
    }
    const parsed = supportAnswerOutputSchema.safeParse(output);
    if (!parsed.success) return { kind: 'handover', reason: 'invalid_output', usage };
    const known = new Map<string, string>([
      ...request.faqs.map((faq): [string, string] => [faq.id, `${faq.question}\n${faq.answer}`]),
      ...request.facts.map((fact): [string, string] => [fact.key, fact.text]),
    ]);
    const checked = checkAnswer(parsed.data, known);
    if (!checked.ok) return { kind: 'handover', reason: checked.reason, usage };
    return { kind: 'answer', text: checked.answer, sources: checked.sources, usage, model };
  }
}
