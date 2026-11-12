import { Injectable, Logger } from '@nestjs/common';

export interface WhatsAppMessage {
  /** E.164 number (verified on the account). */
  to: string;
  body: string;
  template: string;
}

/** WhatsApp delivery behind an interface (ADR-032); no provider is contracted yet. */
export abstract class WhatsAppProvider {
  /** False when the channel is off (`WHATSAPP_PROVIDER=none`): nothing is sent or attempted. */
  readonly enabled: boolean = true;
  abstract send(message: WhatsAppMessage): Promise<void>;
}

/** The channel turned off (ADR-091): the notification service skips WhatsApp entirely. */
export class DisabledWhatsAppProvider extends WhatsAppProvider {
  override readonly enabled = false;

  send(): Promise<void> {
    return Promise.reject(new Error('WhatsApp notifications are turned off'));
  }
}

/**
 * Mock adapter until a WhatsApp Business provider is contracted: keeps messages in memory and
 * sends nothing. Production refuses to boot with it unless ALLOW_MOCK_PROVIDERS=true.
 */
@Injectable()
export class MockWhatsAppProvider extends WhatsAppProvider {
  private readonly logger = new Logger(MockWhatsAppProvider.name);
  readonly outbox: WhatsAppMessage[] = [];

  send(message: WhatsAppMessage): Promise<void> {
    this.outbox.push(message);
    this.logger.log({ template: message.template }, 'whatsapp message captured by mock provider');
    return Promise.resolve();
  }
}
