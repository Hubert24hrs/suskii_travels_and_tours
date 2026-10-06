'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { $api, problemMessage, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import { DataTable, PageHeader, QueryState, SelectField, StatusBadge } from '../ui';

type Referral = Schemas['AdminReferral'];
type Status = Referral['status'];

const STATUSES = [
  'review',
  'pending',
  'qualified',
  'rewarded',
  'rejected',
] as const satisfies readonly Status[];

const tone = (status: Status) =>
  status === 'rewarded' || status === 'qualified'
    ? 'success'
    : status === 'review'
      ? 'warning'
      : status === 'rejected'
        ? 'danger'
        : 'neutral';

const linkClass = 'font-body text-body-sm text-primary underline focus-visible:focus-ring';

/** Users are linked only for staff who can open them; everyone else sees the id. */
function UserLink({ id }: { id: string }) {
  const { can } = useStaffSession();
  if (!can('users:read')) return <code className="font-body text-caption">{id}</code>;
  return (
    <Link href={`/users/${id}` as Route} className={linkClass}>
      <code>{id.slice(-12)}</code>
    </Link>
  );
}

function Decision({ referral }: { referral: Referral }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const decide = $api.useMutation('post', '/v1/admin/referrals/{id}/decision', {
    onSuccess: async () => {
      toast({ title: t('referrals.decided'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/referrals'] });
    },
    onError: (error) => toast({ title: problemMessage(error), variant: 'error' }),
  });
  if (referral.status !== 'review') return null;
  const send = (decision: 'approve' | 'reject') =>
    decide.mutate({ params: { path: { id: referral.id } }, body: { decision } });
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        loading={decide.isPending && decide.variables.body.decision === 'approve'}
        disabled={decide.isPending}
        aria-label={t('referrals.approveLabel', { code: referral.code })}
        onClick={() => send('approve')}
      >
        {t('referrals.approve')}
      </Button>
      <Button
        variant="ghost"
        loading={decide.isPending && decide.variables.body.decision === 'reject'}
        disabled={decide.isPending}
        aria-label={t('referrals.rejectLabel', { code: referral.code })}
        onClick={() => send('reject')}
      >
        {t('referrals.reject')}
      </Button>
    </div>
  );
}

export function ReferralsPage() {
  const params = useSearchParams();
  const initial = params.get('status');
  const [status, setStatus] = useState<Status>(
    initial && (STATUSES as readonly string[]).includes(initial) ? (initial as Status) : 'review',
  );
  const query = $api.useQuery('get', '/v1/admin/referrals', { params: { query: { status } } });
  return (
    <RequirePermission permission="referrals:review">
      <PageHeader title={t('referrals.title')} intro={t('referrals.intro')} />
      <div className="max-w-popover">
        <SelectField
          label={t('referrals.status')}
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as Status)}
          options={STATUSES.map((value) => ({ value, label: label('referrals.statuses', value) }))}
        />
      </div>
      <QueryState query={{ ...query, data: query.data?.referrals }}>
        {(referrals) => (
          <DataTable
            caption={t('referrals.title')}
            rows={referrals}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'code',
                header: t('referrals.title'),
                cell: (row) => <code className="font-bold">{row.code}</code>,
              },
              {
                key: 'referrer',
                header: t('referrals.referrer'),
                cell: (row) => <UserLink id={row.referrerId} />,
              },
              {
                key: 'referred',
                header: t('referrals.referred'),
                cell: (row) => <UserLink id={row.refereeId} />,
              },
              {
                key: 'flags',
                header: t('referrals.flags'),
                cell: (row) =>
                  row.flags.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {row.flags.map((flag) => (
                        <li key={flag}>{label('referrals.flagLabels', flag)}</li>
                      ))}
                    </ul>
                  ) : (
                    t('common.none')
                  ),
              },
              {
                key: 'booking',
                header: t('referrals.booking'),
                cell: (row) =>
                  row.qualifyingBookingId ? (
                    <Link
                      href={`/bookings/${row.qualifyingBookingId}` as Route}
                      className={linkClass}
                    >
                      {t('referrals.openBooking')}
                    </Link>
                  ) : (
                    t('referrals.noBooking')
                  ),
              },
              {
                key: 'created',
                header: t('referrals.created'),
                cell: (row) => format.dateTime(row.createdAt),
              },
              {
                key: 'status',
                header: t('common.status'),
                cell: (row) => (
                  <StatusBadge tone={tone(row.status)}>
                    {label('referrals.statuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <Decision referral={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </RequirePermission>
  );
}
