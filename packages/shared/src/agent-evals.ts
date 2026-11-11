import { z } from './zod-setup';

/**
 * What an agent eval reports (ADR-106): which suite ran, against recorded answers or a model,
 * whether it passed, and its figures. The eval command writes one with `--json`, and the
 * console keeps the ones staff record, so "was this model measured, and when" has an answer
 * outside CI. It holds counts, case ids and model names: never a message, an answer or a
 * prompt.
 */
export const AGENT_EVAL_SUITES = ['routing', 'grounding', 'safety'] as const;
export type AgentEvalSuite = (typeof AGENT_EVAL_SUITES)[number];

/** `recorded`: the graph, the guard and the grader on recorded answers. `live`: a model. */
export const AGENT_EVAL_MODES = ['recorded', 'live'] as const;
export type AgentEvalMode = (typeof AGENT_EVAL_MODES)[number];

/** The figures each suite reports, so a reader knows what a number is. */
export const AGENT_EVAL_FIGURES = {
  routing: ['routed', 'byRule', 'passMarkPercent'],
  grounding: ['inventionsShown', 'grounded', 'groundedShown', 'passMarkPercent'],
  safety: ['violations'],
} as const satisfies Record<AgentEvalSuite, readonly string[]>;

const count = z.number().int().min(0).max(1_000_000);

export const agentEvalResultSchema = z
  .object({
    suite: z.enum(AGENT_EVAL_SUITES),
    mode: z.enum(AGENT_EVAL_MODES),
    passed: z.boolean(),
    /** Cases in the suite, and how many of them passed. */
    cases: z.number().int().min(1).max(10_000),
    held: count,
    figures: z.record(z.string().regex(/^[a-z][A-Za-z]{0,39}$/), count),
    /** The ids of the cases that did not pass. */
    failed: z
      .array(z.string().regex(/^[a-z]\d{1,4}$/))
      .max(200)
      .default([]),
    /** The models under evaluation; none for recorded answers. */
    models: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9.-]{2,63}$/))
      .max(4)
      .default([]),
    /** The commit the eval ran on, when the command was told. */
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .nullable()
      .default(null),
    ranAt: z.iso.datetime(),
  })
  .superRefine((result, context) => {
    const known: readonly string[] = AGENT_EVAL_FIGURES[result.suite];
    for (const name of Object.keys(result.figures)) {
      if (!known.includes(name)) {
        context.addIssue({ code: 'custom', path: ['figures', name], message: 'unknown figure' });
      }
    }
    for (const name of known) {
      if (!(name in result.figures)) {
        context.addIssue({ code: 'custom', path: ['figures', name], message: 'missing figure' });
      }
    }
    if (result.held > result.cases) {
      context.addIssue({ code: 'custom', path: ['held'], message: 'more than the cases' });
    }
    if ((result.mode === 'live') !== result.models.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['models'],
        message: 'a live run names its models, and a recorded run has none',
      });
    }
  });
export type AgentEvalResult = z.infer<typeof agentEvalResultSchema>;
