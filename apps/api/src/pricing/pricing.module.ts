import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { FxProvider, MockFxProvider } from './fx';
import { OpenExchangeRatesProvider, OverriddenFxProvider } from './fx-providers';
import { FxService } from './fx.service';
import { PricingService } from './pricing.service';

/** The rate source the settings name, with the owner's fixed rates on top (ADR-091). */
export function fxProviderFor(config: AppConfig): FxProvider {
  const source =
    config.FX_PROVIDER === 'openexchangerates'
      ? new OpenExchangeRatesProvider({
          baseUrl: config.OPENEXCHANGERATES_API_URL,
          appId: config.OPENEXCHANGERATES_APP_ID ?? '',
          timeoutMs: config.FX_TIMEOUT_MS,
        })
      : new MockFxProvider();
  return Object.keys(config.FX_RATE_OVERRIDES).length > 0
    ? new OverriddenFxProvider(source, config.FX_RATE_OVERRIDES)
    : source;
}

@Global()
@Module({
  providers: [
    { provide: FxProvider, inject: [APP_CONFIG], useFactory: fxProviderFor },
    FxService,
    PricingService,
  ],
  exports: [FxService, PricingService],
})
export class PricingModule {}
