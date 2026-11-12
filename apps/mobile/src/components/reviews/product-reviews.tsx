import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Button, Card } from '@suskii/ui-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { useApp, useT } from '../../providers/app-provider';

type Review = Schemas['PublicReview'];
type Kind = 'package' | 'tour' | 'bus_operator' | 'rental_vehicle';

function ReviewItem({ review }: { review: Review }) {
  const { t } = useT();
  const format = useFormatters();
  return (
    <Card className="gap-2 p-4" testID="review">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 font-body-bold text-body text-foreground">
          {review.displayName ?? t('reviews.anonymous')}
        </Text>
        <Text className="font-heading text-body text-heading">
          {t('reviews.score', { score: review.rating })}
        </Text>
      </View>
      <Text className="font-body text-caption text-muted">
        {`${t(`reviews.tripTypes.${review.tripType}`)} · ${t('reviews.travelled', {
          month: format.date(`${review.travelledOn}-01`, 'month'),
        })}`}
      </Text>
      {review.title ? (
        <Text className="font-body-bold text-body text-foreground">{review.title}</Text>
      ) : null}
      {review.liked ? (
        <Text className="font-body text-body-sm text-foreground">
          {`${t('reviews.liked')}: ${review.liked}`}
        </Text>
      ) : null}
      {review.disliked ? (
        <Text className="font-body text-body-sm text-foreground">
          {`${t('reviews.disliked')}: ${review.disliked}`}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * A product's verified reviews (ADR-077): the score, how reviews are checked, and the newest
 * reviews, ten at a time. Nothing shows when the API cannot answer.
 */
export function ProductReviews({ kind, id }: { kind: Kind; id: string }) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const query = useInfiniteQuery({
    queryKey: ['reviews', kind, id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.GET('/v1/reviews', {
        params: { query: { kind, ref: id, ...(pageParam ? { cursor: pageParam } : {}) } },
      });
      if (!data) throw new Error('reviews unavailable');
      return data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  if (!first) return null;
  const items = pages.flatMap((page) => page.items);
  return (
    <View className="gap-3" testID="reviews">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('reviews.heading')}
      </Text>
      {first.summary ? (
        <Text className="font-body text-body text-foreground">
          {`${t('reviews.score', { score: format.number(first.summary.score) })} · ${t(
            'reviews.count',
            { count: first.summary.count },
          )}`}
        </Text>
      ) : (
        <Text className="font-body text-body text-foreground">{t('reviews.none')}</Text>
      )}
      <Text className="font-body text-caption text-muted">{t('reviews.verifiedNote')}</Text>
      {items.map((review) => (
        <ReviewItem key={review.id} review={review} />
      ))}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          loading={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        >
          {t('reviews.more')}
        </Button>
      ) : null}
    </View>
  );
}
