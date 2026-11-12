'use client';

import { SUPPORTED_CURRENCIES } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import {
  bpsFromPercent,
  fieldIssues,
  inputFromMinor,
  isoFromLocalInput,
  localInputFromIso,
  minorFromInput,
  nullable,
  percentFromBps,
} from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
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
  TextField,
} from '../ui';

import { VERTICALS } from './pricing';

type Promo = Schemas['AdminPromoCode'];

interface PromoForm {
  code: string;
  description: string;
  type: 'percentage' | 'fixed';
  value: string;
  currency: string;
  maxDiscount: string;
  minSpend: string;
  verticals: string[];
  validFrom: string;
  validTo: string;
  maxRedemptions: string;
  maxRedemptionsPerUser: string;
  requiresAccount: boolean;
  active: boolean;
}

function initialForm(promo: Promo | null): PromoForm {
  const currency = promo?.currency ?? '';
  return {
    code: promo?.code ?? '',
    description: promo?.description ?? '',
    type: promo?.type ?? 'percentage',
    value: promo
      ? promo.type === 'percentage'
        ? percentFromBps(promo.value)
        : inputFromMinor(promo.value, currency || null)
      : '',
    currency,
    maxDiscount: inputFromMinor(promo?.maxDiscountMinor ?? null, currency || null),
    minSpend: inputFromMinor(promo?.minSpendMinor ?? null, currency || null),
    verticals: promo?.verticals ?? [],
    validFrom: localInputFromIso(promo?.validFrom ?? null),
    validTo: localInputFromIso(promo?.validTo ?? null),
    maxRedemptions: promo?.maxRedemptions === null || !promo ? '' : String(promo.maxRedemptions),
    maxRedemptionsPerUser:
      promo?.maxRedemptionsPerUser === null || !promo ? '' : String(promo.maxRedemptionsPerUser),
    requiresAccount: promo?.requiresAccount ?? false,
    active: promo?.active ?? true,
  };
}

const optionalInt = (value: string): number | null => (value.trim() ? Number(value) : null);

function PromoDialog({ promo }: { promo: Promo | null }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PromoForm>(() => initialForm(promo));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/promos'] });
  };
  const create = $api.useMutation('post', '/v1/admin/promos', { onSuccess });
  const update = $api.useMutation('patch', '/v1/admin/promos/{id}', { onSuccess });
  const mutation = promo ? update : create;
  const errors = { ...fieldIssues(mutation.error), ...localErrors };
  const set = <K extends keyof PromoForm>(key: K, value: PromoForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const currency = form.currency || null;
    const value =
      form.type === 'percentage'
        ? bpsFromPercent(form.value)
        : minorFromInput(form.value, currency ?? 'NGN');
    const maxDiscount = minorFromInput(form.maxDiscount, currency ?? 'NGN');
    const minSpend = minorFromInput(form.minSpend, currency ?? 'NGN');
    const problems: Record<string, string> = {};
    if (value === null || Number.isNaN(value)) {
      problems.value =
        form.type === 'percentage' ? t('validation.percent') : t('validation.amount');
    }
    if (Number.isNaN(maxDiscount)) problems.maxDiscountMinor = t('validation.amount');
    if (Number.isNaN(minSpend)) problems.minSpendMinor = t('validation.amount');
    setLocalErrors(problems);
    if (Object.keys(problems).length > 0 || value === null) return;
    const body = {
      code: form.code.trim(),
      description: nullable(form.description),
      type: form.type,
      value,
      currency,
      maxDiscountMinor: maxDiscount,
      minSpendMinor: minSpend,
      verticals: form.verticals as Promo['verticals'],
      validFrom: isoFromLocalInput(form.validFrom),
      validTo: isoFromLocalInput(form.validTo),
      maxRedemptions: optionalInt(form.maxRedemptions),
      maxRedemptionsPerUser: optionalInt(form.maxRedemptionsPerUser),
      requiresAccount: form.requiresAccount,
      active: form.active,
    };
    if (promo) update.mutate({ params: { path: { id: promo.id } }, body });
    else create.mutate({ body });
  };

  const title = promo ? t('promos.edit') : t('promos.new');
  return (
    <FormDialog
      triggerLabel={promo ? t('common.edit') : title}
      triggerVariant={promo ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initialForm(promo));
          setLocalErrors({});
          mutation.reset();
        }
      }}
      testId={promo ? `edit-promo-${promo.code}` : 'new-promo'}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('promos.code')}
            hint={t('promos.codeHint')}
            name="code"
            value={form.code}
            required
            maxLength={20}
            error={errors.code}
            onChange={(event) => set('code', event.target.value)}
            data-testid="promo-code"
          />
          <TextField
            label={t('promos.description')}
            name="description"
            value={form.description}
            maxLength={200}
            onChange={(event) => set('description', event.target.value)}
          />
          <SelectField
            label={t('pricing.type')}
            name="type"
            value={form.type}
            options={(['percentage', 'fixed'] as const).map((value) => ({
              value,
              label: label('pricing.types', value),
            }))}
            onChange={(event) => set('type', event.target.value as PromoForm['type'])}
          />
          <TextField
            label={form.type === 'percentage' ? t('pricing.percent') : t('pricing.fixedAmount')}
            name="value"
            inputMode="decimal"
            value={form.value}
            required
            error={errors.value}
            onChange={(event) => set('value', event.target.value)}
            data-testid="promo-value"
          />
          <SelectField
            label={t('common.currency')}
            name="currency"
            value={form.currency}
            error={errors.currency}
            options={[
              { value: '', label: t('common.none') },
              ...SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: code })),
            ]}
            onChange={(event) => set('currency', event.target.value)}
          />
          <TextField
            label={t('promos.maxDiscount')}
            name="maxDiscount"
            inputMode="decimal"
            value={form.maxDiscount}
            error={errors.maxDiscountMinor}
            onChange={(event) => set('maxDiscount', event.target.value)}
          />
          <TextField
            label={t('promos.minSpend')}
            name="minSpend"
            inputMode="decimal"
            value={form.minSpend}
            error={errors.minSpendMinor}
            onChange={(event) => set('minSpend', event.target.value)}
          />
          <TextField
            label={t('promos.maxRedemptions')}
            name="maxRedemptions"
            type="number"
            min={1}
            value={form.maxRedemptions}
            onChange={(event) => set('maxRedemptions', event.target.value)}
          />
          <TextField
            label={t('promos.maxRedemptionsPerUser')}
            name="maxRedemptionsPerUser"
            type="number"
            min={1}
            value={form.maxRedemptionsPerUser}
            error={errors.maxRedemptionsPerUser}
            onChange={(event) => set('maxRedemptionsPerUser', event.target.value)}
          />
          <TextField
            label={t('promos.validFrom')}
            name="validFrom"
            type="datetime-local"
            value={form.validFrom}
            onChange={(event) => set('validFrom', event.target.value)}
          />
          <TextField
            label={t('promos.validTo')}
            name="validTo"
            type="datetime-local"
            value={form.validTo}
            error={errors.validTo}
            onChange={(event) => set('validTo', event.target.value)}
          />
        </FormGrid>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-body text-body-sm font-medium text-foreground">
            {t('promos.verticals')}
          </legend>
          <p className="font-body text-caption text-muted">{t('promos.verticalsHint')}</p>
          <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
            {VERTICALS.map((vertical) => (
              <CheckboxField
                key={vertical}
                label={label('verticals', vertical)}
                name={`vertical-${vertical}`}
                checked={form.verticals.includes(vertical)}
                onChange={(event) =>
                  set(
                    'verticals',
                    event.target.checked
                      ? [...form.verticals, vertical]
                      : form.verticals.filter((value) => value !== vertical),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
        <CheckboxField
          label={t('promos.requiresAccount')}
          name="requiresAccount"
          checked={form.requiresAccount}
          onChange={(event) => set('requiresAccount', event.target.checked)}
        />
        <CheckboxField
          label={t('common.active')}
          name="active"
          checked={form.active}
          onChange={(event) => set('active', event.target.checked)}
        />
        <ProblemAlert error={mutation.error} />
        <Button type="submit" loading={mutation.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function discount(promo: Promo): string {
  return promo.type === 'percentage'
    ? `${percentFromBps(promo.value)}%`
    : format.money({ amountMinor: promo.value, currency: promo.currency ?? 'NGN' });
}

function validity(promo: Promo): string {
  if (!promo.validFrom && !promo.validTo) return t('common.none');
  return [promo.validFrom, promo.validTo]
    .map((value) => (value ? format.dateTime(value) : '…'))
    .join(' – ');
}

export function PromosPage() {
  const [filters, setFilters] = useState<{ q?: string; active?: 'true' | 'false' }>({});
  const [draft, setDraft] = useState({ q: '', active: '' });
  const pages = useCursorPages(['get', '/v1/admin/promos', filters], async (cursor) =>
    unwrap(
      await adminApi.GET('/v1/admin/promos', {
        params: { query: { ...filters, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters({
      ...(draft.q.trim() ? { q: draft.q.trim() } : {}),
      ...(draft.active ? { active: draft.active as 'true' | 'false' } : {}),
    });
  };
  return (
    <RequirePermission permission="deals:manage">
      <PageHeader
        title={t('promos.title')}
        intro={t('promos.intro')}
        actions={<PromoDialog promo={null} />}
      />
      <form method="post" onSubmit={apply} className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <TextField
            label={t('promos.search')}
            name="q"
            value={draft.q}
            onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
          />
        </div>
        <SelectField
          label={t('common.status')}
          name="active"
          value={draft.active}
          options={[
            { value: '', label: t('common.all') },
            { value: 'true', label: t('common.active') },
            { value: 'false', label: t('common.inactive') },
          ]}
          onChange={(event) => setDraft((current) => ({ ...current, active: event.target.value }))}
        />
        <Button type="submit">{t('common.search')}</Button>
      </form>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) => (
          <>
            <DataTable
              caption={t('promos.title')}
              rows={items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'code',
                  header: t('promos.code'),
                  cell: (row) => <code className="font-bold">{row.code}</code>,
                },
                { key: 'discount', header: t('promos.discount'), cell: discount },
                {
                  key: 'verticals',
                  header: t('promos.verticals'),
                  cell: (row) =>
                    row.verticals.length > 0
                      ? row.verticals.map((vertical) => label('verticals', vertical)).join(', ')
                      : t('common.all'),
                },
                {
                  key: 'uses',
                  header: t('common.total'),
                  cell: (row) => t('promos.redemptions', { count: row.redemptions }),
                },
                { key: 'validity', header: t('promos.validFrom'), cell: validity },
                {
                  key: 'active',
                  header: t('common.status'),
                  cell: (row) => (
                    <StatusBadge tone={row.active ? 'success' : 'neutral'}>
                      {row.active ? t('common.active') : t('common.inactive')}
                    </StatusBadge>
                  ),
                },
                {
                  key: 'actions',
                  header: t('common.actions'),
                  cell: (row) => <PromoDialog promo={row} />,
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
        )}
      </QueryState>
    </RequirePermission>
  );
}
