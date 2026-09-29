import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { EmailProvider, MockEmailProvider, SmtpEmailProvider } from './email';
import { MockSmsProvider, SmsProvider } from './sms';

@Global()
@Module({
  providers: [
    {
      provide: EmailProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailProvider =>
        config.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider(config) : new MockEmailProvider(),
    },
    // The only SMS adapter until a provider is contracted (SMS_PROVIDER accepts 'mock' only).
    { provide: SmsProvider, useClass: MockSmsProvider },
  ],
  exports: [EmailProvider, SmsProvider],
})
export class NotificationsModule {}
