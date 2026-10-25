import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { APP_CONFIG, type AppConfig } from '../config/config';

import { AiSearchBudget } from './ai-search-budget';
import { AnthropicLlmProvider } from './anthropic-llm-provider';
import { LlmProvider } from './llm-provider';
import { MockLlmProvider } from './mock-llm-provider';
import { NaturalSearchController } from './natural-search.controller';
import { NaturalSearchService } from './natural-search.service';
import { PlaceResolver } from './place-resolver';

/** AI trip search (phase 13, ADR-061). */
@Module({
  imports: [CatalogModule],
  controllers: [NaturalSearchController],
  providers: [
    NaturalSearchService,
    AiSearchBudget,
    PlaceResolver,
    MockLlmProvider,
    {
      provide: LlmProvider,
      inject: [APP_CONFIG, MockLlmProvider],
      // The env schema refuses `anthropic` without a key and the mock in production.
      useFactory: (config: AppConfig, mock: MockLlmProvider): LlmProvider =>
        config.LLM_PROVIDER === 'anthropic' && config.LLM_API_KEY
          ? new AnthropicLlmProvider({
              apiKey: config.LLM_API_KEY,
              model: config.LLM_MODEL,
              timeoutMs: config.LLM_TIMEOUT_MS,
            })
          : mock,
    },
  ],
  exports: [NaturalSearchService, MockLlmProvider],
})
export class AiSearchModule {}
