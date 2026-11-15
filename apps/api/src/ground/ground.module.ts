import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { CarsFeaturesController } from './cars-features.controller';
import { CarsFeatureGuard, CarsFlags } from './cars-flags';
import { KycProvider, MockKycProvider } from './kyc';
import { GoogleRoutesMapsProvider } from './google-routes';
import { MapsProvider, MockMapsProvider, OsrmMapsProvider, RoutingService } from './maps';
import { MockPayoutProvider, PayoutProvider } from './payouts';
import { TicketSigner } from './ticket-signer';

/**
 * Shared Cars infrastructure (ADR-049): product flags, ticket signing and the external-system
 * adapters (maps, KYC, payouts), each behind an abstract class with a mock implementation.
 */
@Global()
@Module({
  controllers: [CarsFeaturesController],
  providers: [
    CarsFlags,
    CarsFeatureGuard,
    TicketSigner,
    RoutingService,
    MockMapsProvider,
    MockKycProvider,
    MockPayoutProvider,
    {
      provide: MapsProvider,
      inject: [APP_CONFIG, MockMapsProvider],
      useFactory: (config: AppConfig, mock: MockMapsProvider): MapsProvider => {
        if (config.MAPS_PROVIDER === 'osrm' && config.OSRM_URL) {
          return new OsrmMapsProvider(config.OSRM_URL, config.MAPS_TIMEOUT_MS);
        }
        if (config.MAPS_PROVIDER === 'google' && config.GOOGLE_MAPS_SERVER_KEY) {
          return new GoogleRoutesMapsProvider({
            baseUrl: config.GOOGLE_ROUTES_API_URL,
            apiKey: config.GOOGLE_MAPS_SERVER_KEY,
            timeoutMs: config.MAPS_TIMEOUT_MS,
          });
        }
        return mock;
      },
    },
    // KYC_PROVIDER and PAYOUT_PROVIDER only accept `mock` until the owner picks providers.
    { provide: KycProvider, useExisting: MockKycProvider },
    { provide: PayoutProvider, useExisting: MockPayoutProvider },
  ],
  exports: [
    CarsFlags,
    CarsFeatureGuard,
    TicketSigner,
    RoutingService,
    MapsProvider,
    KycProvider,
    PayoutProvider,
  ],
})
export class GroundModule {}
