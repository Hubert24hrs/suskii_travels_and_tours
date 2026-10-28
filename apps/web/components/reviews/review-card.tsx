import type { Schemas } from '@suskii/api-client';

export type PublicReview = Schemas['PublicReview'];

export interface ReviewCardLabels {
  /** "Ada O." or "Verified traveller". */
  author: string;
  score: string;
  /** "Couple · Travelled in October 2026". */
  meta: string;
  liked: string;
  disliked: string;
}

/**
 * One published review, exactly as written (ADR-077). No hooks: server sections and the client
 * "show more" list render the same markup with their own translators.
 */
export function ReviewCard({ review, labels }: { review: PublicReview; labels: ReviewCardLabels }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-body text-body font-bold text-foreground">{labels.author}</p>
        <p className="font-heading text-body font-bold text-heading">{labels.score}</p>
      </div>
      <p className="font-body text-caption text-muted">{labels.meta}</p>
      {review.title ? (
        <p className="font-body text-body font-bold text-foreground" lang={review.locale}>
          {review.title}
        </p>
      ) : null}
      {review.liked ? (
        <p className="font-body text-body-sm text-foreground" lang={review.locale}>
          <span className="font-bold">{labels.liked}: </span>
          {review.liked}
        </p>
      ) : null}
      {review.disliked ? (
        <p className="font-body text-body-sm text-foreground" lang={review.locale}>
          <span className="font-bold">{labels.disliked}: </span>
          {review.disliked}
        </p>
      ) : null}
    </li>
  );
}
