import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  canApprove,
  seesAllCompanyBookings,
  type ApprovalRejectReason,
  type BookingStatus,
  type PolicyFinding,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { toBookingSummary } from '../bookings/booking-presenter';
import { BookingTransitions } from '../bookings/booking-transitions';
import { bookingUrl } from '../bookings/booking-urls';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { companyApprovalDecisionMessage } from '../messaging/messages';
import { NotificationService } from '../messaging/notification.service';

import type {
  companyBookingPageSchema,
  companyBookingQuerySchema,
  companyBookingSchema,
  companySpendQuerySchema,
  companySpendSchema,
} from './companies.schemas';
import { CompaniesService, type Membership } from './companies.service';

type CompanyBookingView = z.infer<typeof companyBookingSchema>;
type SpendView = z.infer<typeof companySpendSchema>;

const DAY_MS = 86_400_000;
/** Spend counts bookings whose money is committed (ADR-078). */
export const SPEND_STATUSES: readonly BookingStatus[] = [
  'PARTIALLY_PAID',
  'PAID',
  'TICKETING',
  'CONFIRMED',
];
/** An approval can only be decided while nothing has been paid. */
const DECIDABLE_STATUSES: readonly BookingStatus[] = ['PRICED', 'HELD', 'AWAITING_PAYMENT'];
/** Rows in one CSV export; a wider range is cut to the newest. */
export const CSV_MAX_ROWS = 5000;

export const approvalNotPending = () =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'approval-not-pending',
    'This trip is not waiting for approval',
    'It was decided already, paid, cancelled or it expired.',
  );
export const approverRequired = () =>
  new ProblemDetailsException(
    HttpStatus.FORBIDDEN,
    'company-approver-required',
    'Only an approver or admin can decide on trips',
  );
export const ownTripApproval = () =>
  new ProblemDetailsException(
    HttpStatus.FORBIDDEN,
    'approval-own-trip',
    'You cannot decide on your own trip',
    'Another approver or admin of the company decides.',
  );

const SUMMARY_SELECT = {
  id: true,
  reference: true,
  status: true,
  vertical: true,
  createdAt: true,
  totalMinor: true,
  currency: true,
  userId: true,
  approvalStatus: true,
  approvalRejectReason: true,
  policyFindings: true,
  user: { select: { displayName: true } },
  passengers: {
    select: { givenNames: true, surname: true },
    orderBy: { position: 'asc' },
    take: 1,
  },
  items: { select: { payload: true }, take: 1, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BookingSelect;

type SummaryRow = Prisma.BookingGetPayload<{ select: typeof SUMMARY_SELECT }>;

const fullName = (passenger: { givenNames: string; surname: string } | undefined): string | null =>
  passenger ? `${passenger.givenNames} ${passenger.surname}`.trim() : null;

/** The calendar day `days` before or after `date` (YYYY-MM-DD, UTC). */
const shiftDay = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Spreadsheet formulas cannot start a cell (CSV injection); quotes are doubled. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r']/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Company trips (ADR-078): the company's bookings as each role may see them, approval of trips
 * the policy holds back, and spend reports. Bookings are always looked up inside the caller's own
 * company; anything else answers 404.
 */
@Injectable()
export class CompanyTripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly transitions: BookingTransitions,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private visible({ member, company }: Membership): Prisma.BookingWhereInput {
    return {
      companyId: company.id,
      status: { not: 'DRAFT' },
      ...(seesAllCompanyBookings(member.role) ? {} : { userId: member.userId }),
    };
  }

  private present(row: SummaryRow, membership: Membership): CompanyBookingView | null {
    const summary = toBookingSummary(row);
    if (!summary) return null;
    const own = row.userId === membership.member.userId;
    return {
      ...summary,
      travellerName: fullName(row.passengers[0]),
      bookerName: row.user?.displayName ?? null,
      bookedByMe: own,
      approvalStatus: row.approvalStatus,
      approvalRejectReason: (row.approvalRejectReason as ApprovalRejectReason | null) ?? null,
      policyFindings: row.policyFindings as PolicyFinding[],
      canDecide:
        canApprove(membership.member.role) &&
        !own &&
        row.approvalStatus === 'pending' &&
        DECIDABLE_STATUSES.includes(row.status),
    };
  }

  /** Company bookings, newest first: every one for admins and approvers, their own for others. */
  async list(
    userId: string,
    query: z.infer<typeof companyBookingQuerySchema>,
  ): Promise<z.infer<typeof companyBookingPageSchema>> {
    const membership = await this.companies.requireMembership(userId);
    const rows = await this.prisma.booking.findMany({
      where: {
        ...this.visible(membership),
        ...(query.approval === 'pending'
          ? { approvalStatus: 'pending', status: { in: [...DECIDABLE_STATUSES] } }
          : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: SUMMARY_SELECT,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.flatMap((row) => this.present(row, membership) ?? []),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async approve(
    userId: string,
    bookingId: string,
    context: RequestContext,
  ): Promise<CompanyBookingView> {
    return this.decide(userId, bookingId, { approved: true }, context);
  }

  async reject(
    userId: string,
    bookingId: string,
    reason: ApprovalRejectReason,
    context: RequestContext,
  ): Promise<CompanyBookingView> {
    return this.decide(userId, bookingId, { approved: false, reason }, context);
  }

  /**
   * Approves or rejects a waiting trip. The decision is claimed with a conditional update, so two
   * approvers cannot both decide; rejecting cancels the unpaid booking through the state machine.
   */
  private async decide(
    userId: string,
    bookingId: string,
    decision: { approved: true } | { approved: false; reason: ApprovalRejectReason },
    context: RequestContext,
  ): Promise<CompanyBookingView> {
    const membership = await this.companies.requireMembership(userId);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, ...this.visible(membership) },
      select: { id: true, reference: true, status: true, userId: true, approvalStatus: true },
    });
    if (!booking) throw new NotFoundException();
    if (!canApprove(membership.member.role)) throw approverRequired();
    if (booking.userId === userId) throw ownTripApproval();
    if (booking.approvalStatus !== 'pending' || !DECIDABLE_STATUSES.includes(booking.status)) {
      throw approvalNotPending();
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: {
          id: booking.id,
          approvalStatus: 'pending',
          status: { in: [...DECIDABLE_STATUSES] },
        },
        data: {
          approvalStatus: decision.approved ? 'approved' : 'rejected',
          approvalDecidedById: userId,
          approvalDecidedAt: now,
          approvalRejectReason: decision.approved ? null : decision.reason,
        },
      });
      if (claimed.count !== 1) throw approvalNotPending();
      if (!decision.approved) {
        await tx.payment.updateMany({
          where: { bookingId: booking.id, status: 'pending' },
          data: { status: 'cancelled' },
        });
        await this.transitions.apply(
          tx,
          booking,
          'cancel',
          { type: 'customer', userId, context },
          { reason: 'company_rejected', data: { pendingPrice: Prisma.DbNull } },
        );
      }
      await this.audit.record(
        {
          action: decision.approved ? 'company.trip_approved' : 'company.trip_rejected',
          actorUserId: userId,
          targetType: 'booking',
          targetId: booking.id,
          context,
          metadata: {
            companyId: membership.company.id,
            ...(decision.approved ? {} : { reason: decision.reason }),
          },
        },
        tx,
      );
    });
    if (booking.userId) {
      await this.notifications.notify(
        booking.userId,
        companyApprovalDecisionMessage({
          reference: booking.reference,
          approved: decision.approved,
          bookingUrl: bookingUrl(this.config, booking.id),
          bookingId: booking.id,
        }),
      );
    }
    const row = await this.prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: SUMMARY_SELECT,
    });
    const view = this.present(row, membership);
    if (!view) throw new NotFoundException();
    return view;
  }

  // -------------------------------------------------------------------------
  // Reports (admins and approvers)
  // -------------------------------------------------------------------------

  private async requireReporter(userId: string): Promise<Membership> {
    const membership = await this.companies.requireMembership(userId);
    if (!seesAllCompanyBookings(membership.member.role)) throw approverRequired();
    return membership;
  }

  /** The inclusive date range of a report: a year up to today unless the caller chose one. */
  private range(query: z.infer<typeof companySpendQuerySchema>, now: Date) {
    const to = query.to ?? now.toISOString().slice(0, 10);
    const from = query.from ?? shiftDay(to, -365);
    return {
      from,
      to,
      start: new Date(`${from}T00:00:00Z`),
      end: new Date(`${shiftDay(to, 1)}T00:00:00Z`),
    };
  }

  /** Committed spend by month and by lead traveller, one line per currency (ADR-078). */
  async spend(userId: string, query: z.infer<typeof companySpendQuerySchema>): Promise<SpendView> {
    const { company } = await this.requireReporter(userId);
    const { from, to, start, end } = this.range(query, new Date());
    const statuses = [...SPEND_STATUSES];
    const [byMonth, byTraveller] = await Promise.all([
      this.prisma.$queryRaw<{ month: string; currency: string; total: bigint; bookings: number }[]>`
        SELECT to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
               b.currency,
               SUM(b.total_minor)::bigint AS total,
               COUNT(*)::int AS bookings
          FROM bookings b
         WHERE b.company_id = ${company.id}::uuid
           AND b.status::text = ANY(${statuses})
           AND b.created_at >= ${start} AND b.created_at < ${end}
         GROUP BY 1, 2
         ORDER BY 1, 2`,
      this.prisma.$queryRaw<
        { traveller: string; currency: string; total: bigint; bookings: number }[]
      >`
        SELECT COALESCE(p.given_names || ' ' || p.surname, '') AS traveller,
               b.currency,
               SUM(b.total_minor)::bigint AS total,
               COUNT(*)::int AS bookings
          FROM bookings b
          LEFT JOIN booking_passengers p ON p.booking_id = b.id AND p.position = 0
         WHERE b.company_id = ${company.id}::uuid
           AND b.status::text = ANY(${statuses})
           AND b.created_at >= ${start} AND b.created_at < ${end}
         GROUP BY 1, 2
         ORDER BY 3 DESC, 1
         LIMIT 200`,
    ]);
    const totals = new Map<string, { total: bigint; bookings: number }>();
    for (const line of byMonth) {
      const current = totals.get(line.currency) ?? { total: 0n, bookings: 0 };
      totals.set(line.currency, {
        total: current.total + line.total,
        bookings: current.bookings + line.bookings,
      });
    }
    const wire = (total: bigint, currency: string) => ({
      amountMinor: Number(total),
      currency,
    });
    return {
      from,
      to,
      byMonth: byMonth.map((line) => ({
        month: line.month,
        total: wire(line.total, line.currency),
        bookings: line.bookings,
      })),
      byTraveller: byTraveller.map((line) => ({
        travellerName: line.traveller,
        total: wire(line.total, line.currency),
        bookings: line.bookings,
      })),
      totals: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, line]) => ({
          total: wire(line.total, currency),
          bookings: line.bookings,
        })),
    };
  }

  /**
   * Every company booking in the range as CSV for the company's accountant: amounts in minor
   * units with their currency, no contact or passport details.
   */
  async csv(
    userId: string,
    query: z.infer<typeof companySpendQuerySchema>,
  ): Promise<{ fileName: string; bytes: Buffer }> {
    const membership = await this.requireReporter(userId);
    const { from, to, start, end } = this.range(query, new Date());
    const rows = await this.prisma.booking.findMany({
      where: { ...this.visible(membership), createdAt: { gte: start, lt: end } },
      orderBy: { id: 'desc' },
      take: CSV_MAX_ROWS,
      select: SUMMARY_SELECT,
    });
    const header = [
      'reference',
      'booked_at',
      'product',
      'starts_on',
      'ends_on',
      'traveller',
      'booked_by',
      'status',
      'approval',
      'policy_findings',
      'currency',
      'total_minor',
    ];
    const lines = [header.join(',')];
    for (const row of rows) {
      const view = this.present(row, membership);
      if (!view) continue;
      lines.push(
        [
          view.reference,
          view.createdAt,
          productLabel(view),
          view.startsOn,
          view.endsOn,
          view.travellerName,
          view.bookerName,
          view.status,
          view.approvalStatus,
          view.policyFindings.join(' '),
          view.total.currency,
          view.total.amountMinor,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return {
      fileName: `company-bookings-${from}-to-${to}.csv`,
      // A byte order mark so spreadsheet programs read the names as UTF-8.
      bytes: Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8'),
    };
  }
}

/** What a booking is, in a few words: the route, the hotel or the product's title. */
export function productLabel(view: CompanyBookingView): string {
  if (view.flight)
    return `${view.flight.origin.code}-${view.flight.destination.code} ${view.flight.airline}`;
  if (view.hotel) return `${view.hotel.name}, ${view.hotel.cityName}`;
  return view.product?.title ?? view.vertical;
}
