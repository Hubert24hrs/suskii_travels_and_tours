import { Inject, Injectable, Logger } from '@nestjs/common';
import { whatsappWindowOpen } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../../config/config';
import { supportMessageContext, whatsappPhoneContext } from '../../crypto/encryption-contexts';
import { FieldEncryption } from '../../crypto/field-encryption';
import { PrismaService } from '../../infra/prisma.service';
import { supportWhatsAppOutbound } from '../../telemetry/metrics';

import { WhatsAppChannel, WhatsAppSendError } from './whatsapp-channel';

/** How long one send to Meta may take before the reply is marked failed (`timeout`). */
const SEND_TIMEOUT_MS = 10_000;

interface Contact {
  id: string;
  phoneEncrypted: string | null;
  lastInboundAt: Date;
  optedOutAt: Date | null;
}

/**
 * Staff replies on WhatsApp conversations (ADR-084). Called after the reply is committed: inside
 * the 24-hour window the text goes as is; outside it the approved template goes as a notice and
 * the reply waits (`pending` with `noticeSentAt`) until the traveller writes back, when
 * `forwardWaiting` sends it. Every outcome is stored on the message; nothing here throws.
 */
@Injectable()
export class WhatsAppReplies {
  private readonly logger = new Logger(WhatsAppReplies.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly encryption: FieldEncryption,
    private readonly channel: WhatsAppChannel,
  ) {}

  /** Sends one committed staff reply, or its template notice outside the window. */
  async deliver(messageId: string): Promise<void> {
    const message = await this.prisma.supportMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        bodyEncrypted: true,
        conversation: { select: { reference: true, whatsappContact: true } },
      },
    });
    if (!message) return;
    const contact = message.conversation.whatsappContact;
    const phone = this.phone(contact);
    if (!contact || !phone) return this.fail(message.id, contact ? 'no-phone' : 'no-contact');

    if (whatsappWindowOpen(contact.lastInboundAt, new Date())) {
      return this.sendText(message.id, phone, message.bodyEncrypted);
    }
    if (contact.optedOutAt) return this.fail(message.id, 'opted-out');
    try {
      await this.channel.sendTemplate(
        phone,
        {
          name: this.config.WHATSAPP_SUPPORT_TEMPLATE,
          language: this.config.WHATSAPP_SUPPORT_TEMPLATE_LANGUAGE,
          parameters: [message.conversation.reference],
        },
        AbortSignal.timeout(SEND_TIMEOUT_MS),
      );
      await this.prisma.supportMessage.update({
        where: { id: message.id },
        data: { noticeSentAt: new Date() },
      });
      supportWhatsAppOutbound.add(1, { kind: 'template', outcome: 'sent' });
    } catch (error) {
      supportWhatsAppOutbound.add(1, { kind: 'template', outcome: 'failed' });
      await this.fail(message.id, codeOf(error));
    }
  }

  /**
   * The traveller wrote back: replies that waited behind a template notice go now, oldest
   * first, while the window they just opened lasts.
   */
  async forwardWaiting(conversationId: string): Promise<void> {
    const waiting = await this.prisma.supportMessage.findMany({
      where: { conversationId, deliveryStatus: 'pending', noticeSentAt: { not: null } },
      select: {
        id: true,
        bodyEncrypted: true,
        conversation: { select: { whatsappContact: true } },
      },
      orderBy: { id: 'asc' },
    });
    for (const message of waiting) {
      const phone = this.phone(message.conversation.whatsappContact);
      if (!phone) await this.fail(message.id, 'no-phone');
      else await this.sendText(message.id, phone, message.bodyEncrypted);
    }
  }

  private async sendText(messageId: string, phone: string, bodyEncrypted: string): Promise<void> {
    const text = this.encryption.decrypt(bodyEncrypted, supportMessageContext(messageId));
    try {
      const sent = await this.channel.sendText(phone, text, AbortSignal.timeout(SEND_TIMEOUT_MS));
      // Only a reply still pending is marked: a status webhook may have overtaken this answer.
      await this.prisma.supportMessage.updateMany({
        where: { id: messageId, deliveryStatus: 'pending' },
        data: { deliveryStatus: 'sent', externalId: sent.messageId, deliveryError: null },
      });
      supportWhatsAppOutbound.add(1, { kind: 'text', outcome: 'sent' });
    } catch (error) {
      supportWhatsAppOutbound.add(1, { kind: 'text', outcome: 'failed' });
      await this.fail(messageId, codeOf(error));
    }
  }

  private async fail(messageId: string, code: string): Promise<void> {
    this.logger.warn({ messageId, reason: code }, 'support reply not delivered on whatsapp');
    await this.prisma.supportMessage.updateMany({
      where: { id: messageId, deliveryStatus: 'pending' },
      data: { deliveryStatus: 'failed', deliveryError: code.slice(0, 64) },
    });
  }

  private phone(contact: Contact | null): string | null {
    return contact?.phoneEncrypted
      ? this.encryption.decrypt(contact.phoneEncrypted, whatsappPhoneContext(contact.id))
      : null;
  }
}

const codeOf = (error: unknown): string =>
  error instanceof WhatsAppSendError ? error.code : 'unexpected';
