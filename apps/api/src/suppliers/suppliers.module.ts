import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { APP_CONFIG, type AppConfig } from '../config/config';

import { CircuitBreakerRegistry } from './circuit-breaker';
import { DuffelFlightSupplier } from './duffel/duffel-flight-supplier';
import { DuffelClient } from './duffel/duffel.client';
import { MockFlightSupplier } from './mock/mock-flight-supplier';
import { MockHotelSupplier } from './mock/mock-hotel-supplier';
import type { FlightSupplier, HotelSupplier } from './supplier.types';

/** The enabled flight suppliers, in FLIGHT_SUPPLIERS order. */
export const FLIGHT_SUPPLIERS = Symbol('FLIGHT_SUPPLIERS');
/** The enabled hotel suppliers, in HOTEL_SUPPLIERS order. */
export const HOTEL_SUPPLIERS = Symbol('HOTEL_SUPPLIERS');

@Module({
  imports: [CatalogModule],
  providers: [
    // A factory, not a value: each application instance gets its own breakers.
    { provide: CircuitBreakerRegistry, useFactory: () => new CircuitBreakerRegistry() },
    {
      provide: MockFlightSupplier,
      inject: [CatalogService, APP_CONFIG],
      useFactory: (catalog: CatalogService, config: AppConfig) =>
        new MockFlightSupplier(catalog, undefined, config.MOCK_REPRICE_RULES),
    },
    { provide: MockHotelSupplier, useFactory: () => new MockHotelSupplier() },
    {
      provide: FLIGHT_SUPPLIERS,
      inject: [APP_CONFIG, MockFlightSupplier],
      useFactory: (config: AppConfig, mock: MockFlightSupplier): FlightSupplier[] =>
        config.FLIGHT_SUPPLIERS.map((name) => {
          if (name === 'mock') return mock;
          // The env schema guarantees a token when duffel is enabled.
          const client = new DuffelClient({
            baseUrl: config.DUFFEL_API_URL,
            token: config.DUFFEL_API_TOKEN ?? '',
          });
          return new DuffelFlightSupplier(client, config.SUPPLIER_TIMEOUT_MS);
        }),
    },
    {
      provide: HOTEL_SUPPLIERS,
      inject: [APP_CONFIG, MockHotelSupplier],
      useFactory: (config: AppConfig, mock: MockHotelSupplier): HotelSupplier[] =>
        config.HOTEL_SUPPLIERS.map(() => mock),
    },
  ],
  exports: [
    FLIGHT_SUPPLIERS,
    HOTEL_SUPPLIERS,
    CircuitBreakerRegistry,
    MockFlightSupplier,
    MockHotelSupplier,
  ],
})
export class SuppliersModule {}
