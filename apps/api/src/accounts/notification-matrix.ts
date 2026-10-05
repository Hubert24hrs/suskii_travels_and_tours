import { NOTIFICATION_CHANNELS, resolvePreferences, type NotificationMatrix } from '@suskii/shared';

import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../infra/prisma.service';

type Reader =
  Pick<Prisma.TransactionClient, 'notificationPreference' | 'userPreference'> | PrismaService;

/**
 * A user's effective channel choices (ADR-032): stored choices over the defaults, mandatory
 * booking and payment email always on, and no marketing at all without recorded consent.
 */
export async function notificationMatrix(
  reader: Reader,
  userId: string,
): Promise<NotificationMatrix> {
  const [stored, preference] = await Promise.all([
    reader.notificationPreference.findMany({ where: { userId } }),
    reader.userPreference.findUnique({ where: { userId }, select: { marketingConsentAt: true } }),
  ]);
  const matrix = resolvePreferences(stored);
  if (!preference?.marketingConsentAt) {
    for (const channel of NOTIFICATION_CHANNELS) matrix.marketing[channel] = false;
  }
  return matrix;
}
