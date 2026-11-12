import { z } from 'zod';

import {
  REVIEWABLE_ITEM_KINDS,
  REVIEW_FLAGS,
  REVIEW_PAGE_SIZE,
  REVIEW_REJECT_REASONS,
  REVIEW_STATUSES,
  REVIEW_SUBJECT_KINDS,
  REVIEW_TRIP_TYPES,
  localeCodeSchema,
  reviewInputSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';

const timestamp = z.iso.datetime();
const localDate = z.iso.date();

/** A published review as everyone sees it: no booking, account or contact details. */
export const publicReviewSchema = named(
  'PublicReview',
  z.object({
    id: z.uuid(),
    rating: z.number().int(),
    title: z.string().nullable(),
    liked: z.string().nullable(),
    disliked: z.string().nullable(),
    tripType: z.enum(REVIEW_TRIP_TYPES),
    displayName: z.string().nullable().meta({
      description: 'First name and last initial; null shows "Verified traveller".',
    }),
    locale: z.string().meta({ description: 'The language the review was written in.' }),
    travelledOn: z.string().meta({ description: 'The month the trip ended (YYYY-MM).' }),
    publishedAt: timestamp,
  }),
);

export const reviewSummarySchema = named(
  'ReviewSummary',
  z.object({
    subjectId: z.uuid(),
    score: z.number().meta({ description: 'Average published rating out of 10, one decimal.' }),
    count: z.number().int(),
  }),
);

export const reviewPageSchema = named(
  'ReviewPage',
  z.object({
    summary: reviewSummarySchema.nullable().meta({
      description: 'Null until the subject has a published review.',
    }),
    items: z.array(publicReviewSchema),
    nextCursor: z.uuid().nullable(),
  }),
);

export const reviewPageQuerySchema = z
  .object({
    subject: z.uuid().optional().meta({ description: 'A review subject (hotels carry its id).' }),
    kind: z.enum(REVIEW_SUBJECT_KINDS).exclude(['hotel']).optional(),
    ref: z.uuid().optional().meta({
      description: 'The package, tour, bus operator or rental vehicle id, with `kind`.',
    }),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(REVIEW_PAGE_SIZE),
  })
  .refine((query) => query.subject !== undefined || (query.kind && query.ref), {
    message: 'subject, or kind and ref, are required',
  });

/** The traveller's own review, with its moderation status. */
export const ownReviewSchema = named(
  'OwnReview',
  z.object({
    id: z.uuid(),
    status: z.enum(REVIEW_STATUSES),
    rating: z.number().int(),
    title: z.string().nullable(),
    liked: z.string().nullable(),
    disliked: z.string().nullable(),
    tripType: z.enum(REVIEW_TRIP_TYPES),
    showName: z.boolean(),
    createdAt: timestamp,
    publishedAt: timestamp.nullable(),
  }),
);

export const bookingReviewItemSchema = named(
  'BookingReviewItem',
  z.object({
    itemId: z.uuid(),
    kind: z.enum(REVIEWABLE_ITEM_KINDS),
    name: z.string().meta({ description: 'What is reviewed, for "How was {name}?".' }),
    endsOn: localDate,
    canReview: z.boolean().meta({
      description:
        'True while the trip has ended, the booking is confirmed and the window is open.',
    }),
    windowEndsOn: localDate,
    review: ownReviewSchema.nullable(),
  }),
);

export const bookingReviewsSchema = named(
  'BookingReviews',
  z.object({ items: z.array(bookingReviewItemSchema) }),
);

export const reviewItemParamsSchema = z.object({ bookingId: z.uuid(), itemId: z.uuid() });
export const bookingReviewsParamsSchema = z.object({ bookingId: z.uuid() });

export const writeReviewSchema = named(
  'WriteReviewRequest',
  reviewInputSchema.extend({
    locale: localeCodeSchema
      .optional()
      .meta({ description: 'The language it is written in; defaults to the booking language.' }),
  }),
);

// ---------------------------------------------------------------------------
// Moderation (console)
// ---------------------------------------------------------------------------

export const adminReviewSchema = named(
  'AdminReview',
  z.object({
    id: z.uuid(),
    status: z.enum(REVIEW_STATUSES),
    subject: z.object({
      id: z.uuid(),
      kind: z.enum(REVIEW_SUBJECT_KINDS),
      name: z.string(),
    }),
    bookingId: z.uuid(),
    bookingReference: z.string(),
    rating: z.number().int(),
    title: z.string().nullable(),
    liked: z.string().nullable(),
    disliked: z.string().nullable(),
    tripType: z.enum(REVIEW_TRIP_TYPES),
    displayName: z.string().nullable(),
    locale: z.string(),
    travelledOn: z.string(),
    flags: z.array(z.enum(REVIEW_FLAGS)),
    rejectReason: z.enum(REVIEW_REJECT_REASONS).nullable(),
    moderatedByUserId: z.uuid().nullable(),
    moderatedAt: timestamp.nullable(),
    createdAt: timestamp,
  }),
);

export const adminReviewPageSchema = named(
  'AdminReviewPage',
  z.object({ items: z.array(adminReviewSchema), nextCursor: z.uuid().nullable() }),
);

export const adminReviewQuerySchema = z.object({
  status: z.enum(REVIEW_STATUSES).default('pending'),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminReviewParamsSchema = z.object({ id: z.uuid() });

export const rejectReviewSchema = named(
  'RejectReviewRequest',
  z.object({ reason: z.enum(REVIEW_REJECT_REASONS) }),
);

export const reviewInvitationRunSchema = named(
  'ReviewInvitationRun',
  z.object({ planned: z.number().int(), sent: z.number().int(), skipped: z.number().int() }),
);
