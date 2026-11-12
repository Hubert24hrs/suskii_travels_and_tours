import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { itemPayload } from '../bookings/booking-presenter';
import { bookingUrl } from '../bookings/booking-urls';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../infra/prisma.service';
import { checkinReminderMessage, primeExpiryMessage } from '../messaging/messages';
import { NotificationService } from '../messaging/notification.service';
import { currentPrime } from '../prime/prime-status';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BATCH = 500;

/**
 * Scheduled reminders for account holders (ADR-030, ADR-032): online check-in the day before a
 * confirmed flight, and the end of a Suskii Prime membership a few days ahead (it never renews by
 * itself). Each goes once, through the dispatcher and the traveller's channel choices.
 */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  async run(now = new Date()): Promise<{ checkin: number; prime: number }> {
    return { checkin: await this.checkin(now), prime: await this.prime(now) };
  }

  /** Confirmed account flights departing within 24 hours, not reminded yet. */
  private async checkin(now: Date): Promise<number> {
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        vertical: 'flights',
        userId: { not: null },
        checkinRemindedAt: null,
        // Older confirmations have flown long ago; bound the scan.
        confirmedAt: { gt: new Date(now.getTime() - 400 * DAY_MS) },
      },
      select: {
        id: true,
        userId: true,
        reference: true,
        items: { select: { payload: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
      orderBy: { confirmedAt: 'asc' },
      take: BATCH,
    });
    let sent = 0;
    for (const booking of bookings) {
      const item = booking.items[0];
      const payload = item ? itemPayload(item) : null;
      if (payload?.kind !== 'flight' || !booking.userId) continue;
      const first = payload.offer.slices[0];
      if (!first) continue;
      const departs = Date.parse(first.departureUtc);
      if (departs <= now.getTime() || departs - now.getTime() > DAY_MS) continue;
      // Claim it first, so two runs never remind twice.
      const claimed = await this.prisma.booking.updateMany({
        where: { id: booking.id, checkinRemindedAt: null },
        data: { checkinRemindedAt: now },
      });
      if (claimed.count !== 1) continue;
      await this.notifications.notify(
        booking.userId,
        checkinReminderMessage({
          reference: booking.reference,
          route: `${first.origin.code} to ${first.destination.code}`,
          departureLocal: first.departureLocal,
          bookingUrl: bookingUrl(this.config, booking.id),
          bookingId: booking.id,
        }),
      );
      await this.audit.record({
        action: 'reminder.checkin_sent',
        actorType: 'system',
        targetType: 'booking',
        targetId: booking.id,
      });
      sent += 1;
    }
    return sent;
  }

  /** Members whose last paid term ends within PRIME_REMINDER_DAYS. */
  private async prime(now: Date): Promise<number> {
    const horizon = new Date(now.getTime() + this.config.PRIME_REMINDER_DAYS * DAY_MS);
    const terms = await this.prisma.primeMembership.findMany({
      where: {
        status: 'active',
        reminderSentAt: null,
        endsAt: { gt: now, lte: horizon },
        user: { status: 'active' },
      },
      include: { plan: { select: { name: true } } },
      take: BATCH,
    });
    let sent = 0;
    for (const term of terms) {
      const status = await currentPrime(this.prisma, term.userId, now);
      // A later term (bought ahead) means this is not the end: no reminder for it.
      if (status?.until.getTime() !== term.endsAt.getTime()) continue;
      const claimed = await this.prisma.primeMembership.updateMany({
        where: { id: term.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claimed.count !== 1) continue;
      await this.notifications.notify(
        term.userId,
        primeExpiryMessage({
          planName: term.plan.name,
          until: term.endsAt,
          primeUrl: `${this.config.WEB_APP_URL}/prime`,
        }),
      );
      await this.audit.record({
        action: 'reminder.prime_sent',
        actorType: 'system',
        targetType: 'prime_membership',
        targetId: term.id,
      });
      sent += 1;
    }
    return sent;
  }
}
