/**
 * The agent evals from the command line (ADR-106):
 *
 *   pnpm --filter @suskii/agent eval:agent-routing   [--recorded]
 *   pnpm --filter @suskii/agent eval:agent-grounding [--recorded]
 *   pnpm --filter @suskii/agent eval:agent-safety    [--recorded]
 *
 * With `--recorded` the model turns come from the fixtures: the graph, the guard and the grader
 * are checked and no model is called (CI runs this as unit tests). Without it the configured
 * model plays the part under evaluation: set LLM_API_KEY, and AGENT_MODEL_ROUTER or
 * AGENT_MODEL_SPECIALIST to try another model. A real run costs a few cents; the summary prints
 * the tokens used, priced by AGENT_MODEL_PRICES in the API's settings. No eval reaches the API,
 * a database or a traveller's data: tool results are fixtures.
 */
import { parseArgs } from 'node:util';

import type { AgentModelUsage } from '@suskii/shared';
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

async function routing(live: LiveModel | undefined): Promise<boolean> {
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
  return summary.ok;
}

async function grounding(live: LiveModel | undefined): Promise<boolean> {
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
  return summary.ok;
}

async function safety(live: LiveModel | undefined): Promise<boolean> {
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
  return summary.ok;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { recorded: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const suite = positionals[0];
  if (!(SUITES as readonly string[]).includes(suite ?? '')) {
    throw new Error(`Name the eval to run: ${SUITES.join(', ')}.`);
  }
  const live = values.recorded ? undefined : liveModel();
  const run: Record<Suite, (model: LiveModel | undefined) => Promise<boolean>> = {
    routing,
    grounding,
    safety,
  };
  out(`agent ${suite ?? ''} eval`);
  const ok = await run[suite as Suite](live);
  out(ok ? 'PASSED' : 'FAILED');
  process.exitCode = ok ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'the eval failed'}\n`);
  process.exitCode = 1;
});
