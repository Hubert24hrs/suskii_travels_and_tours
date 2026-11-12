import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import type { ReviewFlag, ReviewRejectReason } from '@suskii/shared';

import type { StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import type {
  adminReviewPageSchema,
  adminReviewQuerySchema,
  adminReviewSchema,
} from './reviews.schemas';
import { reviewClosed } from './reviews.service';

type AdminReview = z.infer<typeof adminReviewSchema>;

const include = {
  subject: { select: { id: true, kind: true, name: true } },
  booking: { select: { reference: true } },
} as const;
type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof include }>;

function present(row: ReviewRow): AdminReview {
  return {
    id: row.id,
    status: row.status,
    subject: row.subject,
    bookingId: row.bookingId,
    bookingReference: row.booking.reference,
    rating: row.rating,
    title: row.title,
    liked: row.liked,
    disliked: row.disliked,
    tripType: row.tripType,
    displayName: row.displayName,
    locale: row.locale,
    travelledOn: row.travelledOn,
    flags: row.flags as ReviewFlag[],
    rejectReason: row.rejectReason as ReviewRejectReason | null,
    moderatedByUserId: row.moderatedById,
    moderatedAt: row.moderatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The review moderation queue (ADR-077). A moderator publishes a review as written or rejects it
 * with a reason code; nobody edits it. Each decision is claimed with a conditional update, so two
 * moderators cannot both decide, updates the subject's totals in the same transaction and is
 * audited.
 */
@Injectable()
export class ReviewModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Waiting reviews oldest first, so none sits forever; decided ones newest first. */
  async list(
    query: z.infer<typeof adminReviewQuerySchema>,
  ): Promise<z.infer<typeof adminReviewPageSchema>> {
    const oldestFirst = query.status === 'pending';
    const rows = await this.prisma.review.findMany({
      where: {
        status: query.status,
        ...(query.cursor ? { id: oldestFirst ? { gt: query.cursor } : { lt: query.cursor } } : {}),
      },
      include,
      orderBy: { id: oldestFirst ? 'asc' : 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(present),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async publish(id: string, staff: StaffActor): Promise<AdminReview> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const review = await this.claim(tx, id, {
        status: 'published',
        publishedAt: now,
        moderatedAt: now,
        moderatedById: staff.userId,
      });
      await tx.reviewSubject.update({
        where: { id: review.subjectId },
        data: { ratingSum: { increment: review.rating }, ratingCount: { increment: 1 } },
      });
      await this.audit.record(
        {
          action: 'review.published',
          actorUserId: staff.userId,
          targetType: 'review',
          targetId: id,
          context: staff.context,
          metadata: { subjectId: review.subjectId, rating: review.rating },
        },
        tx,
      );
      return present(review);
    });
  }

  async reject(id: string, reason: ReviewRejectReason, staff: StaffActor): Promise<AdminReview> {
    return this.prisma.$transaction(async (tx) => {
      const review = await this.claim(tx, id, {
        status: 'rejected',
        rejectReason: reason,
        moderatedAt: new Date(),
        moderatedById: staff.userId,
      });
      await this.audit.record(
        {
          action: 'review.rejected',
          actorUserId: staff.userId,
          targetType: 'review',
          targetId: id,
          context: staff.context,
          metadata: { subjectId: review.subjectId, reason },
        },
        tx,
      );
      return present(review);
    });
  }

  private async claim(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.ReviewUpdateManyMutationInput,
  ): Promise<ReviewRow> {
    const existing = await tx.review.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException();
    const claimed = await tx.review.updateMany({ where: { id, status: 'pending' }, data });
    if (claimed.count !== 1) throw reviewClosed();
    return tx.review.findUniqueOrThrow({ where: { id }, include });
  }
}
