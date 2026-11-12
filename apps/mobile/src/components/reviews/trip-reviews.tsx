import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import {
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX,
  REVIEW_TITLE_MAX,
  REVIEW_TRIP_TYPES,
  type ReviewTripType,
} from '@suskii/shared';
import { Badge, Button, Card, Input } from '@suskii/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { problemSlug } from '../../lib/api';
import { tripStore } from '../../lib/trips';
import { useApp, useT } from '../../providers/app-provider';
import { Checkbox, ChoiceChips } from '../booking/form-controls';

type Item = Schemas['BookingReviews']['items'][number];
type OwnReview = NonNullable<Item['review']>;

const STATUS_VARIANT = { pending: 'info', published: 'success', rejected: 'neutral' } as const;
const RATINGS = Array.from({ length: REVIEW_RATING_MAX - REVIEW_RATING_MIN + 1 }, (_, index) =>
  String(REVIEW_RATING_MAX - index),
);

interface Draft {
  rating: string;
  title: string;
  liked: string;
  disliked: string;
  tripType: ReviewTripType;
  showName: boolean;
}

const draftOf = (review: OwnReview | null): Draft => ({
  rating: String(review?.rating ?? 8),
  title: review?.title ?? '',
  liked: review?.liked ?? '',
  disliked: review?.disliked ?? '',
  tripType: review?.tripType ?? 'solo',
  showName: review?.showName ?? true,
});

function TextArea({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testID: string;
}) {
  return (
    <View className="gap-1">
      <Text className="font-body-medium text-body-sm text-foreground">{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        multiline
        maxLength={REVIEW_TEXT_MAX}
        value={value}
        onChangeText={onChange}
        textAlignVertical="top"
        className="min-h-20 rounded-md border border-border-strong bg-surface px-4 py-3 font-body text-body text-foreground"
      />
    </View>
  );
}

function ReviewForm({
  bookingId,
  item,
  onSaved,
  onCancel,
}: {
  bookingId: string;
  item: Item;
  onSaved: (review: OwnReview) => void;
  onCancel: () => void;
}) {
  const { api, locale } = useApp();
  const { t } = useT();
  const [draft, setDraft] = useState<Draft>(() => draftOf(item.review));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { data, error: problem } = await api.PUT(
      '/v1/bookings/{bookingId}/items/{itemId}/review',
      {
        params: {
          path: { bookingId, itemId: item.itemId },
          header: await tripStore.bookingHeaders(bookingId),
        },
        body: { ...draft, rating: Number(draft.rating), locale },
      },
    );
    setBusy(false);
    if (data) {
      onSaved(data);
      return;
    }
    const slug = problemSlug(problem);
    setError(
      slug === 'review-closed'
        ? t('reviews.write.errors.exists')
        : slug === 'review-not-eligible'
          ? t('reviews.write.errors.notEligible')
          : t('booking.error'),
    );
  };

  return (
    <View className="gap-4">
      <ChoiceChips
        label={t('reviews.write.rating')}
        options={RATINGS.map((value) => ({ value, label: value }))}
        value={draft.rating}
        onChange={(value) => set('rating', value)}
        testID="review-rating"
      />
      <Input
        label={t('reviews.write.title')}
        value={draft.title}
        maxLength={REVIEW_TITLE_MAX}
        onChangeText={(value) => set('title', value)}
        testID="review-title"
      />
      <TextArea
        label={t('reviews.write.liked')}
        value={draft.liked}
        onChange={(value) => set('liked', value)}
        testID="review-liked"
      />
      <TextArea
        label={t('reviews.write.disliked')}
        value={draft.disliked}
        onChange={(value) => set('disliked', value)}
        testID="review-disliked"
      />
      <ChoiceChips
        label={t('reviews.write.tripType')}
        options={REVIEW_TRIP_TYPES.map((value) => ({
          value,
          label: t(`reviews.tripTypes.${value}`),
        }))}
        value={draft.tripType}
        onChange={(value) => set('tripType', value)}
        testID="review-trip-type"
      />
      <Checkbox
        label={t('reviews.write.showName')}
        checked={draft.showName}
        onChange={(value) => set('showName', value)}
        testID="review-show-name"
      />
      <Text className="font-body text-caption text-muted">{t('reviews.verifiedNote')}</Text>
      {error ? (
        <Text accessibilityLiveRegion="polite" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Button testID="review-submit" loading={busy} onPress={() => void submit()}>
        {t('reviews.write.submit')}
      </Button>
      <Button variant="ghost" onPress={onCancel}>
        {t('reviews.write.cancel')}
      </Button>
    </View>
  );
}

function ItemReview({
  bookingId,
  item,
  onChange,
}: {
  bookingId: string;
  item: Item;
  onChange: () => void;
}) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { review } = item;

  const withdraw = async () => {
    setBusy(true);
    const { response } = await api.DELETE('/v1/bookings/{bookingId}/items/{itemId}/review', {
      params: {
        path: { bookingId, itemId: item.itemId },
        header: await tripStore.bookingHeaders(bookingId),
      },
    });
    setBusy(false);
    setConfirming(false);
    if (response.ok || response.status === 404) {
      setNotice(t('reviews.write.withdrawn'));
      onChange();
    }
  };

  return (
    <Card className="gap-3 p-4" testID={`trip-review-${item.kind}`}>
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('reviews.write.heading', { name: item.name })}
      </Text>
      {notice ? (
        <Text accessibilityLiveRegion="polite" className="font-body text-body-sm text-foreground">
          {notice}
        </Text>
      ) : null}
      {editing ? (
        <ReviewForm
          bookingId={bookingId}
          item={item}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice(t('reviews.write.saved'));
            onChange();
          }}
        />
      ) : review ? (
        <>
          <View className="flex-row flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[review.status]}>
              {t(`reviews.write.status.${review.status}`)}
            </Badge>
            <Text className="font-body-bold text-body text-heading">
              {t('reviews.score', { score: review.rating })}
            </Text>
          </View>
          {review.status === 'pending' && item.canReview ? (
            <Button variant="secondary" onPress={() => setEditing(true)}>
              {t('reviews.write.edit')}
            </Button>
          ) : null}
          {confirming ? (
            <View className="gap-2">
              <Text className="font-body text-body-sm text-foreground">
                {t('reviews.write.withdrawConfirm')}
              </Text>
              <Button
                testID="review-withdraw-confirm"
                variant="secondary"
                loading={busy}
                onPress={() => void withdraw()}
              >
                {t('reviews.write.withdraw')}
              </Button>
              <Button variant="ghost" onPress={() => setConfirming(false)}>
                {t('reviews.write.cancel')}
              </Button>
            </View>
          ) : (
            <Button testID="review-withdraw" variant="ghost" onPress={() => setConfirming(true)}>
              {t('reviews.write.withdraw')}
            </Button>
          )}
        </>
      ) : (
        <>
          <Text className="font-body text-body text-foreground">
            {t('reviews.write.prompt', { name: item.name })}
          </Text>
          <Text className="font-body text-caption text-muted">
            {t('reviews.write.window', { date: format.date(item.windowEndsOn, 'long') })}
          </Text>
          <Button testID="review-write" onPress={() => setEditing(true)}>
            {t('reviews.write.cta')}
          </Button>
        </>
      )}
    </Card>
  );
}

/**
 * Verified reviews of a finished trip (ADR-077): each stay, package, tour, bus ride or rental
 * whose trip has ended can be reviewed once, by whoever holds the booking; reviews wait for a
 * moderator. Needs the network, so the trip screen hides it offline.
 */
export function TripReviews({ bookingId }: { bookingId: string }) {
  const { api } = useApp();
  const { t } = useT();
  const queryClient = useQueryClient();
  const key = ['booking-reviews', bookingId];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data } = await api.GET('/v1/bookings/{bookingId}/reviews', {
        params: { path: { bookingId }, header: await tripStore.bookingHeaders(bookingId) },
      });
      if (!data) throw new Error('reviews unavailable');
      return data;
    },
  });
  const shown = (query.data?.items ?? []).filter((item) => item.canReview || item.review !== null);
  if (shown.length === 0) return null;
  return (
    <View className="gap-3" testID="trip-reviews">
      <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
        {t('reviews.heading')}
      </Text>
      {shown.map((item) => (
        <ItemReview
          key={item.itemId}
          bookingId={bookingId}
          item={item}
          onChange={() => void queryClient.invalidateQueries({ queryKey: key })}
        />
      ))}
    </View>
  );
}
