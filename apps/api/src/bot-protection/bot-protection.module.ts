import { Global, Logger, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { CloudflareTurnstileVerifier, MockTurnstileVerifier, TurnstileVerifier } from './turnstile';

@Global()
@Module({
  providers: [
    {
      provide: TurnstileVerifier,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TurnstileVerifier => {
        if (config.TURNSTILE_SECRET_KEY) {
          return new CloudflareTurnstileVerifier(config.TURNSTILE_SECRET_KEY, [
            new URL(config.WEB_APP_URL).hostname,
          ]);
        }
        new Logger('BotProtection').warn(
          'TURNSTILE_SECRET_KEY is not set; using the mock verifier',
        );
        return new MockTurnstileVerifier();
      },
    },
  ],
  exports: [TurnstileVerifier],
})
export class BotProtectionModule {}
