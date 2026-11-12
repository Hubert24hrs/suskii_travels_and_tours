import type { Schemas } from '@suskii/api-client';
import { I18nProvider } from '@suskii/i18n/react';

import { getI18n } from '../../lib/i18n';

import { MoreReviews } from './more-reviews';
import { ReviewCard } from './review-card';
import { pickReviewsMessages } from './reviews-messages';

/**
 * Verified reviews of a product (ADR-077): the score, how reviews are checked (consumer law asks
 * for it), and the newest reviews. Nothing renders when the API could not answer.
 */
export async function ReviewsSection({ page }: { page: Schemas['ReviewPage'] | null }) {
  if (!page) return null;
  const { t, format, locale, messages } = await getI18n();
  const { summary } = page;
  return (
    <section aria-labelledby="detail-reviews" className="flex flex-col gap-3" data-testid="reviews">
      <h2 id="detail-reviews" className="font-heading text-h3 font-bold text-heading">
        {t('reviews.heading')}
      </h2>
      {summary ? (
        <p className="flex flex-wrap items-baseline gap-2 font-body text-body text-foreground">
          <span className="font-heading text-h3 font-bold text-heading">
            {t('reviews.score', { score: format.number(summary.score) })}
          </span>
          <span>{t('reviews.count', { count: summary.count })}</span>
        </p>
      ) : (
        <p className="font-body text-body text-foreground">{t('reviews.none')}</p>
      )}
      <p className="font-body text-caption text-muted">{t('reviews.verifiedNote')}</p>
      {page.items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {page.items.map((review) => (
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
      {summary && page.nextCursor ? (
        <I18nProvider locale={locale} messages={pickReviewsMessages(messages)}>
          <MoreReviews subjectId={summary.subjectId} cursor={page.nextCursor} />
        </I18nProvider>
      ) : null}
    </section>
  );
}
