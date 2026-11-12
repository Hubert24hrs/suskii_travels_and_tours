'use client';

import { REVIEW_REJECT_REASONS, REVIEW_STATUSES } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  ConfirmAction,
  DataTable,
  FormDialog,
  PageHeader,
  ProblemAlert,
  QueryState,
  SelectField,
  StatusBadge,
} from '../ui';

type Review = Schemas['AdminReview'];
type Status = Review['status'];
type RejectReason = (typeof REVIEW_REJECT_REASONS)[number];

const PATH = '/v1/admin/reviews';
const linkClass = 'font-body text-body-sm text-primary underline focus-visible:focus-ring';

const tone = (status: Status) =>
  status === 'published' ? 'success' : status === 'rejected' ? 'danger' : 'warning';

function useInvalidateReviews() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['get', PATH] });
}

function PublishAction({ review }: { review: Review }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateReviews();
  const publish = $api.useMutation('post', '/v1/admin/reviews/{id}/publish', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('reviews.published'), variant: 'success' });
      await invalidate();
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('reviews.publish')}
      triggerAriaLabel={t('reviews.publishFor', { subject: review.subject.name })}
      question={t('reviews.confirmPublish')}
      onConfirm={() => publish.mutate({ params: { path: { id: review.id } } })}
      pending={publish.isPending}
      error={publish.error}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

function RejectAction({ review }: { review: Review }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RejectReason>('off_topic');
  const { toast } = useToast();
  const invalidate = useInvalidateReviews();
  const reject = $api.useMutation('post', '/v1/admin/reviews/{id}/reject', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('reviews.rejected'), variant: 'success' });
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    reject.mutate({ params: { path: { id: review.id } }, body: { reason } });
  };
  return (
    <FormDialog
      triggerLabel={t('reviews.reject')}
      triggerAriaLabel={t('reviews.rejectFor', { subject: review.subject.name })}
      title={t('reviews.reject')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('reviews.rejectReason')}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as RejectReason)}
          options={REVIEW_REJECT_REASONS.map((value) => ({
            value,
            label: label('reviews.reasons', value),
          }))}
        />
        <ProblemAlert error={reject.error} />
        <Button type="submit" loading={reject.isPending}>
          {t('reviews.reject')}
        </Button>
      </form>
    </FormDialog>
  );
}

/** The traveller's words, exactly as written. */
function ReviewText({ review }: { review: Review }) {
  return (
    <div className="flex max-w-popover flex-col gap-1 font-body text-body-sm">
      {review.title ? <p className="font-bold">{review.title}</p> : null}
      {review.liked ? (
        <p>
          <span className="text-muted">{t('reviews.liked')}: </span>
          {review.liked}
        </p>
      ) : null}
      {review.disliked ? (
        <p>
          <span className="text-muted">{t('reviews.disliked')}: </span>
          {review.disliked}
        </p>
      ) : null}
    </div>
  );
}

/** Verified reviews (ADR-077): publish as written or reject with a reason. */
export function ReviewsPage() {
  const { can } = useStaffSession();
  const [status, setStatus] = useState<Status>('pending');
  const pages = useCursorPages(['get', PATH, status], async (cursor) =>
    unwrap(
      await adminApi.GET(PATH, {
        params: { query: { status, limit: 50, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  return (
    <RequirePermission permission="reviews:moderate">
      <PageHeader title={t('reviews.title')} intro={t('reviews.intro')} />
      <div className="max-w-popover">
        <SelectField
          label={t('reviews.status')}
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as Status)}
          options={REVIEW_STATUSES.map((value) => ({
            value,
            label: label('reviews.statuses', value),
          }))}
        />
      </div>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) =>
          items.length === 0 ? (
            <p className="font-body text-body text-muted">{t('reviews.empty')}</p>
          ) : (
            <>
              <DataTable
                caption={t('reviews.title')}
                rows={items}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'written',
                    header: t('reviews.written'),
                    cell: (row) => format.dateTime(row.createdAt),
                  },
                  {
                    key: 'subject',
                    header: t('reviews.subject'),
                    cell: (row) => (
                      <span className="flex flex-col">
                        <span className="font-bold">{row.subject.name}</span>
                        <span className="text-muted">
                          {label('reviews.kinds', row.subject.kind)}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'rating',
                    header: t('reviews.rating'),
                    cell: (row) => t('reviews.ratingValue', { value: row.rating }),
                  },
                  {
                    key: 'review',
                    header: t('reviews.review'),
                    cell: (row) => <ReviewText review={row} />,
                  },
                  {
                    key: 'trip',
                    header: t('reviews.tripType'),
                    cell: (row) => (
                      <span className="flex flex-col">
                        <span>{label('reviews.tripTypes', row.tripType)}</span>
                        <span className="text-muted">{row.travelledOn}</span>
                      </span>
                    ),
                  },
                  {
                    key: 'shownAs',
                    header: t('reviews.shownAs'),
                    cell: (row) => row.displayName ?? t('reviews.anonymous'),
                  },
                  {
                    key: 'flags',
                    header: t('reviews.flags'),
                    cell: (row) =>
                      row.flags.length > 0 ? (
                        <ul className="flex flex-col gap-1">
                          {row.flags.map((flag) => (
                            <li key={flag}>
                              <StatusBadge tone="warning">
                                {label('reviews.flagNames', flag)}
                              </StatusBadge>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        t('common.none')
                      ),
                  },
                  {
                    key: 'booking',
                    header: t('reviews.booking'),
                    cell: (row) =>
                      can('bookings:read') ? (
                        <Link
                          href={`/bookings/${row.bookingId}` as Route}
                          className={linkClass}
                          aria-label={t('reviews.openBooking', {
                            reference: row.bookingReference,
                          })}
                        >
                          {row.bookingReference}
                        </Link>
                      ) : (
                        <code>{row.bookingReference}</code>
                      ),
                  },
                  {
                    key: 'status',
                    header: t('common.status'),
                    cell: (row) => (
                      <span className="flex flex-col gap-1">
                        <StatusBadge tone={tone(row.status)}>
                          {label('reviews.statuses', row.status)}
                        </StatusBadge>
                        {row.rejectReason ? (
                          <span className="text-muted">
                            {label('reviews.reasons', row.rejectReason)}
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('common.actions'),
                    cell: (row) =>
                      row.status === 'pending' ? (
                        <div className="flex flex-wrap gap-2">
                          <PublishAction review={row} />
                          <RejectAction review={row} />
                        </div>
                      ) : null,
                  },
                ]}
              />
              {pages.hasNextPage ? (
                <Button
                  variant="ghost"
                  loading={pages.isFetchingNextPage}
                  onClick={() => void pages.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              ) : null}
            </>
          )
        }
      </QueryState>
    </RequirePermission>
  );
}
