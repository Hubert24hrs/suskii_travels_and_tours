import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  REVIEW_PAGE_SIZE,
  reviewDisplayName,
  reviewFlags,
  type ReviewableItemKind,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import {
  itemPayload,
  type BookingItemRecord,
  type BookingRecord,
} from '../bookings/booking-presenter';
import type { ItemPayload } from '../bookings/booking-pricing';
import { BookingsService, type BookingCaller } from '../bookings/bookings.service';
import { tripFacts } from '../bookings/trip-facts';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { Prisma, type Review } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import {
  findOrCreateSubject,
  reviewableKind,
  subjectRefOf,
  type SubjectRef,
} from './review-subjects';
import { presentSummary } from './review-summary';
import type {
  bookingReviewsSchema,
  ownReviewSchema,
  publicReviewSchema,
  reviewPageQuerySchema,
  reviewPageSchema,
  writeReviewSchema,
} from './reviews.schemas';

type OwnReview = z.infer<typeof ownReviewSchema>;
type PublicReview = z.infer<typeof publicReviewSchema>;
type Caller = Pick<BookingCaller, 'client' | 'token' | 'context'>;

const DAY_MS = 86_400_000;

export const notReviewable = () =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'review-not-eligible',
    'This trip cannot be reviewed',
    'Only a confirmed trip that has ended can be reviewed, within the review window.',
  );
export const reviewClosed = () =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'review-closed',
    'This review was already decided',
    'A published or rejected review can be withdrawn, not changed.',
  );

/** "YYYY-MM-DD" plus whole days, in UTC calendar arithmetic. */
export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const todayUtc = (now = new Date()): string => now.toISOString().slice(0, 10);

/** What a booking item offers for review (ADR-077); null for items that cannot be reviewed. */
export interface ReviewableItem {
  item: BookingItemRecord;
  payload: ItemPayload;
  kind: ReviewableItemKind;
  ref: SubjectRef;
  endsOn: string;
  windowEndsOn: string;
  canReview: boolean;
}

/**
 * The reviewable facts of a booking item: a confirmed booking, a trip that has ended (the day
 * after its end date, as account deletion counts it) and a window still open.
 */
export function reviewableItem(
  booking: Pick<BookingRecord, 'status'>,
  item: BookingItemRecord,
  windowDays: number,
  today: string,
): ReviewableItem | null {
  const payload = itemPayload(item);
  const kind = reviewableKind(payload);
  const ref = subjectRefOf(payload);
  const facts = tripFacts(payload);
  if (!kind || !ref || !facts) return null;
  const endsOn = facts.endDate;
  const windowEndsOn = addDays(endsOn, windowDays);
  const canReview = booking.status === 'CONFIRMED' && endsOn < today && today <= windowEndsOn;
  return { item, payload, kind, ref, endsOn, windowEndsOn, canReview };
}

export function presentOwn(review: Review): OwnReview {
  return {
    id: review.id,
    status: review.status,
    rating: review.rating,
    title: review.title,
    liked: review.liked,
    disliked: review.disliked,
    tripType: review.tripType,
    showName: review.displayName !== null,
    createdAt: review.createdAt.toISOString(),
    publishedAt: review.publishedAt?.toISOString() ?? null,
  };
}

function presentPublic(review: Review): PublicReview {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    liked: review.liked,
    disliked: review.disliked,
    tripType: review.tripType,
    displayName: review.displayName,
    locale: review.locale,
    travelledOn: review.travelledOn,
    publishedAt: (review.publishedAt ?? review.createdAt).toISOString(),
  };
}

/**
 * Verified reviews (ADR-077): a booking's owner or guest-link holder writes one review per
 * finished item; it waits for a moderator; published reviews are public. The booking is always
 * loaded through `BookingsService.load()`, so other people's bookings answer 404.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async forBooking(
    bookingId: string,
    caller: Caller,
  ): Promise<z.infer<typeof bookingReviewsSchema>> {
    const booking = await this.bookings.load(bookingId, caller);
    const reviews = await this.prisma.review.findMany({ where: { bookingId: booking.id } });
    const byItem = new Map(reviews.map((review) => [review.bookingItemId, review]));
    const today = todayUtc();
    return {
      items: booking.items.flatMap((item) => {
        const reviewable = reviewableItem(booking, item, this.config.REVIEW_WINDOW_DAYS, today);
        if (!reviewable) return [];
        const review = byItem.get(item.id);
        return [
          {
            itemId: item.id,
            kind: reviewable.kind,
            name: reviewable.ref.name,
            endsOn: reviewable.endsOn,
            canReview: reviewable.canReview,
            windowEndsOn: reviewable.windowEndsOn,
            review: review ? presentOwn(review) : null,
          },
        ];
      }),
    };
  }

  /** Writes the item's review, or changes it while it waits for a moderator. */
  async write(
    bookingId: string,
    itemId: string,
    input: z.infer<typeof writeReviewSchema>,
    caller: Caller,
    retried = false,
  ): Promise<OwnReview> {
    const booking = await this.bookings.load(bookingId, caller);
    const item = booking.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new NotFoundException();
    const reviewable = reviewableItem(booking, item, this.config.REVIEW_WINDOW_DAYS, todayUtc());
    if (!reviewable?.canReview) throw notReviewable();
    const lead = booking.passengers[0];
    const fields = {
      rating: input.rating,
      title: input.title,
      liked: input.liked,
      disliked: input.disliked,
      tripType: input.tripType,
      displayName: input.showName && lead ? reviewDisplayName(lead.givenNames, lead.surname) : null,
      locale: input.locale ?? booking.locale,
      flags: reviewFlags([input.title, input.liked, input.disliked]),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.review.findUnique({ where: { bookingItemId: item.id } });
        if (existing) {
          const changed = await tx.review.updateMany({
            where: { id: existing.id, status: 'pending' },
            data: fields,
          });
          if (changed.count !== 1) throw reviewClosed();
          return presentOwn(await tx.review.findUniqueOrThrow({ where: { id: existing.id } }));
        }
        const subject = await findOrCreateSubject(tx, reviewable.ref);
        const review = await tx.review.create({
          data: {
            ...fields,
            subjectId: subject.id,
            bookingId: booking.id,
            bookingItemId: item.id,
            userId: booking.userId,
            travelledOn: reviewable.endsOn.slice(0, 7),
          },
        });
        await this.audit.record(
          {
            action: 'review.submitted',
            actorUserId: caller.client.userId,
            targetType: 'review',
            targetId: review.id,
            context: caller.context,
            metadata: { bookingId: booking.id, itemId: item.id, subjectId: subject.id },
          },
          tx,
        );
        return presentOwn(review);
      });
    } catch (error) {
      // Two first submissions for one item at once: the unique key keeps one; the other retries
      // once as an update of the review that won.
      if (
        !retried &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.write(bookingId, itemId, input, caller, true);
      }
      throw error;
    }
  }

  /** Removes the traveller's review, whatever its status; a published one leaves the totals. */
  async withdraw(bookingId: string, itemId: string, caller: Caller): Promise<void> {
    const booking = await this.bookings.load(bookingId, caller);
    if (!booking.items.some((item) => item.id === itemId)) throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM reviews WHERE booking_item_id = ${itemId}::uuid FOR UPDATE`;
      if (!row) throw new NotFoundException();
      const review = await tx.review.delete({ where: { id: row.id } });
      if (review.status === 'published') {
        await tx.reviewSubject.update({
          where: { id: review.subjectId },
          data: { ratingSum: { decrement: review.rating }, ratingCount: { decrement: 1 } },
        });
      }
      await this.audit.record(
        {
          action: 'review.withdrawn',
          actorUserId: caller.client.userId,
          targetType: 'review',
          targetId: review.id,
          context: caller.context,
          metadata: { bookingId: booking.id, itemId, status: review.status },
        },
        tx,
      );
    });
  }

  /** A subject's published reviews, newest first, with its verified score. */
  async page(
    query: z.infer<typeof reviewPageQuerySchema>,
  ): Promise<z.infer<typeof reviewPageSchema>> {
    const subject = query.subject
      ? await this.prisma.reviewSubject.findUnique({ where: { id: query.subject } })
      : query.kind && query.ref
        ? await this.prisma.reviewSubject.findUnique({
            where: { kind_refId: { kind: query.kind, refId: query.ref } },
          })
        : null;
    if (!subject) return { summary: null, items: [], nextCursor: null };
    const limit = query.limit ?? REVIEW_PAGE_SIZE;
    const rows = await this.prisma.review.findMany({
      where: { subjectId: subject.id, status: 'published' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, limit);
    return {
      summary: presentSummary(subject),
      items: items.map(presentPublic),
      nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
