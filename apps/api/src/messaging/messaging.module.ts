import { Global, Module } from '@nestjs/common';

import { NotificationService } from './notification.service';

/**
 * The account notification dispatcher (ADR-032). Global, on top of the providers in
 * NotificationsModule and the device tokens in PushModule.
 */
@Global()
@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class MessagingModule {}
