import { Global, Module } from '@nestjs/common';

import { InternalPushTokensController, MePushTokenController } from './push-tokens.controller';
import { PushTokensService } from './push-tokens.service';

/** Device push tokens and delivery (ADR-022); bookings use the service to notify devices. */
@Global()
@Module({
  controllers: [MePushTokenController, InternalPushTokensController],
  providers: [PushTokensService],
  exports: [PushTokensService],
})
export class PushModule {}
