import { Module } from '@nestjs/common';

import { AiSearchModule } from '../ai-search/ai-search.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { APP_CONFIG, type AppConfig } from '../config/config';

import { AdminSupportController } from './admin-support.controller';
import { SupportAnswerer } from './assistant/support-answerer';
import { SupportAssistant } from './assistant/support-assistant.service';
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
 * Support conversations: travellers, guests and visitors, the console inbox (ADR-083), WhatsApp
 * as a channel (ADR-084) and the after-hours assistant (ADR-085).
 */
@Module({
  imports: [AuthModule, BookingsModule, AiSearchModule],
  controllers: [SupportController, AdminSupportController, WhatsAppController],
  providers: [
    SupportService,
    SupportAdminService,
    SupportAccess,
    SupportAnswerer,
    SupportAssistant,
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
