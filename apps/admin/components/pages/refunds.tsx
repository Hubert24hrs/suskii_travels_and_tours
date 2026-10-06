'use client';

import { REFUND_STATUSES } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { $api, problemMessage, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  DataTable,
  FormDialog,
  PageHeader,
  ProblemAlert,
  QueryState,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../ui';

type Refund = Schemas['AdminRefund'];
type Status = Refund['status'];

function tone(status: Status): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (status === 'succeeded') return 'success';
  if (status === 'failed' || status === 'rejected') return 'danger';
  if (status === 'pending_approval' || status === 'needs_review') return 'warning';
  return 'info';
}

function useInvalidateRefunds() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/refunds'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/bookings/{bookingId}'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/dashboard'] }),
    ]);
}

function RejectDialog({ refund }: { refund: Refund }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { toast } = useToast();
  const invalidate = useInvalidateRefunds();
  const reject = $api.useMutation('post', '/v1/admin/refunds/{refundId}/reject', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('refunds.rejected'), variant: 'success' });
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    reject.mutate({ params: { path: { refundId: refund.id } }, body: { reason } });
  };
  return (
    <FormDialog
      triggerLabel={t('refunds.reject')}
      title={t('refunds.reject')}
      open={open}
      onOpenChange={setOpen}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextAreaField
          label={t('refunds.rejectReason')}
          name="reason"
          value={reason}
          minLength={3}
          maxLength={300}
          required
          onChange={(event) => setReason(event.target.value)}
        />
        <ProblemAlert error={reject.error} />
        <Button type="submit" loading={reject.isPending}>
          {t('refunds.reject')}
        </Button>
      </form>
    </FormDialog>
  );
}

function ResolveDialog({ refund }: { refund: Refund }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'succeeded' | 'failed'>('succeeded');
  const [providerRefundId, setProviderRefundId] = useState('');
  const { toast } = useToast();
  const invalidate = useInvalidateRefunds();
  const resolve = $api.useMutation('post', '/v1/admin/refunds/{refundId}/resolve', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('refunds.resolved'), variant: 'success' });
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    resolve.mutate({
      params: { path: { refundId: refund.id } },
      body: { outcome, providerRefundId: providerRefundId.trim() || null },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('refunds.resolve')}
      title={t('refunds.resolve')}
      open={open}
      onOpenChange={setOpen}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('refunds.outcome')}
          name="outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as typeof outcome)}
          options={(['succeeded', 'failed'] as const).map((value) => ({
            value,
            label: label('refunds.outcomes', value),
          }))}
        />
        <TextField
          label={t('refunds.providerRefundId')}
          name="providerRefundId"
          value={providerRefundId}
          maxLength={100}
          onChange={(event) => setProviderRefundId(event.target.value)}
        />
        <ProblemAlert error={resolve.error} />
        <Button type="submit" loading={resolve.isPending}>
          {t('refunds.resolve')}
        </Button>
      </form>
    </FormDialog>
  );
}

function Actions({ refund }: { refund: Refund }) {
  const { can, session } = useStaffSession();
  const { toast } = useToast();
  const invalidate = useInvalidateRefunds();
  const approve = $api.useMutation('post', '/v1/admin/refunds/{refundId}/approve', {
    onSuccess: async () => {
      toast({ title: t('refunds.approved'), variant: 'success' });
      await invalidate();
    },
    onError: (error) => toast({ title: problemMessage(error), variant: 'error' }),
  });
  if (!can('refunds:approve')) return null;
  const own = session.status === 'signed-in' && refund.requestedByUserId === session.user.id;
  if (refund.status === 'pending_approval') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          loading={approve.isPending}
          disabled={own}
          title={own ? t('problems.maker-checker') : undefined}
          onClick={() => approve.mutate({ params: { path: { refundId: refund.id } } })}
          data-testid={`approve-${refund.id}`}
        >
          {t('refunds.approve')}
        </Button>
        <RejectDialog refund={refund} />
      </div>
    );
  }
  if (refund.status === 'needs_review' || refund.status === 'processing') {
    return <ResolveDialog refund={refund} />;
  }
  return null;
}

export function RefundsPage() {
  const params = useSearchParams();
  const initial = params.get('status');
  const [status, setStatus] = useState<Status | ''>(
    initial && (REFUND_STATUSES as readonly string[]).includes(initial)
      ? (initial as Status)
      : 'pending_approval',
  );
  const query = $api.useQuery('get', '/v1/admin/refunds', {
    params: { query: { ...(status ? { status } : {}), limit: 100 } },
  });
  return (
    <RequirePermission permission="refunds:request">
      <PageHeader title={t('refunds.title')} intro={t('refunds.intro')} />
      <div className="max-w-popover">
        <SelectField
          label={t('refunds.status')}
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as Status | '')}
          options={[
            { value: '', label: t('common.all') },
            ...REFUND_STATUSES.map((value) => ({ value, label: label('refunds.statuses', value) })),
          ]}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('refunds.title')}
            rows={data.refunds}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'booking',
                header: t('refunds.booking'),
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
                header: t('refunds.amount'),
                cell: (row) => format.money(row.amount),
              },
              {
                key: 'reason',
                header: t('refunds.reason'),
                cell: (row) => label('refunds.reasons', row.reason),
              },
              {
                key: 'status',
                header: t('refunds.status'),
                cell: (row) => (
                  <StatusBadge tone={tone(row.status)}>
                    {label('refunds.statuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'requested',
                header: t('refunds.requestedBy'),
                cell: (row) =>
                  row.automatic
                    ? t('refunds.automatic')
                    : (row.requestedByUserId ?? t('common.none')),
              },
              {
                key: 'created',
                header: t('common.created'),
                cell: (row) => format.dateTime(row.createdAt),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <Actions refund={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </RequirePermission>
  );
}
