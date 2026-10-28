import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SUPPORT_MESSAGES_PER_CONVERSATION,
  isWhatsAppStop,
  supportDeliveryAdvances,
  supportSchedule,
} from '@suskii/shared';
import type { Redis } from 'ioredis';

import { uuidv7 } from '../../common/uuid';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import {
  supportMessageContext,
  whatsappBsuidContext,
  whatsappPhoneContext,
} from '../../crypto/encryption-contexts';
import { FieldEncryption } from '../../crypto/field-encryption';
import { HmacService } from '../../crypto/hmac.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { REDIS } from '../../infra/redis';
import { consume } from '../../rate-limit/sliding-window';
import { supportConversations, supportWhatsAppInbound } from '../../telemetry/metrics';
import { customerMessageChanges, newSupportReference } from '../support.service';

import { WhatsAppReplies } from './whatsapp-replies.service';
import type { WhatsAppDelivery, WhatsAppDeliveryUpdate, WhatsAppInbound } from './whatsapp-webhook';

const DAY_MS = 86_400_000;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * WhatsApp messages into support conversations (ADR-084). A message joins the contact's open or
 * waiting conversation, reopens one solved within `SUPPORT_WHATSAPP_REOPEN_DAYS`, or starts a new
 * one; a repeated delivery (same `wamid`) changes nothing. STOP opts the contact out of templates
 * without owing anyone a reply. Status webhooks move staff replies forward only.
 */
@Injectable()
export class WhatsAppInbox {
  private readonly logger = new Logger(WhatsAppInbox.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly encryption: FieldEncryption,
    private readonly hmac: HmacService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly replies: WhatsAppReplies,
  ) {}

  async receive(deliveries: WhatsAppDelivery[]): Promise<void> {
    for (const delivery of deliveries) {
      // Another number on the same WhatsApp Business account is not ours to answer.
      const ours = this.config.WHATSAPP_PHONE_NUMBER_ID;
      if (ours && delivery.phoneNumberId && delivery.phoneNumberId !== ours) continue;
      for (const message of delivery.messages) await this.message(message);
      for (const status of delivery.statuses) await this.status(status);
    }
  }

  private async message(inbound: WhatsAppInbound): Promise<void> {
    const seen = await this.prisma.supportMessage.findUnique({
      where: { externalId: inbound.messageId },
      select: { id: true },
    });
    if (seen)
      return void supportWhatsAppInbound.add(1, { kind: inbound.kind, outcome: 'duplicate' });

    const contact = await this.contact(inbound);
    if (!(await this.withinFloodLimit(contact.id))) {
      return void supportWhatsAppInbound.add(1, { kind: inbound.kind, outcome: 'dropped' });
    }
    const stop = inbound.kind === 'text' && isWhatsAppStop(inbound.body);
    let conversationId: string | null;
    try {
      conversationId = await this.store(inbound, contact.id, stop);
    } catch (error) {
      // The same delivery processed twice at once: the first one won.
      if (isUniqueViolation(error)) {
        return void supportWhatsAppInbound.add(1, { kind: inbound.kind, outcome: 'duplicate' });
      }
      throw error;
    }
    supportWhatsAppInbound.add(1, { kind: inbound.kind, outcome: stop ? 'stop' : 'stored' });
    if (conversationId && !stop) await this.replies.forwardWaiting(conversationId);
  }

  /**
   * Finds or creates the contact, keeps the window time current and fills in a number or BSUID
   * Meta sends later. Two first messages at once both try to create: the loser reads the winner.
   */
  private async contact(inbound: WhatsAppInbound): Promise<{ id: string }> {
    const phoneHash = inbound.phone ? this.hmac.digest('whatsapp-phone', inbound.phone) : null;
    const bsuidHash = inbound.bsuid ? this.hmac.digest('whatsapp-bsuid', inbound.bsuid) : null;
    const find = () =>
      this.prisma.whatsAppContact.findFirst({
        where: {
          OR: [...(phoneHash ? [{ phoneHash }] : []), ...(bsuidHash ? [{ bsuidHash }] : [])],
        },
      });
    let existing = await find();
    if (!existing) {
      const id = uuidv7();
      try {
        return await this.prisma.whatsAppContact.create({
          data: {
            id,
            phoneHash,
            phoneEncrypted: inbound.phone
              ? this.encryption.encrypt(inbound.phone, whatsappPhoneContext(id))
              : null,
            bsuidHash,
            bsuidEncrypted: inbound.bsuid
              ? this.encryption.encrypt(inbound.bsuid, whatsappBsuidContext(id))
              : null,
            lastInboundAt: inbound.sentAt,
          },
          select: { id: true },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        existing = await find();
        if (!existing) throw error;
      }
    }
    const { id } = existing;
    await this.prisma.whatsAppContact.update({
      where: { id },
      data: {
        // Deliveries can arrive out of order; the window runs from the latest message.
        ...(inbound.sentAt > existing.lastInboundAt ? { lastInboundAt: inbound.sentAt } : {}),
        ...(inbound.phone && !existing.phoneHash
          ? {
              phoneHash,
              phoneEncrypted: this.encryption.encrypt(inbound.phone, whatsappPhoneContext(id)),
            }
          : {}),
        ...(inbound.bsuid && !existing.bsuidHash
          ? {
              bsuidHash,
              bsuidEncrypted: this.encryption.encrypt(inbound.bsuid, whatsappBsuidContext(id)),
            }
          : {}),
      },
    });
    return { id };
  }

  private async withinFloodLimit(contactId: string): Promise<boolean> {
    try {
      const result = await consume(
        this.redis,
        `support:whatsapp:${contactId}`,
        this.config.SUPPORT_WHATSAPP_MESSAGES_PER_MINUTE,
        60,
      );
      return result.allowed;
    } catch (error) {
      // Like the route limiter: without Redis, messages still get through.
      this.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'whatsapp flood limit unavailable',
      );
      return true;
    }
  }

  /** Stores the message; returns the conversation it joined (null for a STOP with none). */
  private async store(
    inbound: WhatsAppInbound,
    contactId: string,
    stop: boolean,
  ): Promise<string | null> {
    const now = new Date();
    const messageId = uuidv7();
    return this.prisma.$transaction(async (tx) => {
      await tx.whatsAppContact.update({
        where: { id: contactId },
        data: { optedOutAt: stop ? now : null },
      });
      const latest = await tx.supportConversation.findFirst({
        where: { whatsappContactId: contactId },
        orderBy: { updatedAt: 'desc' },
      });
      const reopenAfter = new Date(
        now.getTime() - this.config.SUPPORT_WHATSAPP_REOPEN_DAYS * DAY_MS,
      );
      const joinable =
        latest &&
        latest.messageCount < SUPPORT_MESSAGES_PER_CONVERSATION &&
        (latest.status !== 'resolved' || (latest.resolvedAt ?? latest.updatedAt) >= reopenAfter);
      // STOP is recorded where the conversation is, and never owes anyone a reply.
      if (stop && !joinable) return null;
      const message = {
        id: messageId,
        author: 'customer' as const,
        kind: inbound.kind,
        bodyEncrypted: this.encryption.encrypt(inbound.body, supportMessageContext(messageId)),
        externalId: inbound.messageId,
        createdAt: now,
      };
      if (joinable) {
        await tx.supportMessage.create({ data: { ...message, conversationId: latest.id } });
        await tx.supportConversation.update({
          where: { id: latest.id },
          data: {
            ...(stop ? {} : customerMessageChanges(latest, now, this.config.SUPPORT_SLA)),
            customerReadAt: now,
            messageCount: { increment: 1 },
          },
        });
        return latest.id;
      }
      const id = uuidv7();
      let reference = newSupportReference();
      while (
        await tx.supportConversation.findUnique({ where: { reference }, select: { id: true } })
      ) {
        reference = newSupportReference();
      }
      // Nobody is known here: no account, no booking, so the normal queue (staff can raise it).
      await tx.supportConversation.create({
        data: {
          id,
          reference,
          whatsappContactId: contactId,
          channel: 'whatsapp',
          category: 'general',
          priority: 'normal',
          status: 'open',
          openedAt: now,
          replyOwedSince: now,
          ...supportSchedule(
            { status: 'open', priority: 'normal', openedAt: now, replyOwedSince: now },
            this.config.SUPPORT_SLA,
          ),
          lastCustomerMessageAt: now,
          customerReadAt: now,
          messageCount: 1,
          createdAt: now,
        },
      });
      await tx.supportMessage.create({ data: { ...message, conversationId: id } });
      supportConversations.add(1, { channel: 'whatsapp', category: 'general' });
      return id;
    });
  }

  private async status(update: WhatsAppDeliveryUpdate): Promise<void> {
    const message = await this.prisma.supportMessage.findUnique({
      where: { externalId: update.messageId },
      select: { id: true, deliveryStatus: true },
    });
    if (!message?.deliveryStatus) return;
    if (!supportDeliveryAdvances(message.deliveryStatus, update.status)) return;
    // Conditional on the status read above, so two webhooks racing cannot move it backwards.
    await this.prisma.supportMessage.updateMany({
      where: { id: message.id, deliveryStatus: message.deliveryStatus },
      data: { deliveryStatus: update.status, deliveryError: update.error },
    });
  }
}
