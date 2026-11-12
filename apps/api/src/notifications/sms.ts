import { Injectable, Logger } from '@nestjs/common';

export interface SmsMessage {
  /** E.164 number. */
  to: string;
  body: string;
  template: string;
}

/**
 * A text the provider refused or that did not finish (ADR-091). `code` is safe to store and log:
 * it never holds the number or the message.
 */
export class SmsSendError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
  ) {
    super(`SMS send failed: ${provider} ${code}`);
    this.name = 'SmsSendError';
  }
}

export abstract class SmsProvider {
  abstract send(message: SmsMessage): Promise<void>;
}

/**
 * Keeps messages in memory and sends nothing (tests and local stacks). Production refuses to boot
 * with it unless ALLOW_MOCK_PROVIDERS=true (staging).
 */
@Injectable()
export class MockSmsProvider extends SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);
  readonly outbox: SmsMessage[] = [];
  /** Tests set a code to make the next sends fail as a provider would. */
  failWith: string | null = null;

  send(message: SmsMessage): Promise<void> {
    if (this.failWith) return Promise.reject(new SmsSendError('mock', this.failWith));
    this.outbox.push(message);
    this.logger.log({ template: message.template }, 'sms captured by mock provider');
    return Promise.resolve();
  }
}
