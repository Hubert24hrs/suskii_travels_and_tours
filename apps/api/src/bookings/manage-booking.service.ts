import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { TurnstileVerifier } from '../bot-protection/turnstile';
import type { RequestContext } from '../common/request-context';
import { HmacService } from '../crypto/hmac.service';
import { PrismaService } from '../infra/prisma.service';
import { EmailProvider } from '../notifications/email';
import { bookingLinkTemplate } from '../notifications/templates';

import { botCheckFailed } from './booking.errors';
import { BookingNotifications } from './booking-notifications';
import type { BookingLinkRequest } from './bookings.schemas';
import { BookingsService } from './bookings.service';

/**
 * "Manage booking" on the website: a traveller who no longer has the booking page asks for its
 * link by reference and contact email. The answer is the same whether or not they match, so the
 * route tells nobody which bookings exist; only the booking's own contact address receives the
 * link. Guests get a fresh access link (valid for a day, ADR-015); bookings made while signed in
 * get the plain page, which asks for that account.
 */
@Injectable()
export class ManageBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
    private readonly turnstile: TurnstileVerifier,
    private readonly email: EmailProvider,
    private readonly bookings: BookingsService,
    private readonly notifications: BookingNotifications,
    private readonly audit: AuditService,
  ) {}

  async requestLink(input: BookingLinkRequest, context: RequestContext): Promise<void> {
    const human = await this.turnstile.verify(input.turnstileToken, {
      remoteIp: context.ip,
      action: 'manage-booking',
    });
    if (!human) throw botCheckFailed();
    const booking = await this.prisma.booking.findUnique({
      where: { reference: input.reference },
      select: { id: true, userId: true, contactEmailHash: true, redactedAt: true },
    });
    if (
      !booking ||
      booking.redactedAt ||
      !this.hmac.verify('booking-email', input.email, booking.contactEmailHash)
    ) {
      return;
    }
    // `link` keeps a guest's access link for a day after the date it is given.
    const url = await this.notifications.link(booking, 'manage-booking', new Date());
    const contact = this.bookings.contact(await this.bookings.reload(booking.id));
    await this.email.send({
      to: contact.email,
      ...bookingLinkTemplate({ reference: input.reference, url, signIn: booking.userId !== null }),
    });
    await this.audit.record({
      action: 'booking.link_sent',
      actorUserId: null,
      targetType: 'booking',
      targetId: booking.id,
      context,
      metadata: {},
    });
  }
}
