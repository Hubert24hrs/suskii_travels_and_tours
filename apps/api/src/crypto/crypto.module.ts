import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import {
  BreachedPasswordChecker,
  DisabledBreachedPasswordChecker,
  HibpBreachedPasswordChecker,
} from './breached-password';
import { FieldEncryption, LocalKeyFieldEncryption } from './field-encryption';
import { HmacService } from './hmac.service';
import { PasswordHasher } from './password-hasher';

@Global()
@Module({
  providers: [
    HmacService,
    PasswordHasher,
    { provide: FieldEncryption, useClass: LocalKeyFieldEncryption },
    {
      provide: BreachedPasswordChecker,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.HIBP_ENABLED
          ? new HibpBreachedPasswordChecker()
          : new DisabledBreachedPasswordChecker(),
    },
  ],
  exports: [HmacService, PasswordHasher, FieldEncryption, BreachedPasswordChecker],
})
export class CryptoModule {}
