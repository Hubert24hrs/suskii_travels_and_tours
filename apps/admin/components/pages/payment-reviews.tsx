'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
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

type Review = Schemas['AdminPaymentReview'];
type Status = Review['status'];
type RejectReason = Schemas['RejectPaymentReviewRequestInput']['reason'];

const STATUSES: readonly Status[] = ['open', 'approved', 'rejected'];
const REJECT_REASONS: readonly RejectReason[] = [
  'confirmed_fraud',
  'customer_unverified',
  'card_reported',
  'other',
];

const tone = (status: Status) =>
  status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'warning';

function useInvalidateReviews() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/payment-reviews'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/bookings/{bookingId}'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/refunds'] }),
    ]);
}

function ApproveAction({ review }: { review: Review }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateReviews();
  const approve = $api.useMutation('post', '/v1/admin/payment-reviews/{id}/approve', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('paymentReviews.approved'), variant: 'success' });
      await invalidate();
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('paymentReviews.approve')}
      triggerAriaLabel={t('paymentReviews.approveFor', { reference: review.bookingReference })}
      question={t('paymentReviews.confirmApprove')}
      onConfirm={() => approve.mutate({ params: { path: { id: review.id } } })}
      pending={approve.isPending}
      error={approve.error}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

function RejectAction({ review }: { review: Review }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RejectReason>('confirmed_fraud');
  const { toast } = useToast();
  const invalidate = useInvalidateReviews();
  const reject = $api.useMutation('post', '/v1/admin/payment-reviews/{id}/reject', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('paymentReviews.rejected'), variant: 'success' });
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    reject.mutate({ params: { path: { id: review.id } }, body: { reason } });
  };
  return (
    <FormDialog
      triggerLabel={t('paymentReviews.reject')}
      triggerAriaLabel={t('paymentReviews.rejectFor', { reference: review.bookingReference })}
      triggerVariant="ghost"
      title={t('paymentReviews.reject')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('paymentReviews.rejectReason')}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as RejectReason)}
          options={REJECT_REASONS.map((value) => ({
            value,
            label: label('paymentReviews.reasons', value),
          }))}
        />
        <ProblemAlert error={reject.error} />
        <Button type="submit" loading={reject.isPending}>
          {t('paymentReviews.reject')}
        </Button>
      </form>
    </FormDialog>
  );
}

/** Payments held by the risk score (ADR-040): approve releases, reject refunds in full. */
export function PaymentReviewsPage() {
  const { can } = useStaffSession();
  const [status, setStatus] = useState<Status>('open');
  const query = $api.useQuery('get', '/v1/admin/payment-reviews', {
    params: { query: { status, limit: 100 } },
  });
  return (
    <RequirePermission permission="payments:review">
      <PageHeader title={t('paymentReviews.title')} intro={t('paymentReviews.intro')} />
      <div className="max-w-popover">
        <SelectField
          label={t('paymentReviews.status')}
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as Status)}
          options={STATUSES.map((value) => ({
            value,
            label: label('paymentReviews.statuses', value),
          }))}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('paymentReviews.title')}
            rows={data.items}
            rowKey={(row) => row.id}
            empty={t('paymentReviews.empty')}
            columns={[
              {
                key: 'booking',
                header: t('paymentReviews.booking'),
                cell: (row) => (
                  <Link
                    href={`/bookings/${row.bookingId}` as Route}
                    className="font-bold text-primary underline focus-visible:focus-ring"
                  >
                    {row.bookingReference}
                  </Link>
                ),
              },
              {
                key: 'amount',
                header: t('paymentReviews.amount'),
                cell: (row) => format.money(row.amount),
              },
              { key: 'score', header: t('paymentReviews.score'), cell: (row) => row.score },
              {
                key: 'signals',
                header: t('paymentReviews.signals'),
                cell: (row) => (
                  <ul className="flex flex-col gap-1">
                    {row.signals.map((signal) => (
                      <li key={signal}>{label('paymentReviews.signalNames', signal)}</li>
                    ))}
                  </ul>
                ),
              },
              {
                key: 'held',
                header: t('paymentReviews.heldUntil'),
                cell: (row) => (row.heldUntil ? format.dateTime(row.heldUntil) : t('common.none')),
              },
              {
                key: 'status',
                header: t('paymentReviews.status'),
                cell: (row) => (
                  <StatusBadge tone={tone(row.status)}>
                    {label('paymentReviews.statuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'decision',
                header: t('paymentReviews.decided'),
                cell: (row) =>
                  row.reason && row.decidedAt
                    ? `${label('paymentReviews.reasons', row.reason)}, ${format.dateTime(row.decidedAt)}`
                    : t('common.none'),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) =>
                  row.status === 'open' && can('payments:review') ? (
                    <div className="flex flex-wrap gap-2">
                      <ApproveAction review={row} />
                      <RejectAction review={row} />
                    </div>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryState>
    </RequirePermission>
  );
}
