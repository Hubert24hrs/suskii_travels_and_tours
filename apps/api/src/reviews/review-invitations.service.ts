import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import { BookingNotifications } from '../bookings/booking-notifications';
import {
  BOOKING_INCLUDE,
  type BookingItemRecord,
  type BookingRecord,
} from '../bookings/booking-presenter';
import { bookingUrl } from '../bookings/booking-urls';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../infra/prisma.service';
import { reviewInvitationMessage } from '../messaging/messages';
import { NotificationService } from '../messaging/notification.service';

import type { reviewInvitationRunSchema } from './reviews.schemas';
import { addDays, reviewableItem, todayUtc, type ReviewableItem } from './reviews.service';

const DAY_MS = 86_400_000;
const BATCH = 200;
/** Invitations go out in the morning, Lagos time (UTC+1), the day after the trip ends. */
const SEND_HOUR_UTC = 8;

/**
 * Review invitations (ADR-077), run by the worker. Two passes keep the scan bounded:
 *
 * 1. Plan: each confirmed booking gets `review_invite_at`, the morning after its first
 *    reviewable item ends, or is marked handled when nothing in it can be reviewed.
 * 2. Send: bookings whose time has come are claimed (`review_invited_at`) and invited once:
 *    account holders through their notification preferences (`review_requests`), guests by one
 *    email to the booking contact with an access link. Trips whose window has closed are marked
 *    handled without a message.
 */
@Injectable()
export class ReviewInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly bookingNotifications: BookingNotifications,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async run(now = new Date()): Promise<z.infer<typeof reviewInvitationRunSchema>> {
    const planned = await this.plan(now);
    const { sent, skipped } = await this.send(now);
    return { planned, sent, skipped };
  }

  private firstReviewable(
    booking: Pick<BookingRecord, 'status'> & { items: BookingItemRecord[] },
    today: string,
  ): ReviewableItem | null {
    const reviewable = booking.items
      .map((item) => reviewableItem(booking, item, this.config.REVIEW_WINDOW_DAYS, today))
      .filter((entry): entry is ReviewableItem => entry !== null)
      .sort((a, b) => a.endsOn.localeCompare(b.endsOn));
    return reviewable[0] ?? null;
  }

  private async plan(now: Date): Promise<number> {
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        reviewInviteAt: null,
        reviewInvitedAt: null,
        // Older confirmations ended long ago; bound the scan.
        confirmedAt: { gt: new Date(now.getTime() - 400 * DAY_MS) },
      },
      select: { id: true, status: true, items: { orderBy: { createdAt: 'asc' } } },
      orderBy: { confirmedAt: 'asc' },
      take: BATCH,
    });
    const today = todayUtc(now);
    for (const booking of bookings) {
      const first = this.firstReviewable(booking, today);
      await this.prisma.booking.updateMany({
        where: { id: booking.id, reviewInviteAt: null, reviewInvitedAt: null },
        data: first
          ? {
              reviewInviteAt: new Date(
                Date.parse(`${addDays(first.endsOn, 1)}T00:00:00Z`) + SEND_HOUR_UTC * 3_600_000,
              ),
            }
          : { reviewInvitedAt: now },
      });
    }
    return bookings.length;
  }

  private async send(now: Date): Promise<{ sent: number; skipped: number }> {
    const due = await this.prisma.booking.findMany({
      where: { status: 'CONFIRMED', reviewInvitedAt: null, reviewInviteAt: { lte: now } },
      include: BOOKING_INCLUDE,
      orderBy: { reviewInviteAt: 'asc' },
      take: BATCH,
    });
    const today = todayUtc(now);
    let sent = 0;
    let skipped = 0;
    for (const booking of due) {
      // Claim it first, so two runs never invite twice.
      const claimed = await this.prisma.booking.updateMany({
        where: { id: booking.id, reviewInvitedAt: null },
        data: { reviewInvitedAt: now },
      });
      if (claimed.count !== 1) continue;
      const already = new Set(
        (
          await this.prisma.review.findMany({
            where: { bookingId: booking.id },
            select: { bookingItemId: true },
          })
        ).map((review) => review.bookingItemId),
      );
      const open = booking.items
        .map((item) => reviewableItem(booking, item, this.config.REVIEW_WINDOW_DAYS, today))
        .filter((entry): entry is ReviewableItem => entry?.canReview === true)
        .filter((entry) => !already.has(entry.item.id));
      const first = open[0];
      if (!first) {
        skipped += 1;
        continue;
      }
      if (booking.userId) {
        await this.notifications.notify(
          booking.userId,
          reviewInvitationMessage({
            reference: booking.reference,
            name: first.ref.name,
            reviewUrl: bookingUrl(this.config, booking.id),
            bookingId: booking.id,
          }),
        );
      } else {
        await this.bookingNotifications.reviewInvitation(
          booking.id,
          first.ref.name,
          first.windowEndsOn,
        );
      }
      await this.audit.record({
        action: 'review.invitation_sent',
        actorType: 'system',
        targetType: 'booking',
        targetId: booking.id,
        metadata: { items: open.length },
      });
      sent += 1;
    }
    return { sent, skipped };
  }
}
