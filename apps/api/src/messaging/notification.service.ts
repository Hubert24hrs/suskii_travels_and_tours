import { Injectable, Logger } from '@nestjs/common';

import type { NotificationCategory, NotificationChannel } from '@suskii/shared';

import { notificationMatrix } from '../accounts/notification-matrix';
import type { NotificationStatus } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { EmailProvider, isUndeliverable } from '../notifications/email';
import { SmsProvider } from '../notifications/sms';
import { WhatsAppProvider } from '../notifications/whatsapp';
import { PushTokensService } from '../push/push-tokens.service';

/** One message rendered per channel; channels left out are not attempted. */
export interface NotificationContent {
  category: NotificationCategory;
  /** Template name for the delivery log and metrics. */
  template: string;
  bookingId?: string | null;
  email?: { subject: string; text: string; html: string };
  /** Short text for SMS and WhatsApp (no links with tokens, no personal data). */
  text?: string;
  /** Title and body name the booking reference at most; `path` opens in the app. */
  push?: { title: string; body: string; path: string };
}

export type DeliveryOutcome = Partial<Record<NotificationChannel, NotificationStatus>>;

type Skip = 'preference_off' | 'no_email' | 'no_verified_phone' | 'no_device' | 'account_inactive';

/**
 * The account notification dispatcher (ADR-032): resolves the user's channel choices, sends what
 * each channel allows through its provider, and logs every attempt (template, channel, outcome,
 * reason) without bodies or contact values. It never throws: a failed channel is logged and the
 * others still go.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    private readonly whatsapp: WhatsAppProvider,
    private readonly push: PushTokensService,
  ) {}

  async notify(userId: string, content: NotificationContent): Promise<DeliveryOutcome> {
    const outcome: DeliveryOutcome = {};
    try {
      const [user, matrix] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, phone: true, phoneVerifiedAt: true, status: true },
        }),
        notificationMatrix(this.prisma, userId),
      ]);
      const channels = this.channels(content);
      for (const channel of channels) {
        if (user?.status !== 'active') {
          outcome[channel] = await this.log(
            userId,
            content,
            channel,
            'skipped',
            'account_inactive',
          );
        } else if (!matrix[content.category][channel]) {
          outcome[channel] = await this.log(userId, content, channel, 'skipped', 'preference_off');
        } else {
          outcome[channel] = await this.deliver(userId, user, content, channel);
        }
      }
    } catch (error) {
      this.logger.error(
        { template: content.template, reason: (error as Error).name },
        'notification dispatch failed',
      );
    }
    return outcome;
  }

  private channels(content: NotificationContent): NotificationChannel[] {
    return [
      ...(content.email ? (['email'] as const) : []),
      ...(content.text ? (['sms', 'whatsapp'] as const) : []),
      ...(content.push ? (['push'] as const) : []),
    ];
  }

  private async deliver(
    userId: string,
    user: { email: string | null; phone: string | null; phoneVerifiedAt: Date | null },
    content: NotificationContent,
    channel: NotificationChannel,
  ): Promise<NotificationStatus> {
    try {
      switch (channel) {
        case 'email': {
          if (!user.email || isUndeliverable(user.email) || !content.email) {
            return await this.log(userId, content, channel, 'skipped', 'no_email');
          }
          await this.email.send({ to: user.email, template: content.template, ...content.email });
          break;
        }
        case 'sms':
        case 'whatsapp': {
          if (!user.phone || !user.phoneVerifiedAt || !content.text) {
            return await this.log(userId, content, channel, 'skipped', 'no_verified_phone');
          }
          const message = { to: user.phone, body: content.text, template: content.template };
          if (channel === 'sms') await this.sms.send(message);
          else await this.whatsapp.send(message);
          break;
        }
        case 'push': {
          const sent = content.push ? await this.push.sendToUser(userId, content.push) : 0;
          if (sent === 0) return await this.log(userId, content, channel, 'skipped', 'no_device');
          break;
        }
      }
      return await this.log(userId, content, channel, 'sent', null);
    } catch (error) {
      this.logger.warn(
        { template: content.template, channel, reason: (error as Error).name },
        'notification channel failed',
      );
      return this.log(userId, content, channel, 'failed', 'provider_error');
    }
  }

  private async log(
    userId: string,
    content: NotificationContent,
    channel: NotificationChannel,
    status: NotificationStatus,
    reason: Skip | 'provider_error' | null,
  ): Promise<NotificationStatus> {
    await this.prisma.notification.create({
      data: {
        userId,
        bookingId: content.bookingId ?? null,
        category: content.category,
        channel,
        template: content.template,
        status,
        reason,
      },
    });
    return status;
  }
}
