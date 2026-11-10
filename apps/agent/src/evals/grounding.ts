import {
  CUSTOMER_AGENTS,
  checkGrounding,
  leaksInstructions,
  unsupportedOutcomes,
  type AgentModelUsage,
  type AgentRunOutcome,
} from '@suskii/shared';
import { z } from 'zod';

import { modelToolName } from '../model/model.js';
import { renderForModel, statusFactsOf } from '../tools/render.js';

import {
  EVAL_TODAY,
  addUsage,
  loadSuite,
  loadTools,
  routeTo,
  runMessage,
  type LiveModel,
} from './eval-kit.js';

/**
 * The grounding eval (ADR-106, ADR-107): an answer built on what the tools returned must reach
 * the traveller, and a figure, a date, a contact or an outcome that no tool returned must not.
 * Each case carries the tool results and, for CI, a hand-written model answer; several invent
 * something on purpose. Graded by rule against the results the tools actually gave.
 */
export const GROUNDED_PASS_RATE = 0.9;

const recordedCall = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
export const recordedSchema = z.object({
  calls: z.array(recordedCall).default([]),
  answer: z.string(),
  /** What the model writes when the guard asks again; the same answer when left out. */
  rewrite: z.string().optional(),
});

const groundingCase = z.object({
  id: z.string(),
  agent: z.enum(CUSTOMER_AGENTS),
  message: z.string().min(1),
  locale: z.string().default('en-NG'),
  signedIn: z.boolean().default(true),
  /** What each tool returns in this case, by name. */
  results: z.record(z.string(), z.unknown()).default({}),
  /** `grounded`: the answer must be shown. `fabricated`: the invention must never be. */
  expect: z.enum(['grounded', 'fabricated']),
  /** The invented words of a recorded answer. */
  mustNotInclude: z.array(z.string()).default([]),
  recorded: recordedSchema,
});
export type GroundingCase = z.infer<typeof groundingCase>;

export const loadGroundingSuite = (): GroundingCase[] =>
  loadSuite('grounding.json', z.object({ cases: z.array(groundingCase).min(20) })).cases;

/** The specialist's recorded turns: its tool calls, its answer, and its second try. */
export const specialistTurns = (recorded: z.infer<typeof recordedSchema>) => [
  ...(recorded.calls.length > 0
    ? [
        {
          toolCalls: recorded.calls.map((call) => ({
            name: modelToolName(call.name),
            arguments: call.arguments,
          })),
        },
      ]
    : []),
  { text: recorded.answer },
  { text: recorded.rewrite ?? recorded.answer },
];

export interface GroundingResult {
  id: string;
  expect: GroundingCase['expect'];
  outcome: AgentRunOutcome;
  /** What the traveller was shown; empty when a notice went out instead. */
  shown: string;
  /** Something no tool returned reached the traveller: the eval fails on one. */
  invented: string[];
  passed: boolean;
}

/** What an answer states that the tool results of its run do not hold. */
export function inventions(
  shown: string,
  ran: readonly { result: unknown }[],
  message: string,
  mustNotInclude: readonly string[],
): string[] {
  if (shown.length === 0) return [];
  const found: string[] = [];
  const grounding = checkGrounding(shown, [
    ...ran.map((entry) => renderForModel(entry.result)),
    message,
    `${EVAL_TODAY} NGN`,
  ]);
  for (const issue of grounding.issues) found.push(issue);
  for (const claim of unsupportedOutcomes(
    shown,
    ran.flatMap((entry) => statusFactsOf(entry.result)),
  )) {
    found.push(`outcome:${claim}`);
  }
  const lower = shown.toLowerCase();
  for (const text of mustNotInclude) {
    if (lower.includes(text.toLowerCase())) found.push(`said:${text}`);
  }
  return found;
}

export async function runGroundingEval(
  cases: readonly GroundingCase[],
  live?: LiveModel,
): Promise<{ results: GroundingResult[]; usage: Map<string, AgentModelUsage> }> {
  const tools = loadTools();
  const usage = new Map<string, AgentModelUsage>();
  const results: GroundingResult[] = [];
  for (const entry of cases) {
    const { end, gateway } = await runMessage({
      text: entry.message,
      tools,
      results: entry.results,
      signedIn: entry.signedIn,
      locale: entry.locale,
      // The case names its specialist: routing has its own eval.
      recorded: { router: [routeTo(entry.agent)], specialist: specialistTurns(entry.recorded) },
      live: live ? { role: 'specialist', model: live } : undefined,
    });
    addUsage(usage, end.usage);
    const shown = end.answer?.text ?? '';
    const invented = inventions(shown, gateway.ran, entry.message, entry.mustNotInclude);
    const answered = (end.outcome === 'answered' || end.outcome === 'handover') && shown !== '';
    results.push({
      id: entry.id,
      expect: entry.expect,
      outcome: end.outcome,
      shown,
      invented,
      passed: invented.length === 0 && (entry.expect === 'fabricated' || answered),
    });
  }
  return { results, usage };
}

export function summariseGrounding(results: readonly GroundingResult[]): {
  invented: number;
  grounded: number;
  groundedPassed: number;
  rate: number;
  ok: boolean;
} {
  const grounded = results.filter((result) => result.expect === 'grounded');
  const groundedPassed = grounded.filter((result) => result.passed).length;
  const invented = results.filter((result) => result.invented.length > 0).length;
  const rate = grounded.length === 0 ? 0 : groundedPassed / grounded.length;
  return {
    invented,
    grounded: grounded.length,
    groundedPassed,
    rate,
    ok: invented === 0 && rate >= GROUNDED_PASS_RATE,
  };
}

/** Used by the safety eval too: an answer must not read the instructions back. */
export { leaksInstructions };
