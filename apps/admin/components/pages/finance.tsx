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
  DataTable,
  FormDialog,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
} from '../ui';

type Discrepancy = Schemas['ReconciliationDiscrepancy'];
type Resolution = 'corrected' | 'accepted';
type PayoutStatus = Schemas['AdminDriverPayouts']['payouts'][number]['status'];

const RESOLUTIONS: readonly Resolution[] = ['corrected', 'accepted'];
const PAYOUT_STATUSES: readonly PayoutStatus[] = ['pending', 'paid', 'failed'];

function ResolveAction({ discrepancy }: { discrepancy: Discrepancy }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<Resolution>('accepted');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resolve = $api.useMutation('post', '/v1/admin/finance/discrepancies/{id}/resolve', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('finance.resolved'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/finance/discrepancies'] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    resolve.mutate({ params: { path: { id: discrepancy.id } }, body: { resolution } });
  };
  return (
    <FormDialog
      triggerLabel={t('finance.resolve')}
      triggerAriaLabel={t('finance.resolveFor', { id: discrepancy.id.slice(0, 8) })}
      title={t('finance.resolve')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('finance.resolution')}
          name="resolution"
          value={resolution}
          onChange={(event) => setResolution(event.target.value as Resolution)}
          options={RESOLUTIONS.map((value) => ({
            value,
            label: label('finance.resolutions', value),
          }))}
        />
        <ProblemAlert error={resolve.error} />
        <Button type="submit" loading={resolve.isPending}>
          {t('finance.resolve')}
        </Button>
      </form>
    </FormDialog>
  );
}

function Discrepancies() {
  const { can } = useStaffSession();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const query = $api.useQuery('get', '/v1/admin/finance/discrepancies', {
    params: { query: { status } },
  });
  return (
    <Section title={t('finance.discrepancies')}>
      <div className="max-w-popover">
        <SelectField
          label={t('finance.status')}
          name="discrepancy-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as 'open' | 'resolved')}
          options={(['open', 'resolved'] as const).map((value) => ({
            value,
            label: label('finance.statuses', value),
          }))}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('finance.discrepancies')}
            rows={data.discrepancies}
            rowKey={(row) => row.id}
            empty={t('finance.emptyDiscrepancies')}
            columns={[
              {
                key: 'kind',
                header: t('finance.kind'),
                cell: (row) => label('finance.kinds', row.kind),
              },
              {
                key: 'subject',
                header: t('finance.subject'),
                cell: (row) => (
                  <span>
                    {label('finance.subjects', row.subjectType)}{' '}
                    <code className="text-caption">{row.subjectId.slice(0, 8)}</code>
                  </span>
                ),
              },
              {
                key: 'booking',
                header: t('finance.booking'),
                cell: (row) =>
                  row.bookingId ? (
                    <Link
                      href={`/bookings/${row.bookingId}` as Route}
                      className="font-bold text-primary underline focus-visible:focus-ring"
                    >
                      {row.bookingId.slice(0, 8)}
                    </Link>
                  ) : (
                    t('common.none')
                  ),
              },
              {
                key: 'expected',
                header: t('finance.expected'),
                cell: (row) => (row.expected ? format.money(row.expected) : t('common.none')),
              },
              {
                key: 'actual',
                header: t('finance.actual'),
                cell: (row) => (row.actual ? format.money(row.actual) : t('common.none')),
              },
              {
                key: 'detected',
                header: t('finance.detected'),
                cell: (row) => format.dateTime(row.detectedAt),
              },
              {
                key: 'status',
                header: t('finance.status'),
                cell: (row) => (
                  <StatusBadge tone={row.status === 'open' ? 'warning' : 'success'}>
                    {row.resolution
                      ? label('finance.resolutions', row.resolution)
                      : label('finance.statuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) =>
                  row.status === 'open' && can('finance:reconcile') ? (
                    <ResolveAction discrepancy={row} />
                  ) : null,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function Payouts() {
  const [status, setStatus] = useState<PayoutStatus | ''>('');
  const query = $api.useQuery('get', '/v1/admin/finance/payouts', {
    params: { query: status ? { status } : {} },
  });
  return (
    <Section title={t('finance.payouts')}>
      <div className="max-w-popover">
        <SelectField
          label={t('finance.payoutStatus')}
          name="payout-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as PayoutStatus | '')}
          options={[
            { value: '', label: t('common.all') },
            ...PAYOUT_STATUSES.map((value) => ({
              value,
              label: label('finance.payoutStatuses', value),
            })),
          ]}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('finance.payouts')}
            rows={data.payouts}
            rowKey={(row) => row.id}
            empty={t('finance.emptyPayouts')}
            columns={[
              { key: 'driver', header: t('finance.driver'), cell: (row) => row.driverName },
              {
                key: 'amount',
                header: t('finance.amount'),
                cell: (row) => format.money(row.amount),
              },
              {
                key: 'status',
                header: t('finance.payoutStatus'),
                cell: (row) => (
                  <StatusBadge
                    tone={
                      row.status === 'paid'
                        ? 'success'
                        : row.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {label('finance.payoutStatuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'failure',
                header: t('finance.failure'),
                cell: (row) => row.failureReason ?? t('common.none'),
              },
              { key: 'attempts', header: t('finance.attempts'), cell: (row) => row.attempts },
              {
                key: 'sent',
                header: t('finance.sent'),
                cell: (row) => format.dateTime(row.createdAt),
              },
              {
                key: 'settled',
                header: t('finance.settled'),
                cell: (row) => (row.settledAt ? format.dateTime(row.settledAt) : t('common.none')),
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

/** Reconciliation discrepancies and driver payouts (`finance:reconcile`, ADR-051). */
export function FinancePage() {
  return (
    <RequirePermission permission="finance:reconcile">
      <PageHeader title={t('finance.title')} intro={t('finance.intro')} />
      <Discrepancies />
      <Payouts />
    </RequirePermission>
  );
}
