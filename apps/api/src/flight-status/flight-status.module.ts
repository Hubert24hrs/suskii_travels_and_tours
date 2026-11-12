import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { MockFlightStatusProvider, type FlightStatusProvider } from './flight-status.provider';

/** The flight-status provider in use, or null while the feature is off (ADR-095). */
export const FLIGHT_STATUS = Symbol('FLIGHT_STATUS');

@Module({
  providers: [
    {
      provide: FLIGHT_STATUS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): FlightStatusProvider | null =>
        config.FLIGHT_STATUS_PROVIDER === 'mock'
          ? new MockFlightStatusProvider(config.MOCK_FLIGHT_STATUS_RULES)
          : null,
    },
  ],
  exports: [FLIGHT_STATUS],
})
export class FlightStatusModule {}
