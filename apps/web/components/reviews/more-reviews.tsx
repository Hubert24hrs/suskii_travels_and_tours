'use client';

import { useFormatters, useTranslator } from '@suskii/i18n/react';
import { Button } from '@suskii/ui-web';
import { useState } from 'react';

import { browserApi } from '../../lib/browser-api';

import { ReviewCard, type PublicReview } from './review-card';
import type { ReviewsMessages } from './reviews-messages';

/** Later pages of a subject's reviews, loaded on request (the first page is server-rendered). */
export function MoreReviews({ subjectId, cursor }: { subjectId: string; cursor: string }) {
  const { t } = useTranslator<ReviewsMessages>();
  const format = useFormatters();
  const [items, setItems] = useState<PublicReview[]>([]);
  const [next, setNext] = useState<string | null>(cursor);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!next) return;
    setLoading(true);
    const { data } = await browserApi().GET('/v1/reviews', {
      params: { query: { subject: subjectId, cursor: next } },
    });
    setLoading(false);
    if (!data) return;
    setItems((current) => [...current, ...data.items]);
    setNext(data.nextCursor);
  };

  return (
    <>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              labels={{
                author: review.displayName ?? t('reviews.anonymous'),
                score: t('reviews.score', { score: review.rating }),
                meta: `${t(`reviews.tripTypes.${review.tripType}`)} · ${t('reviews.travelled', {
                  month: format.date(`${review.travelledOn}-01`, 'month'),
                })}`,
                liked: t('reviews.liked'),
                disliked: t('reviews.disliked'),
              }}
            />
          ))}
        </ul>
      ) : null}
      {next ? (
        <Button variant="secondary" loading={loading} onClick={() => void load()}>
          {t('reviews.more')}
        </Button>
      ) : null}
    </>
  );
}
