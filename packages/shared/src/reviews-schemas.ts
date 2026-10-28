import { z } from './zod-setup';

import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX,
  REVIEW_TITLE_MAX,
  REVIEW_TRIP_TYPES,
} from './reviews';

/** Optional free text: trimmed, and empty means none. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === '' ? null : (value ?? null)));

/** What a traveller writes (ADR-077). The rating is required; every text is optional. */
export const reviewInputSchema = z.object({
  rating: z.number().int().min(REVIEW_RATING_MIN).max(REVIEW_RATING_MAX),
  title: optionalText(REVIEW_TITLE_MAX),
  liked: optionalText(REVIEW_TEXT_MAX),
  disliked: optionalText(REVIEW_TEXT_MAX),
  tripType: z.enum(REVIEW_TRIP_TYPES),
  /** False shows "Verified traveller" instead of the first name and last initial. */
  showName: z.boolean(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;
