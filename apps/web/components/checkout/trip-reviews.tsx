'use client';

import { useFormatters } from '@suskii/i18n/react';
import {
  isSupportedLocale,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX,
  REVIEW_TITLE_MAX,
  REVIEW_TRIP_TYPES,
  type ReviewTripType,
} from '@suskii/shared/lite';
import { Badge, Button, Card, Input } from '@suskii/ui-web';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { CheckboxField, NativeSelect } from '../search/native-select';

import { useBookingT } from './checkout-messages';

type Item = Schemas['BookingReviews']['items'][number];
type OwnReview = NonNullable<Item['review']>;

const STATUS_VARIANT = { pending: 'info', published: 'success', rejected: 'neutral' } as const;
const RATINGS = Array.from(
  { length: REVIEW_RATING_MAX - REVIEW_RATING_MIN + 1 },
  (_, index) => REVIEW_RATING_MAX - index,
);
const TEXTAREA =
  'min-h-24 w-full rounded-md border border-border-strong bg-surface px-4 py-3 font-body text-body text-foreground focus-visible:focus-ring';

interface Draft {
  rating: number;
  title: string;
  liked: string;
  disliked: string;
  tripType: ReviewTripType;
  showName: boolean;
}

const draftOf = (review: OwnReview | null): Draft => ({
  rating: review?.rating ?? 8,
  title: review?.title ?? '',
  liked: review?.liked ?? '',
  disliked: review?.disliked ?? '',
  tripType: review?.tripType ?? 'solo',
  showName: review?.showName ?? true,
});

function TextArea({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-body text-body-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        value={value}
        maxLength={REVIEW_TEXT_MAX}
        onChange={(event) => onChange(event.target.value)}
        className={TEXTAREA}
      />
    </div>
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
  const { t } = useBookingT();
  const [draft, setDraft] = useState<Draft>(() => draftOf(item.review));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // The language the page is in, which is most likely the one the review is written in.
    const lang = document.documentElement.lang;
    const { data, error: problem } = await browserApi().PUT(
      '/v1/bookings/{bookingId}/items/{itemId}/review',
      {
        params: { path: { bookingId, itemId: item.itemId }, header: bookingHeaders(bookingId) },
        body: { ...draft, ...(isSupportedLocale(lang) ? { locale: lang } : {}) },
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
    <form method="post" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <NativeSelect
        label={t('reviews.write.rating')}
        name="rating"
        value={String(draft.rating)}
        onChange={(event) => set('rating', Number(event.target.value))}
        options={RATINGS.map((value) => ({
          value: String(value),
          label: t('reviews.write.ratingValue', { value }),
        }))}
      />
      <Input
        label={t('reviews.write.title')}
        name="title"
        value={draft.title}
        maxLength={REVIEW_TITLE_MAX}
        onChange={(event) => set('title', event.target.value)}
      />
      <TextArea
        label={t('reviews.write.liked')}
        name="liked"
        value={draft.liked}
        onChange={(value) => set('liked', value)}
      />
      <TextArea
        label={t('reviews.write.disliked')}
        name="disliked"
        value={draft.disliked}
        onChange={(value) => set('disliked', value)}
      />
      <NativeSelect
        label={t('reviews.write.tripType')}
        name="tripType"
        value={draft.tripType}
        onChange={(event) => set('tripType', event.target.value as ReviewTripType)}
        options={REVIEW_TRIP_TYPES.map((value) => ({
          value,
          label: t(`reviews.tripTypes.${value}`),
        }))}
      />
      <CheckboxField
        label={t('reviews.write.showName')}
        name="showName"
        checked={draft.showName}
        onChange={(event) => set('showName', event.target.checked)}
      />
      <p className="font-body text-caption text-muted">{t('reviews.verifiedNote')}</p>
      {error ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy}>
          {t('reviews.write.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('reviews.write.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ItemReview({
  bookingId,
  item,
  onChange,
}: {
  bookingId: string;
  item: Item;
  onChange: (review: OwnReview | null) => void;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  const headingId = useId();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { review } = item;

  const withdraw = async () => {
    if (!window.confirm(t('reviews.write.withdrawConfirm'))) return;
    setBusy(true);
    const { response } = await browserApi().DELETE(
      '/v1/bookings/{bookingId}/items/{itemId}/review',
      { params: { path: { bookingId, itemId: item.itemId }, header: bookingHeaders(bookingId) } },
    );
    setBusy(false);
    if (response.ok || response.status === 404) {
      setNotice(t('reviews.write.withdrawn'));
      onChange(null);
    }
  };

  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby={headingId} data-testid={`trip-review-${item.kind}`}>
        <h3 id={headingId} className="font-heading text-h4 font-bold text-heading">
          {t('reviews.write.heading', { name: item.name })}
        </h3>
        {notice ? (
          <p role="status" className="font-body text-body-sm text-foreground">
            {notice}
          </p>
        ) : null}
        {editing ? (
          <ReviewForm
            bookingId={bookingId}
            item={item}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              setEditing(false);
              setNotice(t('reviews.write.saved'));
              onChange(saved);
            }}
          />
        ) : review ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[review.status]}>
                {t(`reviews.write.status.${review.status}`)}
              </Badge>
              <span className="font-body text-body font-bold text-heading">
                {t('reviews.score', { score: review.rating })}
              </span>
            </div>
            {review.title ? (
              <p className="font-body text-body text-foreground">{review.title}</p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              {review.status === 'pending' && item.canReview ? (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t('reviews.write.edit')}
                </Button>
              ) : null}
              <Button variant="ghost" loading={busy} onClick={() => void withdraw()}>
                {t('reviews.write.withdraw')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-body text-body text-foreground">
              {t('reviews.write.prompt', { name: item.name })}
            </p>
            <p className="font-body text-caption text-muted" suppressHydrationWarning>
              {t('reviews.write.window', { date: format.date(item.windowEndsOn, 'long') })}
            </p>
            <Button className="self-start" onClick={() => setEditing(true)}>
              {t('reviews.write.cta')}
            </Button>
          </>
        )}
      </section>
    </Card>
  );
}

/**
 * Verified reviews of a finished trip (ADR-077): each stay, package, tour, bus ride or rental
 * whose trip has ended can be reviewed once, by the booking's holder; the review waits for a
 * moderator. Nothing shows until something can be reviewed or was reviewed.
 */
export function TripReviews({ bookingId }: { bookingId: string }) {
  const { t } = useBookingT();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .GET('/v1/bookings/{bookingId}/reviews', {
        params: { path: { bookingId } },
        headers: bookingHeaders(bookingId),
      })
      .then(({ data }) => {
        if (!cancelled && data) setItems(data.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const shown = (items ?? []).filter((item) => item.canReview || item.review !== null);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="trip-reviews" className="flex flex-col gap-3">
      <h2 id="trip-reviews" className="font-heading text-h3 font-bold text-heading">
        {t('reviews.heading')}
      </h2>
      {shown.map((item) => (
        <ItemReview
          key={item.itemId}
          bookingId={bookingId}
          item={item}
          onChange={(review) =>
            setItems((current) =>
              (current ?? []).map((entry) =>
                entry.itemId === item.itemId ? { ...entry, review } : entry,
              ),
            )
          }
        />
      ))}
    </section>
  );
}
