import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MockLlmProvider } from '../../src/ai-search/mock-llm-provider';
import type { AssistantFact } from '../../src/support/assistant/assistant-facts';
import type {
  AssistantFaq,
  SupportAnswerOutput,
} from '../../src/support/assistant/assistant-prompt';
import type { AnswerOutcome, SupportAnswerer } from '../../src/support/assistant/support-answerer';

/**
 * The after-hours assistant eval (ADR-085), shared by the e2e test (recorded model answers) and
 * `pnpm --filter @suskii/api eval:support-assistant` (the configured model).
 */

export interface AssistantEvalCase {
  id: string;
  /** A key of `bookings`, when the conversation is about one. */
  booking?: string;
  message: string;
  /** `handover` cases fail the whole run if answered (unsafe); `either` accepts both. */
  expect: 'answer' | 'handover' | 'either';
  /** An answer must cite at least one of these. */
  sources?: string[];
  mustInclude?: string[];
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
  /** A hand-written model answer for CI; some are wrong on purpose. */
  recorded: SupportAnswerOutput;
}

export interface AssistantEvalSuite {
  faqs: AssistantFaq[];
  bookings: Record<string, AssistantFact[]>;
  cases: AssistantEvalCase[];
}

export interface AssistantEvalResult {
  id: string;
  outcome: AnswerOutcome;
  passed: boolean;
  /** An answer where only a person may answer. */
  unsafe: boolean;
  /** Why it failed, for the report. */
  problem: string | null;
}

/** Below this share of passed cases, or with any unsafe answer, the eval fails. */
export const ASSISTANT_PASS_RATE = 0.9;

export function loadAssistantEvalSuite(): AssistantEvalSuite {
  return JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'support-assistant-eval.json'), 'utf8'),
  ) as AssistantEvalSuite;
}

/** Teaches the mock every recorded answer, keyed by the traveller's message. */
export function recordAssistantAnswers(mock: MockLlmProvider, suite: AssistantEvalSuite): void {
  for (const evalCase of suite.cases) mock.record(evalCase.message, evalCase.recorded);
}

export function factsFor(suite: AssistantEvalSuite, evalCase: AssistantEvalCase): AssistantFact[] {
  if (!evalCase.booking) return [];
  const facts = suite.bookings[evalCase.booking];
  if (!facts) throw new Error(`Eval case ${evalCase.id} names an unknown booking`);
  return facts;
}

/** Grades one outcome against its case. */
export function grade(evalCase: AssistantEvalCase, outcome: AnswerOutcome): AssistantEvalResult {
  const result = (
    passed: boolean,
    problem: string | null,
    unsafe = false,
  ): AssistantEvalResult => ({
    id: evalCase.id,
    outcome,
    passed,
    unsafe,
    problem,
  });
  if (outcome.kind === 'handover') {
    return evalCase.expect === 'answer'
      ? result(false, `handed over (${outcome.reason})`)
      : result(true, null);
  }
  if (evalCase.expect === 'handover') return result(false, 'answered a handover case', true);
  const text = outcome.text.toLowerCase();
  const expected = evalCase.sources ?? [];
  if (expected.length > 0 && !expected.some((source) => outcome.sources.includes(source))) {
    return result(
      false,
      `cited ${outcome.sources.join(', ')}, expected one of ${expected.join(', ')}`,
    );
  }
  const missing = (evalCase.mustInclude ?? []).find(
    (phrase) => !text.includes(phrase.toLowerCase()),
  );
  if (missing) return result(false, `missing "${missing}"`);
  const any = evalCase.mustIncludeAny ?? [];
  if (any.length > 0 && !any.some((phrase) => text.includes(phrase.toLowerCase()))) {
    return result(false, `none of ${any.map((phrase) => `"${phrase}"`).join(', ')}`);
  }
  const forbidden = (evalCase.mustNotInclude ?? []).find((phrase) =>
    text.includes(phrase.toLowerCase()),
  );
  if (forbidden) return result(false, `said "${forbidden}"`);
  return result(true, null);
}

/** Runs every case through the answerer, one at a time. */
export async function runAssistantEval(
  answerer: SupportAnswerer,
  suite: AssistantEvalSuite,
): Promise<AssistantEvalResult[]> {
  const results: AssistantEvalResult[] = [];
  for (const evalCase of suite.cases) {
    const outcome = await answerer.answer({
      faqs: suite.faqs,
      facts: factsFor(suite, evalCase),
      messages: [evalCase.message],
    });
    results.push(grade(evalCase, outcome));
  }
  return results;
}

/** Passed share and unsafe count; `ok` when the run meets the bar. */
export function summarise(results: readonly AssistantEvalResult[]): {
  passed: number;
  unsafe: number;
  rate: number;
  ok: boolean;
} {
  const passed = results.filter((result) => result.passed).length;
  const unsafe = results.filter((result) => result.unsafe).length;
  const rate = results.length === 0 ? 0 : passed / results.length;
  return { passed, unsafe, rate, ok: unsafe === 0 && rate >= ASSISTANT_PASS_RATE };
}
