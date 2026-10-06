'use client';

import { Button, Card } from '@suskii/ui-web';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { useStaffSession } from '../staff-session';
import { DataTable, PageHeader, ProblemAlert, QueryState, Section, TextField } from '../ui';

type Dashboard = Schemas['AdminDashboard'];

function Figure({ term, value, href }: { term: string; value: number; href?: Route }) {
  const body = (
    <>
      <span className="font-heading text-h3 font-extrabold text-heading">
        {format.number(value)}
      </span>
      <span className="font-body text-body-sm text-muted">{term}</span>
    </>
  );
  return (
    <Card className="flex flex-col gap-1 p-4">
      {href && value > 0 ? (
        <Link href={href} className="flex flex-col gap-1 focus-visible:focus-ring">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  const queues: { key: keyof Dashboard['queues']; href: Route }[] = [
    { key: 'refundsAwaitingApproval', href: '/refunds?status=pending_approval' },
    { key: 'refundsNeedingReview', href: '/refunds?status=needs_review' },
    { key: 'bookingsRefundPending', href: '/bookings?status=REFUND_PENDING' },
    { key: 'visaApplicationsToReview', href: '/visa?status=submitted' },
    { key: 'referralsInReview', href: '/referrals' },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Figure term={t('dashboard.bookings')} value={data.bookings.total} />
        <Figure term={t('dashboard.accountsCreated')} value={data.accounts.created} />
        <Figure term={t('dashboard.activePrimeMembers')} value={data.accounts.activePrimeMembers} />
        <Figure
          term={t('dashboard.refundsAwaitingApproval')}
          value={data.queues.refundsAwaitingApproval}
          href={'/refunds?status=pending_approval'}
        />
      </div>
      <Section title={t('dashboard.money')}>
        <DataTable
          caption={t('dashboard.money')}
          rows={data.money}
          rowKey={(row) => row.currency}
          empty={t('dashboard.noMoney')}
          columns={[
            { key: 'currency', header: t('common.currency'), cell: (row) => row.currency },
            {
              key: 'captured',
              header: t('dashboard.captured'),
              cell: (row) => format.money(row.captured),
            },
            {
              key: 'wallet',
              header: t('dashboard.fromWallet'),
              cell: (row) => format.money(row.fromWallet),
            },
            {
              key: 'refunded',
              header: t('dashboard.refunded'),
              cell: (row) => format.money(row.refunded),
            },
          ]}
        />
      </Section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title={t('dashboard.byStatus')}>
          <DataTable
            caption={t('dashboard.byStatus')}
            rows={data.bookings.byStatus}
            rowKey={(row) => row.status}
            columns={[
              {
                key: 'status',
                header: t('common.status'),
                cell: (row) => label('bookingStatus', row.status),
              },
              {
                key: 'count',
                header: t('dashboard.count'),
                cell: (row) => format.number(row.count),
              },
            ]}
          />
        </Section>
        <Section title={t('dashboard.byVertical')}>
          <DataTable
            caption={t('dashboard.byVertical')}
            rows={data.bookings.byVertical}
            rowKey={(row) => row.vertical}
            columns={[
              {
                key: 'vertical',
                header: t('bookings.vertical'),
                cell: (row) => label('verticals', row.vertical),
              },
              {
                key: 'count',
                header: t('dashboard.count'),
                cell: (row) => format.number(row.count),
              },
            ]}
          />
        </Section>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title={t('dashboard.queues')}>
          <ul className="flex flex-col gap-2 font-body text-body-sm">
            {queues.map(({ key, href }) => (
              <li key={key} className="flex items-center justify-between gap-4">
                {data.queues[key] > 0 ? (
                  <Link href={href} className="text-primary underline focus-visible:focus-ring">
                    {t(`dashboard.${key}`)}
                  </Link>
                ) : (
                  <span>{t(`dashboard.${key}`)}</span>
                )}
                <span className="font-bold">{format.number(data.queues[key])}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={t('dashboard.topRoutes')}>
          <DataTable
            caption={t('dashboard.topRoutes')}
            rows={data.topRoutes}
            rowKey={(row) => `${row.origin}-${row.destination}`}
            empty={t('dashboard.noRoutes')}
            columns={[
              {
                key: 'route',
                header: t('dashboard.route'),
                cell: (row) => `${row.origin} → ${row.destination}`,
              },
              {
                key: 'count',
                header: t('dashboard.count'),
                cell: (row) => format.number(row.bookings),
              },
            ]}
          />
        </Section>
      </div>
      <p className="font-body text-caption text-muted">
        {t('dashboard.generated', { time: format.dateTime(data.generatedAt) })}
      </p>
    </>
  );
}

function Reports() {
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const query = $api.useQuery('get', '/v1/admin/dashboard', { params: { query: range } });
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setRange({
      ...(draft.from ? { from: draft.from } : {}),
      ...(draft.to ? { to: draft.to } : {}),
    });
  };
  return (
    <>
      <PageHeader title={t('dashboard.title')} intro={t('dashboard.intro')} />
      <form
        onSubmit={apply}
        aria-label={t('dashboard.period')}
        className="flex flex-col gap-3 md:flex-row md:items-end"
      >
        <TextField
          label={t('common.from')}
          type="date"
          name="from"
          value={draft.from || (query.data?.range.from ?? '')}
          onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
        />
        <TextField
          label={t('common.to')}
          type="date"
          name="to"
          value={draft.to || (query.data?.range.to ?? '')}
          onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
        />
        <Button type="submit">{t('common.apply')}</Button>
      </form>
      {query.error && query.data ? <ProblemAlert error={query.error} /> : null}
      <QueryState query={query}>{(data) => <DashboardBody data={data} />}</QueryState>
    </>
  );
}

export function DashboardPage() {
  const { can } = useStaffSession();
  if (!can('reports:read')) {
    return <PageHeader title={t('dashboard.welcome')} intro={t('dashboard.welcomeBody')} />;
  }
  return <Reports />;
}
