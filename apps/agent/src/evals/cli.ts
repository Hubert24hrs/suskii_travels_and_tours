/**
 * The agent evals from the command line (ADR-106):
 *
 *   pnpm --filter @suskii/agent eval:agent-routing   [--recorded]
 *   pnpm --filter @suskii/agent eval:agent-grounding [--recorded]
 *   pnpm --filter @suskii/agent eval:agent-safety    [--recorded]
 *
 * `--json <file>` also writes the result as the console takes it (Assistant cost and quality,
 * Evaluations): counts, the ids of the cases that did not pass, the models and, with
 * `--commit <sha>` or GITHUB_SHA, the commit. Never a message or an answer.
 *
 * With `--recorded` the model turns come from the fixtures: the graph, the guard and the grader
 * are checked and no model is called (CI runs this as unit tests). Without it the configured
 * model plays the part under evaluation: set LLM_API_KEY, and AGENT_MODEL_ROUTER or
 * AGENT_MODEL_SPECIALIST to try another model. A real run costs a few cents; the summary prints
 * the tokens used, priced by AGENT_MODEL_PRICES in the API's settings. No eval reaches the API,
 * a database or a traveller's data: tool results are fixtures.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { agentEvalResultSchema, type AgentEvalResult, type AgentModelUsage } from '@suskii/shared';
import { z } from 'zod';

import { AnthropicAgentModel } from '../model/anthropic-model.js';

import { percent, type LiveModel } from './eval-kit.js';
import {
  GROUNDED_PASS_RATE,
  loadGroundingSuite,
  runGroundingEval,
  summariseGrounding,
} from './grounding.js';
import {
  loadRoutingSuite,
  ROUTING_PASS_RATE,
  runRoutingEval,
  summariseRouting,
} from './routing.js';
import { loadSafetySuite, runSafetyEval, summariseSafety } from './safety.js';

const SUITES = ['routing', 'grounding', 'safety'] as const;
type Suite = (typeof SUITES)[number];

const settings = z.object({
  LLM_API_KEY: z.string().min(1).optional(),
  AGENT_MODEL_ROUTER: z.string().min(1).default('claude-haiku-5-5'),
  AGENT_MODEL_SPECIALIST: z.string().min(1).default('claude-sonnet-5-5'),
  AGENT_MODEL_FALLBACK: z.string().min(1).default('claude-haiku-5-5'),
  AGENT_MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(45_000),
});

const out = (line = ''): void => void process.stdout.write(`${line}\n`);

function liveModel(): LiveModel {
  const env = settings.parse(process.env);
  if (!env.LLM_API_KEY) {
    throw new Error(
      'Set LLM_API_KEY to evaluate the model, or pass --recorded to check the pipeline only.',
    );
  }
  return {
    model: new AnthropicAgentModel({
      apiKey: env.LLM_API_KEY,
      timeoutMs: env.AGENT_MODEL_TIMEOUT_MS,
    }),
    names: {
      router: env.AGENT_MODEL_ROUTER,
      specialist: env.AGENT_MODEL_SPECIALIST,
      fallback: env.AGENT_MODEL_FALLBACK,
    },
  };
}

function printUsage(usage: Map<string, AgentModelUsage>, recorded: boolean): void {
  if (recorded) {
    out('model: recorded answers (no model was called)');
    return;
  }
  for (const [name, line] of usage) {
    out(
      `model ${name}: ${line.calls} calls, input ${line.inputTokens}, output ${line.outputTokens}, cache read ${line.cacheReadTokens}, cache write ${line.cacheWriteTokens} tokens`,
    );
  }
}

/** What a suite came to: whether it passed, and what the console is told of it. */
type Outcome = Pick<AgentEvalResult, 'passed' | 'cases' | 'held' | 'figures' | 'failed'>;

async function routing(live: LiveModel | undefined): Promise<Outcome> {
  const cases = loadRoutingSuite();
  const { results, usage } = await runRoutingEval(cases, live);
  for (const result of results) {
    out(
      result.passed
        ? `  ok    ${result.id}: ${result.agent}${result.byRule ? ' (by rule)' : ''}`
        : `  MISS  ${result.id}: got ${result.agent}, expected ${result.expect.join(' or ')}: ${result.message}`,
    );
  }
  const summary = summariseRouting(results);
  out();
  printUsage(usage, !live);
  out(
    `routed ${summary.passed}/${results.length} (${percent(summary.rate)}), pass mark ${percent(ROUTING_PASS_RATE)}; ${summary.byRule} by rule without a model call`,
  );
  return {
    passed: summary.ok,
    cases: results.length,
    held: summary.passed,
    figures: {
      routed: summary.passed,
      byRule: summary.byRule,
      passMarkPercent: Math.round(ROUTING_PASS_RATE * 100),
    },
    failed: results.filter((result) => !result.passed).map((result) => result.id),
  };
}

async function grounding(live: LiveModel | undefined): Promise<Outcome> {
  const cases = loadGroundingSuite();
  const { results, usage } = await runGroundingEval(cases, live);
  for (const result of results) {
    if (result.invented.length > 0) {
      out(`  INVENTED  ${result.id}: ${result.invented.join(', ')}`);
      out(`            shown: ${result.shown}`);
    } else if (!result.passed) {
      out(`  MISS      ${result.id}: a grounded answer was not shown (${result.outcome})`);
    } else {
      out(`  ok        ${result.id}: ${result.expect}, ${result.outcome}`);
    }
  }
  const summary = summariseGrounding(results);
  out();
  printUsage(usage, !live);
  out(
    `inventions shown ${summary.invented} (must be 0); grounded answers shown ${summary.groundedPassed}/${summary.grounded} (${percent(summary.rate)}), pass mark ${percent(GROUNDED_PASS_RATE)}`,
  );
  // A case passes when nothing invented was shown and, if it was grounded, its answer was.
  const failed = results.filter((result) => result.invented.length > 0 || !result.passed);
  return {
    passed: summary.ok,
    cases: results.length,
    held: results.length - failed.length,
    figures: {
      inventionsShown: summary.invented,
      grounded: summary.grounded,
      groundedShown: summary.groundedPassed,
      passMarkPercent: Math.round(GROUNDED_PASS_RATE * 100),
    },
    failed: failed.map((result) => result.id),
  };
}

async function safety(live: LiveModel | undefined): Promise<Outcome> {
  const cases = loadSafetySuite();
  const { results, usage } = await runSafetyEval(cases, live);
  for (const result of results) {
    if (result.violations.length > 0) {
      out(`  VIOLATION  ${result.id} (${result.kind}): ${result.violations.join(', ')}`);
      out(`             shown: ${result.shown}`);
    } else {
      const tried = result.refused.length > 0 ? `; refused ${result.refused.join(', ')}` : '';
      out(`  held       ${result.id} (${result.kind}): ${result.outcome}${tried}`);
    }
  }
  const summary = summariseSafety(results);
  out();
  printUsage(usage, !live);
  out(`held ${summary.held}/${results.length}; violations ${summary.violations} (must be 0)`);
  return {
    passed: summary.ok,
    cases: results.length,
    held: summary.held,
    figures: { violations: summary.violations },
    failed: results.filter((result) => result.violations.length > 0).map((result) => result.id),
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      recorded: { type: 'boolean', default: false },
      json: { type: 'string' },
      commit: { type: 'string' },
    },
    allowPositionals: true,
  });
  const suite = positionals[0];
  if (!(SUITES as readonly string[]).includes(suite ?? '')) {
    throw new Error(`Name the eval to run: ${SUITES.join(', ')}.`);
  }
  const live = values.recorded ? undefined : liveModel();
  const run: Record<Suite, (model: LiveModel | undefined) => Promise<Outcome>> = {
    routing,
    grounding,
    safety,
  };
  out(`agent ${suite ?? ''} eval`);
  const outcome = await run[suite as Suite](live);
  if (values.json) {
    // The part a suite puts under evaluation: the router for routing, the specialist otherwise.
    const models = live ? [suite === 'routing' ? live.names.router : live.names.specialist] : [];
    const result = agentEvalResultSchema.parse({
      suite,
      mode: live ? 'live' : 'recorded',
      ...outcome,
      models,
      commit: (values.commit ?? process.env.GITHUB_SHA ?? '').toLowerCase() || null,
      ranAt: new Date().toISOString(),
    });
    writeFileSync(values.json, `${JSON.stringify(result, null, 2)}\n`);
    out(`result written to ${values.json}`);
  }
  out(outcome.passed ? 'PASSED' : 'FAILED');
  process.exitCode = outcome.passed ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'the eval failed'}\n`);
  process.exitCode = 1;
});
