/**
 * The AI trip search eval (ADR-061): 50 messages through the whole pipeline (scrubbing, the
 * model, validation, catalog resolution), compared field by field with the expected form. Fails
 * below 95% exact matches. Needs the API's database (seeded reference data) and Redis.
 *
 *   LLM_PROVIDER=anthropic LLM_API_KEY=... pnpm --filter @suskii/api eval:natural-search
 *   pnpm --filter @suskii/api eval:natural-search --recorded    # pipeline only, no model
 *
 * Against the real model it costs about a cent (the summary prints the exact figure).
 */
import { parseArgs } from 'node:util';

import { Redis } from 'ioredis';

import type { NaturalSearchResult } from '@suskii/shared';

import { AiSearchBudget } from '../src/ai-search/ai-search-budget';
import { AnthropicLlmProvider } from '../src/ai-search/anthropic-llm-provider';
import {
  LlmProvider,
  NO_USAGE,
  type LlmExtraction,
  type LlmResult,
  type LlmUsage,
} from '../src/ai-search/llm-provider';
import { MockLlmProvider } from '../src/ai-search/mock-llm-provider';
import { NaturalSearchService } from '../src/ai-search/natural-search.service';
import { PlaceResolver } from '../src/ai-search/place-resolver';
import { CatalogService } from '../src/catalog/catalog.service';
import { ProblemDetailsException } from '../src/common/problem-details';
import { loadConfig, loadDevelopmentEnvFile, type AppConfig } from '../src/config/config';
import { HmacService } from '../src/crypto/hmac.service';
import { PrismaService } from '../src/infra/prisma.service';
import { redisTls } from '../src/infra/redis-options';
import {
  actualStruct,
  expectedStruct,
  loadEvalSuite,
  mismatches,
  recordedAnswer,
} from '../test/helpers/natural-search-eval';

const PASS_RATE = 0.95;

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
  const config: AppConfig = { ...loadConfig(), AI_SEARCH_ENABLED: true };
  if (config.NODE_ENV === 'production') {
    throw new Error('The eval does not run against production; use a development database.');
  }
  const suite = loadEvalSuite();
  const inner = providerFor(config, values.recorded);
  if (inner instanceof MockLlmProvider) {
    for (const evalCase of suite.cases)
      inner.record(evalCase.query, recordedAnswer(suite, evalCase));
  }
  const provider = new MeteredProvider(inner);
  const prisma = new PrismaService(config);
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    ...redisTls(config),
  });
  const budget = new AiSearchBudget(redis, config);
  const search = new NaturalSearchService(
    config,
    provider,
    budget,
    new PlaceResolver(new CatalogService(prisma)),
    new HmacService(config),
  );

  let passed = 0;
  try {
    for (const evalCase of suite.cases) {
      let result: NaturalSearchResult | null = null;
      let error = '';
      try {
        result = await search.parse(
          { text: evalCase.query, timeZone: suite.timeZone },
          { userId: `eval:${evalCase.id}`, ip: '127.0.0.1' },
          new Date(suite.now),
        );
      } catch (caught) {
        if (
          caught instanceof ProblemDetailsException &&
          caught.slug === 'ai-search-not-understood'
        ) {
          result = null;
        } else {
          error =
            caught instanceof ProblemDetailsException ? caught.slug : (caught as Error).message;
        }
      }
      const expected = expectedStruct(evalCase);
      const actual = actualStruct(result);
      const fields = error ? ['error'] : mismatches(expected, actual);
      if (fields.length === 0) {
        passed += 1;
        process.stdout.write(`  ok    ${evalCase.id}\n`);
        continue;
      }
      process.stdout.write(`  MISS  ${evalCase.id}: ${evalCase.query}\n`);
      if (error) process.stdout.write(`        error ${error}\n`);
      for (const field of fields.filter((name) => name !== 'error')) {
        const want = JSON.stringify((expected as Record<string, unknown>)[field]);
        const got = JSON.stringify((actual as Record<string, unknown>)[field]);
        process.stdout.write(`        ${field}: expected ${want}, got ${got}\n`);
      }
    }
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }

  const total = suite.cases.length;
  const rate = passed / total;
  const cost = budget.cost(provider.usage);
  process.stdout.write(
    [
      '',
      `provider ${provider.name}${values.recorded ? ' (recorded answers)' : ` (${config.LLM_MODEL})`}`,
      `exact matches ${passed}/${total} (${(rate * 100).toFixed(1)}%), pass mark ${PASS_RATE * 100}%`,
      `tokens: input ${provider.usage.inputTokens}, output ${provider.usage.outputTokens}, cache read ${provider.usage.cacheReadTokens}, cache write ${provider.usage.cacheWriteTokens}`,
      `cost ${cost} micro-dollars ($${(cost / 1_000_000).toFixed(4)}), mean latency ${Math.round(provider.milliseconds / Math.max(provider.calls, 1))} ms`,
      '',
    ].join('\n'),
  );
  if (rate < PASS_RATE) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
