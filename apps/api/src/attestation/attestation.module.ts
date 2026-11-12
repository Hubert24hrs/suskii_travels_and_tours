import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { AttestationController } from './attestation.controller';
import { AttestationGuard } from './attestation.guard';
import { AttestationService } from './attestation.service';
import {
  DeviceAttestationVerifier,
  MockDeviceAttestationVerifier,
  NoDeviceAttestationVerifier,
} from './device-attestation-verifier';

/** Device attestation for the mobile app (ADR-023). */
@Global()
@Module({
  controllers: [AttestationController],
  providers: [
    {
      provide: DeviceAttestationVerifier,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DeviceAttestationVerifier =>
        config.DEVICE_ATTESTATION === 'mock'
          ? new MockDeviceAttestationVerifier()
          : new NoDeviceAttestationVerifier(),
    },
    AttestationService,
    AttestationGuard,
  ],
  exports: [AttestationService, AttestationGuard],
})
export class AttestationModule {}
