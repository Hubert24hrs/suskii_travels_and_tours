import { Injectable, Logger } from '@nestjs/common';

export interface SmsMessage {
  /** E.164 number. */
  to: string;
  body: string;
  template: string;
}

export abstract class SmsProvider {
  abstract send(message: SmsMessage): Promise<void>;
}

/**
 * Mock adapter until an SMS provider is contracted: keeps messages in memory and sends nothing.
 * Production refuses to boot with it unless ALLOW_MOCK_PROVIDERS=true (staging).
 */
@Injectable()
export class MockSmsProvider extends SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  readonly outbox: SmsMessage[] = [];

  send(message: SmsMessage): Promise<void> {
    this.outbox.push(message);
    this.logger.log({ template: message.template }, 'sms captured by mock provider');
    return Promise.resolve();
  }
}
