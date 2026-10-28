import type { z } from 'zod';

import { reviewScore } from '@suskii/shared';

import type { ReviewSubject } from '../generated/prisma/client';

import type { reviewSummarySchema } from './reviews.schemas';

/** A subject's verified score and count; null until it has a published review (ADR-077). */
export function presentSummary(
  subject: Pick<ReviewSubject, 'id' | 'ratingSum' | 'ratingCount'>,
): z.infer<typeof reviewSummarySchema> | null {
  const score = reviewScore(subject.ratingSum, subject.ratingCount);
  return score === null ? null : { subjectId: subject.id, score, count: subject.ratingCount };
}
