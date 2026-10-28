import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { APP_CONFIG, type AppConfig } from '../config/config';

import { AdminSupportController } from './admin-support.controller';
import { SupportAccess } from './support-access';
import { SupportAdminService } from './support-admin.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import {
  CloudWhatsAppChannel,
  MockWhatsAppChannel,
  WhatsAppChannel,
} from './whatsapp/whatsapp-channel';
import { WhatsAppInbox } from './whatsapp/whatsapp-inbox.service';
import { WhatsAppReplies } from './whatsapp/whatsapp-replies.service';
import { WhatsAppController } from './whatsapp/whatsapp.controller';

/**
 * Support conversations: travellers, guests and visitors, the console inbox (ADR-083) and
 * WhatsApp as a channel (ADR-084).
 */
@Module({
  imports: [BookingsModule],
  controllers: [SupportController, AdminSupportController, WhatsAppController],
  providers: [
    SupportService,
    SupportAdminService,
    SupportAccess,
    WhatsAppInbox,
    WhatsAppReplies,
    MockWhatsAppChannel,
    {
      provide: WhatsAppChannel,
      inject: [APP_CONFIG, MockWhatsAppChannel],
      useFactory: (config: AppConfig, mock: MockWhatsAppChannel): WhatsAppChannel =>
        config.WHATSAPP_SUPPORT_PROVIDER === 'cloud'
          ? new CloudWhatsAppChannel({
              baseUrl: config.WHATSAPP_GRAPH_API_URL,
              phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID ?? '',
              accessToken: config.WHATSAPP_ACCESS_TOKEN ?? '',
            })
          : mock,
    },
  ],
})
export class SupportModule {}
