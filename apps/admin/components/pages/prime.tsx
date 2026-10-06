'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import {
  bpsFromPercent,
  fieldIssues,
  inputFromMinor,
  minorFromInput,
  percentFromBps,
} from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import {
  CheckboxField,
  DataTable,
  FormDialog,
  FormGrid,
  PageHeader,
  ProblemAlert,
  QueryState,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../ui';

type Plan = Schemas['AdminPrimePlan'];
type PlanStatus = Plan['status'];
type Period = Plan['period'];

interface PlanForm {
  slug: string;
  name: string;
  summary: string;
  period: Period;
  prices: string;
  markupShare: string;
  waivedFees: string;
  prioritySupport: boolean;
  sortOrder: string;
  status: PlanStatus;
}

const PERIODS = ['year', 'month'] as const satisfies readonly Period[];
const STATUSES = ['draft', 'published', 'archived'] as const satisfies readonly PlanStatus[];

export const planTone = (status: PlanStatus) =>
  status === 'published' ? 'success' : status === 'archived' ? 'neutral' : 'warning';

/** "NGN 25000" lines from stored prices, one per currency. */
const pricesText = (prices: Plan['prices']): string =>
  prices
    .map((price) => `${price.currency} ${inputFromMinor(price.amountMinor, price.currency)}`)
    .join('\n');

/** Prices from "NGN 25000" lines; null when any line is not a currency code and a positive amount. */
export function parsePrices(text: string): { amountMinor: number; currency: string }[] | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const prices: { amountMinor: number; currency: string }[] = [];
  for (const line of lines) {
    const match = /^([A-Za-z]{3})\s+(\S+)$/.exec(line);
    if (!match?.[1] || !match[2]) return null;
    const currency = match[1].toUpperCase();
    const amountMinor = minorFromInput(match[2], currency);
    if (amountMinor === null || Number.isNaN(amountMinor) || amountMinor <= 0) return null;
    if (prices.some((price) => price.currency === currency)) return null;
    prices.push({ amountMinor, currency });
  }
  return prices;
}

function initialForm(plan: Plan | null): PlanForm {
  return {
    slug: plan?.slug ?? '',
    name: plan?.name ?? '',
    summary: plan?.summary ?? '',
    period: plan?.period ?? 'year',
    prices: plan ? pricesText(plan.prices) : '',
    markupShare: plan ? percentFromBps(plan.benefits.markupShareBps) : '0',
    waivedFees: plan?.benefits.waivedFeeCodes.join(', ') ?? '',
    prioritySupport: plan?.benefits.prioritySupport ?? false,
    sortOrder: String(plan?.sortOrder ?? 0),
    status: plan?.status ?? 'draft',
  };
}

function PlanDialog({ plan }: { plan: Plan | null }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PlanForm>(() => initialForm(plan));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/prime/plans'] });
  };
  const create = $api.useMutation('post', '/v1/admin/prime/plans', { onSuccess });
  const update = $api.useMutation('patch', '/v1/admin/prime/plans/{id}', { onSuccess });
  const mutation = plan ? update : create;
  const errors = { ...fieldIssues(mutation.error), ...localErrors };
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prices = parsePrices(form.prices);
    const markupShareBps = bpsFromPercent(form.markupShare);
    const problems: Record<string, string> = {};
    if (!prices) problems.prices = t('prime.pricesInvalid');
    if (Number.isNaN(markupShareBps) || markupShareBps > 10_000) {
      problems.benefits = t('validation.percent');
    }
    setLocalErrors(problems);
    if (!prices || Object.keys(problems).length > 0) return;
    const shared = {
      name: form.name.trim(),
      summary: form.summary.trim(),
      prices,
      benefits: {
        markupShareBps,
        waivedFeeCodes: form.waivedFees
          .split(',')
          .map((code) => code.trim())
          .filter(Boolean),
        prioritySupport: form.prioritySupport,
      },
      sortOrder: Number(form.sortOrder) || 0,
    };
    if (plan) {
      update.mutate({
        params: { path: { id: plan.id } },
        body: { ...shared, status: form.status },
      });
    } else {
      create.mutate({ body: { ...shared, slug: form.slug.trim(), period: form.period } });
    }
  };

  const title = plan ? t('prime.edit') : t('prime.new');
  return (
    <FormDialog
      triggerLabel={plan ? t('common.edit') : title}
      triggerVariant={plan ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initialForm(plan));
          setLocalErrors({});
          mutation.reset();
        }
      }}
      testId={plan ? `edit-plan-${plan.slug}` : 'new-plan'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          {/* Slug and period identify what members bought, so they are fixed after creation. */}
          <TextField
            label={t('prime.slug')}
            name="slug"
            value={form.slug}
            required
            disabled={Boolean(plan)}
            maxLength={80}
            error={errors.slug}
            onChange={(event) => set('slug', event.target.value)}
          />
          <SelectField
            label={t('prime.period')}
            name="period"
            value={form.period}
            disabled={Boolean(plan)}
            options={PERIODS.map((value) => ({ value, label: label('prime.periods', value) }))}
            onChange={(event) => set('period', event.target.value as Period)}
          />
          <TextField
            label={t('prime.name')}
            name="name"
            value={form.name}
            required
            maxLength={80}
            error={errors.name}
            onChange={(event) => set('name', event.target.value)}
          />
          <TextField
            label={t('prime.sortOrder')}
            name="sortOrder"
            type="number"
            min={0}
            max={1000}
            value={form.sortOrder}
            error={errors.sortOrder}
            onChange={(event) => set('sortOrder', event.target.value)}
          />
        </FormGrid>
        <TextAreaField
          label={t('prime.summary')}
          name="summary"
          value={form.summary}
          required
          maxLength={300}
          rows={2}
          error={errors.summary}
          onChange={(event) => set('summary', event.target.value)}
        />
        <TextAreaField
          label={t('prime.prices')}
          hint={t('prime.pricesHint')}
          name="prices"
          value={form.prices}
          required
          rows={3}
          error={errors.prices}
          onChange={(event) => set('prices', event.target.value)}
        />
        <FormGrid>
          <TextField
            label={t('prime.markupShare')}
            name="markupShare"
            inputMode="decimal"
            value={form.markupShare}
            required
            error={errors.benefits}
            onChange={(event) => set('markupShare', event.target.value)}
          />
          <TextField
            label={t('prime.waivedFees')}
            name="waivedFees"
            value={form.waivedFees}
            onChange={(event) => set('waivedFees', event.target.value)}
          />
          {plan ? (
            <SelectField
              label={t('common.status')}
              name="status"
              value={form.status}
              error={errors.status}
              options={STATUSES.map((value) => ({ value, label: label('prime.statuses', value) }))}
              onChange={(event) => set('status', event.target.value as PlanStatus)}
            />
          ) : null}
        </FormGrid>
        <CheckboxField
          label={t('prime.prioritySupport')}
          name="prioritySupport"
          checked={form.prioritySupport}
          onChange={(event) => set('prioritySupport', event.target.checked)}
        />
        <ProblemAlert error={mutation.error} />
        <Button type="submit" loading={mutation.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

export function PrimePage() {
  const query = $api.useQuery('get', '/v1/admin/prime/plans');
  return (
    <RequirePermission permission="pricing:manage">
      <PageHeader
        title={t('prime.title')}
        intro={t('prime.intro')}
        actions={<PlanDialog plan={null} />}
      />
      <QueryState query={{ ...query, data: query.data?.plans }}>
        {(plans) => (
          <DataTable
            caption={t('prime.title')}
            rows={plans}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'name',
                header: t('prime.name'),
                cell: (row) => (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{row.name}</span>
                    {row.sample ? (
                      <StatusBadge tone="info">{t('catalog.sample')}</StatusBadge>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'period',
                header: t('prime.period'),
                cell: (row) => label('prime.periods', row.period),
              },
              {
                key: 'prices',
                header: t('prime.prices'),
                cell: (row) => row.prices.map((price) => format.money(price)).join(' · '),
              },
              {
                key: 'markup',
                header: t('prime.markupShare'),
                cell: (row) => `${percentFromBps(row.benefits.markupShareBps)}%`,
              },
              {
                key: 'members',
                header: t('prime.membersHeader'),
                cell: (row) => t('prime.members', { count: row.activeMembers }),
              },
              {
                key: 'status',
                header: t('common.status'),
                cell: (row) => (
                  <StatusBadge tone={planTone(row.status)}>
                    {label('prime.statuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <PlanDialog plan={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </RequirePermission>
  );
}
