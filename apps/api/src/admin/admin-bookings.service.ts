import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { emailSchema, money, toWire } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { toBookingSummary } from '../bookings/booking-presenter';
import { BookingNotesService, type BookingNoteView } from '../bookings/booking-notes.service';
import { BookingsService, REDACTED_CONTACT } from '../bookings/bookings.service';
import { TicketingService } from '../bookings/ticketing.service';
import { ProblemDetailsException } from '../common/problem-details';
import { HmacService } from '../crypto/hmac.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type {
  adminBookingContactSchema,
  adminBookingDetailSchema,
  adminBookingPageSchema,
  adminBookingQuerySchema,
} from './admin-bookings.schemas';
import type { StaffActor } from './admin-helpers';

type Query = z.infer<typeof adminBookingQuerySchema>;
type Page = z.infer<typeof adminBookingPageSchema>;
type Detail = z.infer<typeof adminBookingDetailSchema>;
type Contact = z.infer<typeof adminBookingContactSchema>;

const REFERENCE = /^[A-Z0-9]{6}$/;
const DAY_MS = 86_400_000;

/**
 * Bookings for staff (phase 10): search, the full record with its timeline and notes, contact
 * details revealed on purpose (audited), and the confirmation email sent again.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly notes: BookingNotesService,
    private readonly ticketing: TicketingService,
    private readonly hmac: HmacService,
    private readonly audit: AuditService,
  ) {}

  async list(query: Query): Promise<Page> {
    const where: Prisma.BookingWhereInput = {
      status: query.status ?? { not: 'DRAFT' },
      ...(query.vertical ? { vertical: query.vertical } : {}),
      ...this.search(query.q),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to
                ? { lt: new Date(Date.parse(`${query.to}T00:00:00.000Z`) + DAY_MS) }
                : {}),
            },
          }
        : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };
    const rows = await this.prisma.booking.findMany({
      where,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: {
        id: true,
        reference: true,
        status: true,
        vertical: true,
        createdAt: true,
        totalMinor: true,
        currency: true,
        userId: true,
        items: { select: { payload: true }, take: 1, orderBy: { createdAt: 'asc' } },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        vertical: row.vertical,
        createdAt: row.createdAt.toISOString(),
        total: toWire(money(row.totalMinor, row.currency)),
        accountId: row.userId,
        trip: toBookingSummary(row),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** A reference matches exactly; anything with an @ is a contact email, matched by its HMAC. */
  private search(q: string | undefined): Prisma.BookingWhereInput {
    if (!q) return {};
    const upper = q.toUpperCase();
    if (REFERENCE.test(upper)) return { reference: upper };
    const email = emailSchema.safeParse(q);
    if (email.success) {
      return { contactEmailHash: this.hmac.digest('booking-email', email.data) };
    }
    // Neither a reference nor an email: nothing can match.
    return { id: { in: [] } };
  }

  async detail(bookingId: string): Promise<Detail> {
    const booking = await this.find(bookingId);
    const [history, notes, payments] = await Promise.all([
      this.prisma.bookingStatusHistory.findMany({
        where: { bookingId },
        orderBy: { occurredAt: 'asc' },
      }),
      this.notes.list(bookingId),
      this.prisma.payment.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      booking: await this.bookings.present(booking),
      accountId: booking.userId,
      history: history.map((row) => ({
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        event: row.event,
        reason: row.reason,
        actorType: row.actorType,
        actorUserId: row.actorUserId,
        occurredAt: row.occurredAt.toISOString(),
      })),
      notes,
      payments: payments.map((payment) => ({
        id: payment.id,
        kind: payment.kind,
        provider: payment.provider,
        status: payment.status,
        method: payment.method,
        amount: toWire(money(payment.amountMinor, payment.currency)),
        createdAt: payment.createdAt.toISOString(),
        succeededAt: payment.succeededAt?.toISOString() ?? null,
      })),
    };
  }

  addNote(bookingId: string, staff: StaffActor, text: string): Promise<BookingNoteView> {
    return this.find(bookingId).then(() => this.notes.add(bookingId, staff, text));
  }

  /** Unmasked contact details for a support call or email; every reveal is audited. */
  async revealContact(bookingId: string, staff: StaffActor): Promise<Contact> {
    const booking = await this.find(bookingId);
    const contact = this.bookings.contact(booking);
    await this.audit.record({
      action: 'booking.contact_revealed',
      actorUserId: staff.userId,
      targetType: 'booking',
      targetId: bookingId,
      context: staff.context,
      metadata: {},
    });
    return { ...contact, redacted: contact === REDACTED_CONTACT };
  }

  async resendConfirmation(bookingId: string, staff: StaffActor): Promise<void> {
    const booking = await this.find(bookingId);
    if (booking.status !== 'CONFIRMED') {
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'booking-not-confirmed',
        'Only confirmed bookings have a confirmation to resend',
      );
    }
    if (booking.redactedAt) {
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'booking-redacted',
        'The owner deleted their account; there is no address to send to',
      );
    }
    await this.ticketing.sendConfirmationEmail(bookingId);
    await this.audit.record({
      action: 'booking.confirmation_resent',
      actorUserId: staff.userId,
      targetType: 'booking',
      targetId: bookingId,
      context: staff.context,
      metadata: {},
    });
  }

  private async find(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException();
    return this.bookings.reload(bookingId);
  }
}
