import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { CarsFeaturesController } from './cars-features.controller';
import { CarsFeatureGuard, CarsFlags } from './cars-flags';
import { KycProvider, MockKycProvider } from './kyc';
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
      useFactory: (config: AppConfig, mock: MockMapsProvider): MapsProvider =>
        config.MAPS_PROVIDER === 'osrm' && config.OSRM_URL
          ? new OsrmMapsProvider(config.OSRM_URL, config.MAPS_TIMEOUT_MS)
          : mock,
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
