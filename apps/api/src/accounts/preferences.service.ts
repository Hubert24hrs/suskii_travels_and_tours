import { HttpStatus, Injectable } from '@nestjs/common';

import {
  isMandatoryChannel,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  resolvePreferences,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationMatrix,
  type PreferencesInput,
} from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';
import type { Prisma, UserPreference } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type { NotificationPreferencesDto, PreferencesDto } from './accounts.schemas';

type Tx = Prisma.TransactionClient;

export interface NotificationChange {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

const toPreferencesDto = (row: UserPreference | null): PreferencesDto => ({
  locale: row?.locale ?? null,
  currency: row?.currency ?? null,
  homeAirport: row?.homeAirport ?? null,
  marketingConsent: Boolean(row?.marketingConsentAt),
  marketingConsentAt: row?.marketingConsentAt?.toISOString() ?? null,
});

const mandatoryOff = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'notification-mandatory',
    'This notification cannot be turned off',
    'Booking and payment emails carry your documents and payment notices.',
  );

/**
 * Account preferences and notification choices (ADR-032). Marketing is opt-in: turning on a
 * marketing channel records consent (time and source) and withdrawing consent turns every
 * marketing channel off, so the two can never disagree.
 */
@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<PreferencesDto> {
    return toPreferencesDto(await this.prisma.userPreference.findUnique({ where: { userId } }));
  }

  async update(userId: string, input: PreferencesInput, source: string): Promise<PreferencesDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userPreference.findUnique({ where: { userId } });
      const consent = input.marketingConsent;
      const data = {
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.homeAirport !== undefined ? { homeAirport: input.homeAirport } : {}),
        ...(consent === true && !existing?.marketingConsentAt
          ? { marketingConsentAt: new Date(), marketingConsentSource: source }
          : {}),
        ...(consent === false ? { marketingConsentAt: null, marketingConsentSource: null } : {}),
      };
      const saved = await tx.userPreference.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      if (consent === false) await this.setMarketing(tx, userId, false);
      if (consent === true && !existing?.marketingConsentAt) {
        // "Send me offers" with nothing chosen yet means by email.
        const chosen = await tx.notificationPreference.count({
          where: { userId, category: 'marketing', enabled: true },
        });
        if (chosen === 0) await this.upsertChoice(tx, userId, 'marketing', 'email', true);
      }
      return saved;
    });
    return toPreferencesDto(row);
  }

  async matrix(userId: string, tx: Tx | PrismaService = this.prisma): Promise<NotificationMatrix> {
    const [stored, preference] = await Promise.all([
      tx.notificationPreference.findMany({ where: { userId } }),
      tx.userPreference.findUnique({ where: { userId }, select: { marketingConsentAt: true } }),
    ]);
    const matrix = resolvePreferences(stored);
    // Without recorded consent no marketing channel counts, whatever is stored.
    if (!preference?.marketingConsentAt) {
      for (const channel of NOTIFICATION_CHANNELS) matrix.marketing[channel] = false;
    }
    return matrix;
  }

  async notifications(userId: string): Promise<NotificationPreferencesDto> {
    const [matrix, user, preference] = await Promise.all([
      this.matrix(userId),
      this.prisma.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true } }),
      this.prisma.userPreference.findUnique({
        where: { userId },
        select: { marketingConsentAt: true },
      }),
    ]);
    return {
      preferences: NOTIFICATION_CATEGORIES.flatMap((category) =>
        NOTIFICATION_CHANNELS.map((channel) => ({
          category,
          channel,
          enabled: matrix[category][channel],
          mandatory: isMandatoryChannel(category, channel),
        })),
      ),
      phoneVerified: Boolean(user?.phoneVerifiedAt),
      marketingConsent: Boolean(preference?.marketingConsentAt),
    };
  }

  async updateNotifications(
    userId: string,
    changes: readonly NotificationChange[],
    source: string,
  ): Promise<NotificationPreferencesDto> {
    if (
      changes.some(
        (change) => !change.enabled && isMandatoryChannel(change.category, change.channel),
      )
    ) {
      throw mandatoryOff();
    }
    await this.prisma.$transaction(async (tx) => {
      for (const change of changes) {
        // Mandatory channels are always on; storing them would only add noise.
        if (isMandatoryChannel(change.category, change.channel)) continue;
        await this.upsertChoice(tx, userId, change.category, change.channel, change.enabled);
      }
      if (!changes.some((change) => change.category === 'marketing')) return;
      const marketingOn = await tx.notificationPreference.count({
        where: { userId, category: 'marketing', enabled: true },
      });
      const preference = await tx.userPreference.findUnique({ where: { userId } });
      if (marketingOn > 0 && !preference?.marketingConsentAt) {
        await tx.userPreference.upsert({
          where: { userId },
          create: { userId, marketingConsentAt: new Date(), marketingConsentSource: source },
          update: { marketingConsentAt: new Date(), marketingConsentSource: source },
        });
      } else if (marketingOn === 0 && preference?.marketingConsentAt) {
        await tx.userPreference.update({
          where: { userId },
          data: { marketingConsentAt: null, marketingConsentSource: null },
        });
      }
    });
    return this.notifications(userId);
  }

  private async setMarketing(tx: Tx, userId: string, enabled: boolean): Promise<void> {
    for (const channel of NOTIFICATION_CHANNELS) {
      await this.upsertChoice(tx, userId, 'marketing', channel, enabled);
    }
  }

  private async upsertChoice(
    tx: Tx,
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<void> {
    await tx.notificationPreference.upsert({
      where: { userId_category_channel: { userId, category, channel } },
      create: { userId, category, channel, enabled },
      update: { enabled },
    });
  }
}
