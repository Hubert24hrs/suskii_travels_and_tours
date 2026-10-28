/**
 * The after-hours assistant eval (ADR-085): 40 conversations through the whole answering
 * pipeline (scrubbing, the model, validation and the grounding checks), graded by rule. Fails
 * below 90% passed cases or on any answer where only a person may answer. Needs no database.
 *
 *   LLM_PROVIDER=anthropic LLM_API_KEY=... pnpm --filter @suskii/api eval:support-assistant
 *   pnpm --filter @suskii/api eval:support-assistant --recorded    # pipeline only, no model
 *
 * Against the real model it costs a few cents (the summary prints the exact figure).
 */
import { parseArgs } from 'node:util';

import { llmCost } from '../src/ai-search/ai-search-budget';
import { AnthropicLlmProvider } from '../src/ai-search/anthropic-llm-provider';
import {
  LlmProvider,
  NO_USAGE,
  type LlmExtraction,
  type LlmResult,
  type LlmUsage,
} from '../src/ai-search/llm-provider';
import { MockLlmProvider } from '../src/ai-search/mock-llm-provider';
import { loadConfig, loadDevelopmentEnvFile, type AppConfig } from '../src/config/config';
import { SupportAnswerer } from '../src/support/assistant/support-answerer';
import {
  ASSISTANT_PASS_RATE,
  loadAssistantEvalSuite,
  recordAssistantAnswers,
  runAssistantEval,
  summarise,
} from '../test/helpers/support-assistant-eval';

/** Counts tokens and time across calls without changing what the provider does. */
class MeteredProvider extends LlmProvider {
  usage: LlmUsage = { ...NO_USAGE };
  calls = 0;
  milliseconds = 0;

  constructor(private readonly inner: LlmProvider) {
    super();
  }

  get name(): string {
    return this.inner.name;
  }

  async extract(request: LlmExtraction): Promise<LlmResult> {
    const started = performance.now();
    this.calls += 1;
    try {
      const result = await this.inner.extract(request);
      for (const key of Object.keys(this.usage) as (keyof LlmUsage)[]) {
        this.usage[key] += result.usage[key];
      }
      return result;
    } finally {
      this.milliseconds += performance.now() - started;
    }
  }
}

function providerFor(config: AppConfig, recorded: boolean): LlmProvider {
  if (recorded) return new MockLlmProvider();
  if (config.LLM_PROVIDER === 'anthropic' && config.LLM_API_KEY) {
    return new AnthropicLlmProvider({
      apiKey: config.LLM_API_KEY,
      model: config.LLM_MODEL,
      timeoutMs: config.LLM_TIMEOUT_MS,
    });
  }
  throw new Error(
    'Set LLM_PROVIDER=anthropic and LLM_API_KEY to evaluate the model, or pass --recorded to check the pipeline only.',
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { recorded: { type: 'boolean', default: false } } });
  loadDevelopmentEnvFile();
  // The eval opens no database or Redis connection; the settings only have to parse.
  process.env.DATABASE_URL ??= 'postgresql://eval@localhost:5432/unused';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('The eval does not run against production settings.');
  }
  const suite = loadAssistantEvalSuite();
  const inner = providerFor(config, values.recorded);
  if (inner instanceof MockLlmProvider) recordAssistantAnswers(inner, suite);
  const provider = new MeteredProvider(inner);
  const results = await runAssistantEval(new SupportAnswerer(provider), suite);

  for (const result of results) {
    const evalCase = suite.cases.find((candidate) => candidate.id === result.id);
    const outcome =
      result.outcome.kind === 'answer'
        ? `answer [${result.outcome.sources.join(', ')}]`
        : `handover (${result.outcome.reason})`;
    if (result.passed) {
      process.stdout.write(`  ok      ${result.id}: ${outcome}\n`);
      continue;
    }
    process.stdout.write(
      `  ${result.unsafe ? 'UNSAFE' : 'MISS  '}  ${result.id}: ${result.problem ?? ''}\n`,
    );
    process.stdout.write(`          expected ${evalCase?.expect ?? '?'}, got ${outcome}\n`);
    if (result.outcome.kind === 'answer') {
      process.stdout.write(`          answer: ${result.outcome.text}\n`);
    }
  }

  const summary = summarise(results);
  const cost = llmCost(provider.usage, config);
  process.stdout.write(
    [
      '',
      `provider ${provider.name}${values.recorded ? ' (recorded answers)' : ` (${config.LLM_MODEL})`}`,
      `passed ${summary.passed}/${results.length} (${(summary.rate * 100).toFixed(1)}%), pass mark ${ASSISTANT_PASS_RATE * 100}%; unsafe answers ${summary.unsafe} (must be 0)`,
      `tokens: input ${provider.usage.inputTokens}, output ${provider.usage.outputTokens}, cache read ${provider.usage.cacheReadTokens}, cache write ${provider.usage.cacheWriteTokens}`,
      `cost ${cost} micro-dollars ($${(cost / 1_000_000).toFixed(4)}), mean latency ${Math.round(provider.milliseconds / Math.max(provider.calls, 1))} ms`,
      '',
    ].join('\n'),
  );
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
