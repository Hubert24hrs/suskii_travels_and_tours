'use client';

import { CABIN_CLASSES, SUPPORTED_CURRENCIES } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
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
import { RequirePermission } from '../console-shell';
import {
  CheckboxField,
  DataTable,
  FormDialog,
  FormGrid,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  TextField,
  type SelectOption,
} from '../ui';

type Markup = Schemas['AdminMarkupRule'];
type Fee = Schemas['AdminFeeRule'];
type Kind = 'markup' | 'fee';

export const VERTICALS = [
  'flights',
  'hotels',
  'packages',
  'tours',
  'visa',
  'travel_addons',
  'prime',
] as const;
type Vertical = (typeof VERTICALS)[number];

export const verticalOptions: SelectOption[] = VERTICALS.map((vertical) => ({
  value: vertical,
  label: label('verticals', vertical),
}));

const anyOption = (labelKey: 'common.any' = 'common.any'): SelectOption => ({
  value: '',
  label: t(labelKey),
});

/** "2.5%" or "₦1,500", with the caps when set. */
function adjustment(rule: Markup | Fee): string {
  const value =
    rule.type === 'percentage'
      ? `${percentFromBps(rule.value)}%`
      : format.money({ amountMinor: rule.value, currency: rule.currency ?? 'NGN' });
  const caps = [
    rule.minAmountMinor !== null && rule.currency
      ? `${t('pricing.min')} ${format.money({ amountMinor: rule.minAmountMinor, currency: rule.currency })}`
      : null,
    rule.maxAmountMinor !== null && rule.currency
      ? `${t('pricing.max')} ${format.money({ amountMinor: rule.maxAmountMinor, currency: rule.currency })}`
      : null,
  ].filter(Boolean);
  return caps.length > 0 ? `${value} (${caps.join(', ')})` : value;
}

function conditions(rule: Markup | Fee): string {
  const parts: string[] = [];
  if (rule.channel) parts.push(label('pricing.channels', rule.channel));
  if (rule.userTier) parts.push(label('pricing.tiers', rule.userTier));
  if ('supplier' in rule) {
    if (rule.supplier) parts.push(rule.supplier);
    const from = rule.originCode ?? rule.originCountry;
    const to = rule.destinationCode ?? rule.destinationCountry;
    if (from || to) parts.push(`${from ?? '*'} → ${to ?? '*'}`);
    if (rule.carrierCode) parts.push(rule.carrierCode);
    if (rule.cabinClass) parts.push(label('pricing.cabins', rule.cabinClass));
  }
  return parts.length > 0 ? parts.join(' · ') : t('pricing.anything');
}

interface RuleForm {
  name: string;
  code: string;
  label: string;
  vertical: Vertical;
  priority: string;
  sortOrder: string;
  active: boolean;
  channel: string;
  userTier: string;
  supplier: string;
  originCode: string;
  destinationCode: string;
  originCountry: string;
  destinationCountry: string;
  carrierCode: string;
  cabinClass: string;
  type: 'percentage' | 'fixed';
  value: string;
  currency: string;
  basis: 'per_booking' | 'per_passenger';
  min: string;
  max: string;
  validFrom: string;
  validTo: string;
}

function initialForm(rule: Markup | Fee | null): RuleForm {
  const currency = rule?.currency ?? '';
  return {
    name: rule && 'name' in rule ? rule.name : '',
    code: rule && 'code' in rule ? rule.code : '',
    label: rule && 'label' in rule ? rule.label : '',
    vertical: rule?.vertical ?? 'flights',
    priority: rule && 'priority' in rule ? String(rule.priority) : '100',
    sortOrder: rule && 'sortOrder' in rule ? String(rule.sortOrder) : '0',
    active: rule?.active ?? true,
    channel: rule?.channel ?? '',
    userTier: rule?.userTier ?? '',
    supplier: rule && 'supplier' in rule ? (rule.supplier ?? '') : '',
    originCode: rule && 'originCode' in rule ? (rule.originCode ?? '') : '',
    destinationCode: rule && 'destinationCode' in rule ? (rule.destinationCode ?? '') : '',
    originCountry: rule && 'originCountry' in rule ? (rule.originCountry ?? '') : '',
    destinationCountry: rule && 'destinationCountry' in rule ? (rule.destinationCountry ?? '') : '',
    carrierCode: rule && 'carrierCode' in rule ? (rule.carrierCode ?? '') : '',
    cabinClass: rule && 'cabinClass' in rule ? (rule.cabinClass ?? '') : '',
    type: rule?.type ?? 'percentage',
    value: rule
      ? rule.type === 'percentage'
        ? percentFromBps(rule.value)
        : inputFromMinor(rule.value, currency || null)
      : '',
    currency,
    basis: rule && 'basis' in rule ? rule.basis : 'per_booking',
    min: inputFromMinor(rule?.minAmountMinor ?? null, currency || null),
    max: inputFromMinor(rule?.maxAmountMinor ?? null, currency || null),
    validFrom: localInputFromIso(rule?.validFrom ?? null),
    validTo: localInputFromIso(rule?.validTo ?? null),
  };
}

const upper = (value: string) => nullable(value.toUpperCase());

function RuleFormDialog({ kind, rule }: { kind: Kind; rule: Markup | Fee | null }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RuleForm>(() => initialForm(rule));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await queryClient.invalidateQueries({
      queryKey: ['get', `/v1/admin/pricing/${kind === 'markup' ? 'markups' : 'fees'}`],
    });
  };
  const createMarkup = $api.useMutation('post', '/v1/admin/pricing/markups', { onSuccess });
  const updateMarkup = $api.useMutation('patch', '/v1/admin/pricing/markups/{id}', { onSuccess });
  const createFee = $api.useMutation('post', '/v1/admin/pricing/fees', { onSuccess });
  const updateFee = $api.useMutation('patch', '/v1/admin/pricing/fees/{id}', { onSuccess });
  const mutation =
    kind === 'markup' ? (rule ? updateMarkup : createMarkup) : rule ? updateFee : createFee;
  const errors = { ...fieldIssues(mutation.error), ...localErrors };
  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const currency = form.currency || null;
    const value =
      form.type === 'percentage'
        ? bpsFromPercent(form.value)
        : minorFromInput(form.value, currency ?? 'NGN');
    const min = minorFromInput(form.min, currency ?? 'NGN');
    const max = minorFromInput(form.max, currency ?? 'NGN');
    const problems: Record<string, string> = {};
    if (value === null || Number.isNaN(value)) {
      problems.value =
        form.type === 'percentage' ? t('validation.percent') : t('validation.amount');
    }
    if (Number.isNaN(min)) problems.minAmountMinor = t('validation.amount');
    if (Number.isNaN(max)) problems.maxAmountMinor = t('validation.amount');
    setLocalErrors(problems);
    if (Object.keys(problems).length > 0 || value === null) return;
    const shared = {
      vertical: form.vertical,
      active: form.active,
      channel: (form.channel || null) as Markup['channel'],
      userTier: (form.userTier || null) as Markup['userTier'],
      type: form.type,
      value,
      currency,
      minAmountMinor: min,
      maxAmountMinor: max,
      validFrom: isoFromLocalInput(form.validFrom),
      validTo: isoFromLocalInput(form.validTo),
    };
    if (kind === 'markup') {
      const body = {
        ...shared,
        name: form.name.trim(),
        priority: Number(form.priority),
        supplier: nullable(form.supplier),
        originCode: upper(form.originCode),
        destinationCode: upper(form.destinationCode),
        originCountry: upper(form.originCountry),
        destinationCountry: upper(form.destinationCountry),
        carrierCode: upper(form.carrierCode),
        cabinClass: (form.cabinClass || null) as Markup['cabinClass'],
      };
      if (rule) updateMarkup.mutate({ params: { path: { id: rule.id } }, body });
      else createMarkup.mutate({ body });
    } else {
      const body = {
        ...shared,
        code: form.code.trim(),
        label: form.label.trim(),
        sortOrder: Number(form.sortOrder),
        basis: form.basis,
      };
      if (rule) updateFee.mutate({ params: { path: { id: rule.id } }, body });
      else createFee.mutate({ body });
    }
  };

  const title = rule
    ? t(kind === 'markup' ? 'pricing.editMarkup' : 'pricing.editFee')
    : t(kind === 'markup' ? 'pricing.newMarkup' : 'pricing.newFee');
  const currencyOptions = [
    anyOption(),
    ...SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: code })),
  ];

  return (
    <FormDialog
      triggerLabel={rule ? t('common.edit') : title}
      triggerVariant={rule ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initialForm(rule));
          setLocalErrors({});
          mutation.reset();
        }
      }}
      testId={rule ? `edit-${kind}-${rule.id}` : `new-${kind}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          {kind === 'markup' ? (
            <>
              <TextField
                label={t('pricing.name')}
                name="name"
                value={form.name}
                required
                error={errors.name}
                onChange={(event) => set('name', event.target.value)}
              />
              <TextField
                label={t('pricing.priority')}
                hint={t('pricing.priorityHint')}
                name="priority"
                type="number"
                min={0}
                max={10000}
                value={form.priority}
                required
                error={errors.priority}
                onChange={(event) => set('priority', event.target.value)}
              />
            </>
          ) : (
            <>
              <TextField
                label={t('pricing.code')}
                hint={t('pricing.codeHint')}
                name="code"
                value={form.code}
                required
                error={errors.code}
                onChange={(event) => set('code', event.target.value)}
              />
              <TextField
                label={t('pricing.label')}
                name="label"
                value={form.label}
                required
                error={errors.label}
                onChange={(event) => set('label', event.target.value)}
              />
            </>
          )}
          <SelectField
            label={t('pricing.vertical')}
            name="vertical"
            value={form.vertical}
            options={verticalOptions}
            onChange={(event) => set('vertical', event.target.value as Vertical)}
          />
          {kind === 'fee' ? (
            <>
              <SelectField
                label={t('pricing.basis')}
                name="basis"
                value={form.basis}
                options={(['per_booking', 'per_passenger'] as const).map((value) => ({
                  value,
                  label: label('pricing.bases', value),
                }))}
                onChange={(event) => set('basis', event.target.value as RuleForm['basis'])}
              />
              <TextField
                label={t('pricing.sortOrder')}
                name="sortOrder"
                type="number"
                min={0}
                max={10000}
                value={form.sortOrder}
                onChange={(event) => set('sortOrder', event.target.value)}
              />
            </>
          ) : null}
          <SelectField
            label={t('pricing.type')}
            name="type"
            value={form.type}
            options={(['percentage', 'fixed'] as const).map((value) => ({
              value,
              label: label('pricing.types', value),
            }))}
            onChange={(event) => set('type', event.target.value as RuleForm['type'])}
          />
          <TextField
            label={form.type === 'percentage' ? t('pricing.percent') : t('pricing.fixedAmount')}
            name="value"
            inputMode="decimal"
            value={form.value}
            required
            error={errors.value}
            onChange={(event) => set('value', event.target.value)}
            data-testid="rule-value"
          />
          <SelectField
            label={t('common.currency')}
            name="currency"
            value={form.currency}
            options={currencyOptions}
            error={errors.currency}
            onChange={(event) => set('currency', event.target.value)}
          />
          <TextField
            label={t('pricing.min')}
            name="min"
            inputMode="decimal"
            value={form.min}
            error={errors.minAmountMinor}
            onChange={(event) => set('min', event.target.value)}
          />
          <TextField
            label={t('pricing.max')}
            name="max"
            inputMode="decimal"
            value={form.max}
            error={errors.maxAmountMinor}
            onChange={(event) => set('max', event.target.value)}
          />
          <SelectField
            label={t('pricing.channel')}
            name="channel"
            value={form.channel}
            options={[
              anyOption(),
              ...(['web', 'mobile'] as const).map((value) => ({
                value,
                label: label('pricing.channels', value),
              })),
            ]}
            onChange={(event) => set('channel', event.target.value)}
          />
          <SelectField
            label={t('pricing.userTier')}
            name="userTier"
            value={form.userTier}
            options={[
              anyOption(),
              ...(['guest', 'member', 'prime'] as const).map((value) => ({
                value,
                label: label('pricing.tiers', value),
              })),
            ]}
            onChange={(event) => set('userTier', event.target.value)}
          />
          {kind === 'markup' ? (
            <>
              <TextField
                label={t('pricing.supplier')}
                name="supplier"
                value={form.supplier}
                onChange={(event) => set('supplier', event.target.value)}
              />
              <SelectField
                label={t('pricing.cabin')}
                name="cabinClass"
                value={form.cabinClass}
                options={[
                  anyOption(),
                  ...CABIN_CLASSES.map((value) => ({
                    value,
                    label: label('pricing.cabins', value),
                  })),
                ]}
                onChange={(event) => set('cabinClass', event.target.value)}
              />
              <TextField
                label={t('pricing.origin')}
                name="originCode"
                maxLength={3}
                value={form.originCode}
                error={errors.originCode}
                onChange={(event) => set('originCode', event.target.value)}
              />
              <TextField
                label={t('pricing.destination')}
                name="destinationCode"
                maxLength={3}
                value={form.destinationCode}
                error={errors.destinationCode}
                onChange={(event) => set('destinationCode', event.target.value)}
              />
              <TextField
                label={t('pricing.originCountry')}
                name="originCountry"
                maxLength={2}
                value={form.originCountry}
                error={errors.originCountry}
                onChange={(event) => set('originCountry', event.target.value)}
              />
              <TextField
                label={t('pricing.destinationCountry')}
                name="destinationCountry"
                maxLength={2}
                value={form.destinationCountry}
                error={errors.destinationCountry}
                onChange={(event) => set('destinationCountry', event.target.value)}
              />
              <TextField
                label={t('pricing.carrier')}
                name="carrierCode"
                maxLength={3}
                value={form.carrierCode}
                error={errors.carrierCode}
                onChange={(event) => set('carrierCode', event.target.value)}
              />
            </>
          ) : null}
          <TextField
            label={t('pricing.validFrom')}
            name="validFrom"
            type="datetime-local"
            value={form.validFrom}
            onChange={(event) => set('validFrom', event.target.value)}
          />
          <TextField
            label={t('pricing.validTo')}
            name="validTo"
            type="datetime-local"
            value={form.validTo}
            error={errors.validTo}
            onChange={(event) => set('validTo', event.target.value)}
          />
        </FormGrid>
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

const activeBadge = (active: boolean) => (
  <StatusBadge tone={active ? 'success' : 'neutral'}>
    {active ? t('common.active') : t('common.inactive')}
  </StatusBadge>
);

function Markups() {
  const query = $api.useQuery('get', '/v1/admin/pricing/markups', {});
  return (
    <Section title={t('pricing.markups')} actions={<RuleFormDialog kind="markup" rule={null} />}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('pricing.markups')}
            rows={data.rules}
            rowKey={(row) => row.id}
            empty={t('pricing.noMarkups')}
            columns={[
              { key: 'name', header: t('pricing.name'), cell: (row) => row.name },
              {
                key: 'vertical',
                header: t('pricing.vertical'),
                cell: (row) => label('verticals', row.vertical),
              },
              { key: 'priority', header: t('pricing.priority'), cell: (row) => row.priority },
              { key: 'conditions', header: t('pricing.conditions'), cell: conditions },
              { key: 'value', header: t('pricing.value'), cell: adjustment },
              { key: 'active', header: t('common.status'), cell: (row) => activeBadge(row.active) },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <RuleFormDialog kind="markup" rule={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function Fees() {
  const query = $api.useQuery('get', '/v1/admin/pricing/fees', {});
  return (
    <Section title={t('pricing.fees')} actions={<RuleFormDialog kind="fee" rule={null} />}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('pricing.fees')}
            rows={data.rules}
            rowKey={(row) => row.id}
            empty={t('pricing.noFees')}
            columns={[
              {
                key: 'label',
                header: t('pricing.label'),
                cell: (row) => `${row.label} (${row.code})`,
              },
              {
                key: 'vertical',
                header: t('pricing.vertical'),
                cell: (row) => label('verticals', row.vertical),
              },
              {
                key: 'basis',
                header: t('pricing.basis'),
                cell: (row) => label('pricing.bases', row.basis),
              },
              { key: 'conditions', header: t('pricing.conditions'), cell: conditions },
              { key: 'value', header: t('pricing.value'), cell: adjustment },
              { key: 'active', header: t('common.status'), cell: (row) => activeBadge(row.active) },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <RuleFormDialog kind="fee" rule={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

export function PricingPage() {
  return (
    <RequirePermission permission="pricing:manage">
      <PageHeader title={t('pricing.title')} intro={t('pricing.intro')} />
      <Markups />
      <Fees />
    </RequirePermission>
  );
}
