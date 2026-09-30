import { Injectable, Logger } from '@nestjs/common';

import { uuidv7 } from '../common/uuid';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import type { PushPlatform } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { PushProvider, type PushMessage } from '../notifications/push';

export interface PushTokenInput {
  token: string;
  platform: PushPlatform;
}

type Scope = { sessionId: string; userId: string } | { bookingId: string };

const DAY_MS = 86_400_000;
/** Longer than the furthest bookable trip (361 days) plus a margin. */
const STALE_AFTER_DAYS = 400;
/** Closed bookings keep their devices this long for refund updates. */
const CLOSED_BOOKING_DAYS = 30;
const CLOSED_STATUSES = ['CANCELLED', 'EXPIRED', 'FAILED', 'REFUNDED'] as const;

const context = (id: string): string => `push-token:${id}`;

/**
 * Device push tokens (ADR-022): encrypted per row, looked up by HMAC, scoped to an account
 * session or to one booking. A booking's pushes go to its own devices and to the owner's devices
 * whose session is still active, each device once.
 */
@Injectable()
export class PushTokensService {
  private readonly logger = new Logger(PushTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
    private readonly encryption: FieldEncryption,
    private readonly push: PushProvider,
  ) {}

  registerForSession(sessionId: string, userId: string, input: PushTokenInput): Promise<void> {
    return this.register({ sessionId, userId }, input);
  }

  registerForBooking(bookingId: string, input: PushTokenInput): Promise<void> {
    return this.register({ bookingId }, input);
  }

  /** Stops pushes to the devices registered with this session. */
  async unregisterSession(sessionId: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { sessionId } });
  }

  /** Sends one message to every device that follows the booking. Never throws. */
  async sendToBooking(bookingId: string, message: Omit<PushMessage, 'to'>): Promise<number> {
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: { userId: true },
      });
      if (!booking) return 0;
      const now = new Date();
      const rows = await this.prisma.pushToken.findMany({
        where: {
          OR: [
            { bookingId },
            ...(booking.userId
              ? [
                  {
                    userId: booking.userId,
                    session: { revokedAt: null, expiresAt: { gt: now } },
                  },
                ]
              : []),
          ],
        },
        select: { id: true, tokenHash: true, tokenEncrypted: true },
        orderBy: { lastSeenAt: 'desc' },
      });
      const devices = new Map<string, string>();
      for (const row of rows) {
        if (!devices.has(row.tokenHash))
          devices.set(row.tokenHash, this.encryption.decrypt(row.tokenEncrypted, context(row.id)));
      }
      const targets = [...devices.entries()];
      if (targets.length === 0) return 0;
      const results = await this.push.send(targets.map(([, token]) => ({ ...message, to: token })));
      // An uninstalled app is gone for every scope, not only the rows used for this send.
      const invalid = targets.filter((_, index) => results[index] === 'invalid-token');
      if (invalid.length > 0) {
        await this.prisma.pushToken.deleteMany({
          where: { tokenHash: { in: invalid.map(([hash]) => hash) } },
        });
      }
      return results.filter((result) => result === 'ok').length;
    } catch (error) {
      this.logger.error({ bookingId, reason: (error as Error).name }, 'push delivery failed');
      return 0;
    }
  }

  /**
   * Deletes tokens nobody should reach any more: ended sessions, closed bookings after 30 days,
   * and anything not refreshed for 400 days.
   */
  async prune(now = new Date()): Promise<{ deleted: number }> {
    const closedBefore = new Date(now.getTime() - CLOSED_BOOKING_DAYS * DAY_MS);
    const { count } = await this.prisma.pushToken.deleteMany({
      where: {
        OR: [
          { session: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }] } },
          { booking: { status: { in: [...CLOSED_STATUSES] }, updatedAt: { lt: closedBefore } } },
          { lastSeenAt: { lt: new Date(now.getTime() - STALE_AFTER_DAYS * DAY_MS) } },
        ],
      },
    });
    return { deleted: count };
  }

  private async register(scope: Scope, input: PushTokenInput): Promise<void> {
    const tokenHash = this.hmac.digest('push-token', input.token);
    const key = 'sessionId' in scope ? `session:${scope.sessionId}` : `booking:${scope.bookingId}`;
    const id = uuidv7();
    await this.prisma.pushToken.upsert({
      where: { tokenHash_scope: { tokenHash, scope: key } },
      update: { lastSeenAt: new Date(), platform: input.platform },
      create: {
        id,
        tokenHash,
        tokenEncrypted: this.encryption.encrypt(input.token, context(id)),
        platform: input.platform,
        scope: key,
        ...('sessionId' in scope
          ? { sessionId: scope.sessionId, userId: scope.userId }
          : { bookingId: scope.bookingId }),
      },
    });
  }
}
