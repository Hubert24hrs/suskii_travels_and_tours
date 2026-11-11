import { Module } from '@nestjs/common';

import type { ScrapeVendor } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { DocumentsModule } from '../documents/documents.module';

import { AdminPriceIntelController } from './admin-price-intel.controller';
import { DomainThrottle } from './domain-throttle';
import { InternalPriceIntelController } from './internal-price-intel.controller';
import { PriceIntelAdminService } from './price-intel-admin.service';
import { PriceIntelAlerts } from './price-intel-alerts';
import { PriceIntelBudget } from './price-intel-budget';
import { PriceIntelDrift } from './price-intel-drift';
import { PriceIntelSwitches } from './price-intel-switches';
import { PriceIntelService } from './price-intel.service';
import { PriceSourcesService } from './price-sources.service';
import { ProviderRouter } from './provider-router';
import { ApifyScrapeProvider } from './providers/apify-scrape-provider';
import { BrightDataScrapeProvider } from './providers/bright-data-scrape-provider';
import { BrowseAiScrapeProvider } from './providers/browse-ai-scrape-provider';
import { DirectScrapeProvider } from './providers/direct-scrape-provider';
import { FirecrawlScrapeProvider } from './providers/firecrawl-scrape-provider';
import { MockScrapeProvider } from './providers/mock-scrape-provider';
import { OxylabsScrapeProvider } from './providers/oxylabs-scrape-provider';
import { ScrapeBreakers } from './scrape-breakers';
import { ScrapeHealthBoard } from './scrape-health';
import type { ScrapeProvider } from './scrape-provider';
import { SCRAPE_PROVIDERS, type ScrapeProviders } from './scrape-providers';

/**
 * The vendors `PRICE_INTEL_VENDORS` names, each with its key from the environment. The env
 * schema already refused a vendor without its key, and the mock in production.
 */
function enabledProviders(config: AppConfig, mock: MockScrapeProvider): ScrapeProviders {
  const costs = config.PRICE_INTEL_COSTS;
  const build: Record<ScrapeVendor, () => ScrapeProvider | null> = {
    mock: () => mock,
    direct: () => new DirectScrapeProvider({ botUrl: config.PRICE_INTEL_BOT_URL }),
    firecrawl: () =>
      config.FIRECRAWL_API_KEY
        ? new FirecrawlScrapeProvider({ apiKey: config.FIRECRAWL_API_KEY, costs: costs.firecrawl })
        : null,
    apify: () =>
      config.APIFY_TOKEN
        ? new ApifyScrapeProvider({ token: config.APIFY_TOKEN, costs: costs.apify })
        : null,
    browse_ai: () =>
      config.BROWSE_AI_API_KEY
        ? new BrowseAiScrapeProvider({ apiKey: config.BROWSE_AI_API_KEY, costs: costs.browse_ai })
        : null,
    oxylabs: () =>
      config.OXYLABS_USERNAME && config.OXYLABS_PASSWORD
        ? new OxylabsScrapeProvider({
            username: config.OXYLABS_USERNAME,
            password: config.OXYLABS_PASSWORD,
            costs: costs.oxylabs,
          })
        : null,
    bright_data: () =>
      config.BRIGHT_DATA_API_KEY && config.BRIGHT_DATA_ZONE
        ? new BrightDataScrapeProvider({
            apiKey: config.BRIGHT_DATA_API_KEY,
            zone: config.BRIGHT_DATA_ZONE,
            costs: costs.bright_data,
          })
        : null,
  };
  const providers = new Map<ScrapeVendor, ScrapeProvider>();
  for (const vendor of config.PRICE_INTEL_VENDORS) {
    const provider = build[vendor]();
    if (provider) providers.set(vendor, provider);
  }
  return providers;
}

/**
 * Price intelligence (ADR-102): a supplier-style module of the API. It holds the vendor keys;
 * the agent service holds none and reaches prices only through tools. Search, booking and
 * payment do not import it.
 */
@Module({
  imports: [DocumentsModule],
  controllers: [AdminPriceIntelController, InternalPriceIntelController],
  providers: [
    MockScrapeProvider,
    {
      provide: SCRAPE_PROVIDERS,
      inject: [APP_CONFIG, MockScrapeProvider],
      useFactory: enabledProviders,
    },
    PriceIntelSwitches,
    ScrapeBreakers,
    DomainThrottle,
    PriceIntelBudget,
    ScrapeHealthBoard,
    PriceIntelDrift,
    PriceIntelAlerts,
    ProviderRouter,
    PriceSourcesService,
    PriceIntelService,
    PriceIntelAdminService,
  ],
  exports: [PriceIntelService, PriceSourcesService, PriceIntelAdminService, MockScrapeProvider],
})
export class PriceIntelModule {}
