import { z } from 'zod';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

import { RISK_SIGNALS } from './payment-risk.service';

export const PAYMENT_REVIEW_STATUSES = ['open', 'approved', 'rejected'] as const;
/** Reasons staff can give; codes only, so no personal data lands in the record. */
export const PAYMENT_REVIEW_REJECT_REASONS = [
  'confirmed_fraud',
  'customer_unverified',
  'card_reported',
  'other',
] as const;

const timestamp = z.iso.datetime();

export const adminPaymentReviewSchema = named(
  'AdminPaymentReview',
  z.object({
    id: z.uuid(),
    bookingId: z.uuid(),
    bookingReference: z.string(),
    paymentId: z.uuid(),
    provider: z.string(),
    amount: moneySchema,
    score: z.number().int(),
    signals: z.array(z.enum(RISK_SIGNALS)),
    status: z.enum(PAYMENT_REVIEW_STATUSES),
    reason: z.string().nullable(),
    decidedByUserId: z.uuid().nullable(),
    decidedAt: timestamp.nullable(),
    createdAt: timestamp,
    heldUntil: timestamp.nullable().meta({
      description: 'When the earliest supplier hold on the booking lapses (decide before it).',
    }),
  }),
);

export const adminPaymentReviewPageSchema = named(
  'AdminPaymentReviewPage',
  z.object({ items: z.array(adminPaymentReviewSchema), nextCursor: z.uuid().nullable() }),
);

export const adminPaymentReviewQuerySchema = z.object({
  status: z.enum(PAYMENT_REVIEW_STATUSES).default('open'),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const paymentReviewParamsSchema = z.object({ id: z.uuid() });

export const rejectPaymentReviewSchema = named(
  'RejectPaymentReviewRequest',
  z.object({ reason: z.enum(PAYMENT_REVIEW_REJECT_REASONS) }),
);
