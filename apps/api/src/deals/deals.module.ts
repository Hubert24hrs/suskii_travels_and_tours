import { Module } from '@nestjs/common';

import { SearchModule } from '../search/search.module';

import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { DestinationsController } from './destinations.controller';
import { DestinationsService } from './destinations.service';
import { RouteFactsService } from './route-facts.service';
import { InternalRefreshController } from './internal-refresh.controller';

@Module({
  imports: [SearchModule],
  controllers: [DealsController, DestinationsController, InternalRefreshController],
  providers: [DealsService, DestinationsService, RouteFactsService],
  // The assistant reads a route's fare history through the service (ADR-101).
  exports: [DealsService],
})
export class DealsModule {}
