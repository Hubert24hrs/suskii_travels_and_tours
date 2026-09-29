import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { SuppliersModule } from '../suppliers/suppliers.module';

import { FlightSearchService } from './flight-search.service';
import { FlightsController } from './flights.controller';
import { HotelSearchService } from './hotel-search.service';
import { HotelsController } from './hotels.controller';
import { PromoService } from './promo.service';
import { PromosController } from './promos.controller';
import { SearchLogService } from './search-log.service';
import { SearchStore } from './search-store';
import { SupplierRunner } from './supplier-runner';

@Module({
  imports: [AuthModule, CatalogModule, SuppliersModule],
  controllers: [FlightsController, HotelsController, PromosController],
  providers: [
    FlightSearchService,
    HotelSearchService,
    PromoService,
    SearchLogService,
    SearchStore,
    SupplierRunner,
  ],
  exports: [FlightSearchService, HotelSearchService, SupplierRunner],
})
export class SearchModule {}
