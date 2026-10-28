import { Module } from '@nestjs/common';

import type { Redis } from 'ioredis';

import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { REDIS } from '../infra/redis';

import { markBreakerOpen } from './breaker-marks';
import { CircuitBreakerRegistry, DEFAULT_BREAKER_OPTIONS } from './circuit-breaker';
import { DuffelFlightSupplier } from './duffel/duffel-flight-supplier';
import { DuffelHotelSupplier } from './duffel/duffel-hotel-supplier';
import { DuffelClient } from './duffel/duffel.client';
import { ExpediaHotelSupplier } from './expedia/expedia-hotel-supplier';
import { ExpediaClient } from './expedia/expedia.client';
import { HotelbedsHotelSupplier } from './hotelbeds/hotelbeds-hotel-supplier';
import { HotelbedsClient } from './hotelbeds/hotelbeds.client';
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
    // A factory, not a value: each application instance gets its own breakers. Openings are
    // marked in Redis so the status page sees every instance's (ADR-087).
    {
      provide: CircuitBreakerRegistry,
      inject: [REDIS],
      useFactory: (redis: Redis) =>
        new CircuitBreakerRegistry(DEFAULT_BREAKER_OPTIONS, (name) => markBreakerOpen(redis, name)),
    },
    {
      provide: MockFlightSupplier,
      inject: [CatalogService, APP_CONFIG],
      useFactory: (catalog: CatalogService, config: AppConfig) =>
        new MockFlightSupplier(
          catalog,
          undefined,
          config.MOCK_REPRICE_RULES,
          config.MOCK_SCHEDULE_CHANGE_RULES,
        ),
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
        config.HOTEL_SUPPLIERS.map((name) => {
          if (name === 'mock') return mock;
          if (name === 'hotelbeds') {
            // The env schema guarantees a key and secret when hotelbeds is enabled.
            return new HotelbedsHotelSupplier(
              new HotelbedsClient({
                baseUrl: config.HOTELBEDS_API_URL,
                apiKey: config.HOTELBEDS_API_KEY ?? '',
                secret: config.HOTELBEDS_API_SECRET ?? '',
              }),
              config.HOTELBEDS_SEARCH_RADIUS_KM,
            );
          }
          if (name === 'expedia') {
            // The env schema guarantees a key and shared secret when expedia is enabled.
            return new ExpediaHotelSupplier(
              new ExpediaClient({
                baseUrl: config.EXPEDIA_RAPID_API_URL,
                apiKey: config.EXPEDIA_RAPID_API_KEY ?? '',
                sharedSecret: config.EXPEDIA_RAPID_SHARED_SECRET ?? '',
              }),
              {
                pointOfSale: config.EXPEDIA_POINT_OF_SALE,
                requestCurrency: config.EXPEDIA_REQUEST_CURRENCY,
                radiusKm: config.EXPEDIA_SEARCH_RADIUS_KM,
                maxProperties: config.EXPEDIA_MAX_PROPERTIES,
                ratesPerProperty: config.EXPEDIA_RATES_PER_PROPERTY,
              },
            );
          }
          // The env schema guarantees a token when duffel is enabled.
          return new DuffelHotelSupplier(
            new DuffelClient({
              baseUrl: config.DUFFEL_API_URL,
              token: config.DUFFEL_API_TOKEN ?? '',
            }),
          );
        }),
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
