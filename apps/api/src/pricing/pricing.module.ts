import { Global, Module } from '@nestjs/common';

import { FxProvider, MockFxProvider } from './fx';
import { FxService } from './fx.service';
import { PricingService } from './pricing.service';

@Global()
@Module({
  providers: [
    // The only FX adapter until the owner chooses a rate source (FX_PROVIDER accepts 'mock').
    { provide: FxProvider, useClass: MockFxProvider },
    FxService,
    PricingService,
  ],
  exports: [FxService, PricingService],
})
export class PricingModule {}
