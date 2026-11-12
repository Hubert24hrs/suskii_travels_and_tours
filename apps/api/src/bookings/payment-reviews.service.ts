import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import { money, toWire } from '@suskii/shared';

import { conflict, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { BookingTransitions } from './booking-transitions';
import type {
  adminPaymentReviewPageSchema,
  adminPaymentReviewQuerySchema,
  adminPaymentReviewSchema,
  PAYMENT_REVIEW_REJECT_REASONS,
} from './payment-reviews.schemas';
import type { RiskSignal } from './payment-risk.service';
import { RefundsService } from './refunds.service';
import { TicketingService } from './ticketing.service';

type Review = z.infer<typeof adminPaymentReviewSchema>;
const include = {
  booking: { select: { reference: true, items: { select: { heldUntil: true } } } },
  payment: { select: { provider: true, amountMinor: true, currency: true } },
} as const;
type ReviewRow = Prisma.PaymentRiskReviewGetPayload<{ include: typeof include }>;

function present(row: ReviewRow): Review {
  const holds = row.booking.items.flatMap((item) => (item.heldUntil ? [item.heldUntil] : []));
  const heldUntil = holds.length > 0 ? new Date(Math.min(...holds.map((d) => d.getTime()))) : null;
  return {
    id: row.id,
    bookingId: row.bookingId,
    bookingReference: row.booking.reference,
    paymentId: row.paymentId,
    provider: row.payment.provider,
    amount: toWire(money(row.payment.amountMinor, row.payment.currency)),
    score: row.score,
    signals: row.signals as RiskSignal[],
    status: row.status,
    reason: row.reason,
    decidedByUserId: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    heldUntil: heldUntil?.toISOString() ?? null,
  };
}

const reviewClosed = () => conflict('payment-review-closed', 'This review was already decided');

/**
 * The payment risk review queue (ADR-040). Approving releases the held booking to fulfilment;
 * rejecting refunds everything it paid and moves it to REFUND_PENDING. Each decision is claimed
 * with a conditional update, so two staff members cannot both decide, and is audited.
 */
@Injectable()
export class PaymentReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: BookingTransitions,
    private readonly refunds: RefundsService,
    private readonly ticketing: TicketingService,
    private readonly background: BackgroundTasks,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: z.infer<typeof adminPaymentReviewQuerySchema>,
  ): Promise<z.infer<typeof adminPaymentReviewPageSchema>> {
    const rows = await this.prisma.paymentRiskReview.findMany({
      where: { status: query.status, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
      include,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(present),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async approve(id: string, staff: StaffActor): Promise<Review> {
    const review = await this.prisma.$transaction(async (tx) => {
      const claimed = await this.claim(tx, id, 'approved', 'verified', staff);
      await this.audit.record(
        {
          action: 'payment_risk.approved',
          actorUserId: staff.userId,
          targetType: 'booking',
          targetId: claimed.bookingId,
          context: staff.context,
          metadata: { reviewId: id },
        },
        tx,
      );
      return claimed;
    });
    this.background.run('ticketing', () => this.ticketing.process(review.bookingId));
    return present(review);
  }

  async reject(
    id: string,
    reason: (typeof PAYMENT_REVIEW_REJECT_REASONS)[number],
    staff: StaffActor,
  ): Promise<Review> {
    const { review, refundIds } = await this.prisma.$transaction(async (tx) => {
      const claimed = await this.claim(tx, id, 'rejected', reason, staff);
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${claimed.bookingId}::uuid FOR UPDATE`;
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: claimed.bookingId } });
      if (booking.status !== 'PAID') {
        throw conflict('booking-moved-on', 'The booking is no longer waiting for this review');
      }
      await this.transitions.apply(
        tx,
        booking,
        'request_refund',
        { type: 'staff', userId: staff.userId, context: staff.context },
        { reason: 'risk_rejected' },
      );
      const ids = await this.refunds.refundBookingBalance(tx, booking, 'risk_rejected');
      await this.audit.record(
        {
          action: 'payment_risk.rejected',
          actorUserId: staff.userId,
          targetType: 'booking',
          targetId: booking.id,
          context: staff.context,
          metadata: { reviewId: id, reason, refunds: ids.length },
        },
        tx,
      );
      return { review: claimed, refundIds: ids };
    });
    this.refunds.executeLater(refundIds);
    return present(review);
  }

  private async claim(
    tx: Prisma.TransactionClient,
    id: string,
    status: 'approved' | 'rejected',
    reason: string,
    staff: StaffActor,
  ): Promise<ReviewRow> {
    const existing = await tx.paymentRiskReview.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException();
    const claimed = await tx.paymentRiskReview.updateMany({
      where: { id, status: 'open' },
      data: { status, reason, decidedById: staff.userId, decidedAt: new Date() },
    });
    if (claimed.count !== 1) throw reviewClosed();
    return tx.paymentRiskReview.findUniqueOrThrow({ where: { id }, include });
  }
}
