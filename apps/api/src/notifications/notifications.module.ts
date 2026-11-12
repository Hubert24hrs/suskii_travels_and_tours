import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';
import type { SmsProviderName } from '../config/env.schema';

import { EmailProvider, MockEmailProvider, SmtpEmailProvider } from './email';
import { ExpoPushProvider, MockPushProvider, PushProvider } from './push';
import { MockSmsProvider, SmsProvider } from './sms';
import { AfricasTalkingSmsProvider, RoutingSmsProvider, TermiiSmsProvider } from './sms-providers';
import { DisabledWhatsAppProvider, MockWhatsAppProvider, WhatsAppProvider } from './whatsapp';

/** The SMS adapters the settings name, each built once (ADR-091). */
export function smsProviderFor(config: AppConfig, mock = new MockSmsProvider()): SmsProvider {
  const built = new Map<SmsProviderName, SmsProvider>();
  const build = (name: SmsProviderName): SmsProvider => {
    const existing = built.get(name);
    if (existing) return existing;
    const provider =
      name === 'termii'
        ? new TermiiSmsProvider({
            baseUrl: config.TERMII_API_URL,
            apiKey: config.TERMII_API_KEY ?? '',
            senderId: config.TERMII_SENDER_ID ?? '',
            channel: config.TERMII_CHANNEL,
            timeoutMs: config.SMS_TIMEOUT_MS,
          })
        : name === 'africastalking'
          ? new AfricasTalkingSmsProvider({
              baseUrl: config.AFRICASTALKING_API_URL,
              username: config.AFRICASTALKING_USERNAME ?? '',
              apiKey: config.AFRICASTALKING_API_KEY ?? '',
              senderId: config.AFRICASTALKING_SENDER_ID ?? null,
              timeoutMs: config.SMS_TIMEOUT_MS,
            })
          : mock;
    built.set(name, provider);
    return provider;
  };
  const fallback = { name: config.SMS_PROVIDER, provider: build(config.SMS_PROVIDER) };
  const routes = new Map(
    config.SMS_ROUTES.map(([prefix, name]) => [prefix, { name, provider: build(name) }] as const),
  );
  // Tests and local stacks reach the mock directly, so its outbox stays inspectable.
  if (routes.size === 0 && config.SMS_PROVIDER === 'mock') return mock;
  return new RoutingSmsProvider(fallback, routes);
}

@Global()
@Module({
  providers: [
    {
      provide: EmailProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailProvider =>
        config.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider(config) : new MockEmailProvider(),
    },
    {
      provide: SmsProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SmsProvider => smsProviderFor(config),
    },
    // WhatsApp notifications need an approved template per message (ADR-032); `none` turns them off.
    {
      provide: WhatsAppProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): WhatsAppProvider =>
        config.WHATSAPP_PROVIDER === 'none'
          ? new DisabledWhatsAppProvider()
          : new MockWhatsAppProvider(),
    },
    {
      provide: PushProvider,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PushProvider =>
        config.PUSH_PROVIDER === 'expo'
          ? new ExpoPushProvider({
              url: config.EXPO_PUSH_URL,
              accessToken: config.EXPO_ACCESS_TOKEN,
            })
          : new MockPushProvider(),
    },
  ],
  exports: [EmailProvider, SmsProvider, WhatsAppProvider, PushProvider],
})
export class NotificationsModule {}
