import { Module } from '@nestjs/common';

import { SearchModule } from '../search/search.module';

import { InternalPriceAlertsController, PriceAlertsController } from './price-alerts.controller';
import { PriceAlertsService } from './price-alerts.service';

/** Price alerts (phase 9, ADR-032). */
@Module({
  imports: [SearchModule],
  controllers: [PriceAlertsController, InternalPriceAlertsController],
  providers: [PriceAlertsService],
})
export class AlertsModule {}
