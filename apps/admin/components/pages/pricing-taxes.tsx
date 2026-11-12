'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import {
  bpsFromPercent,
  fieldIssues,
  isoFromLocalInput,
  localInputFromIso,
  nullable,
  percentFromBps,
} from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import {
  CheckboxField,
  DataTable,
  FormDialog,
  FormGrid,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  TextField,
} from '../ui';

import { verticalOptions, type Vertical } from './verticals';

type TaxRule = Schemas['AdminTaxRule'];
type Basis = TaxRule['basis'];

interface TaxForm {
  country: string;
  code: string;
  label: string;
  rate: string;
  basis: Basis;
  vertical: Vertical | '';
  registrationNumber: string;
  active: boolean;
  validFrom: string;
  validTo: string;
}

function initialForm(rule: TaxRule | null, sellerCountry: string): TaxForm {
  return {
    country: rule?.country ?? sellerCountry,
    code: rule?.code ?? 'vat',
    label: rule?.label ?? 'VAT',
    rate: rule ? percentFromBps(rule.rateBps) : '',
    basis: rule?.basis ?? 'margin',
    vertical: rule?.vertical ?? '',
    registrationNumber: rule?.registrationNumber ?? '',
    active: rule?.active ?? true,
    validFrom: localInputFromIso(rule?.validFrom ?? null),
    validTo: localInputFromIso(rule?.validTo ?? null),
  };
}

/** Tax on Suskii's own service per country (ADR-072); added to the price customers see. */
function TaxFormDialog({ rule, sellerCountry }: { rule: TaxRule | null; sellerCountry: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TaxForm>(() => initialForm(rule, sellerCountry));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/pricing/taxes'] });
  };
  const create = $api.useMutation('post', '/v1/admin/pricing/taxes', { onSuccess });
  const update = $api.useMutation('patch', '/v1/admin/pricing/taxes/{id}', { onSuccess });
  const mutation = rule ? update : create;
  const errors = { ...fieldIssues(mutation.error), ...localErrors };
  const set = <K extends keyof TaxForm>(key: K, value: TaxForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const rateBps = bpsFromPercent(form.rate);
    if (Number.isNaN(rateBps)) {
      setLocalErrors({ rateBps: t('validation.percent') });
      return;
    }
    setLocalErrors({});
    const body = {
      country: form.country.trim().toUpperCase(),
      code: form.code.trim(),
      label: form.label.trim(),
      rateBps,
      basis: form.basis,
      vertical: form.vertical === '' ? null : form.vertical,
      active: form.active,
      registrationNumber: nullable(form.registrationNumber),
      validFrom: isoFromLocalInput(form.validFrom),
      validTo: isoFromLocalInput(form.validTo),
    };
    if (rule) update.mutate({ params: { path: { id: rule.id } }, body });
    else create.mutate({ body });
  };

  const title = rule ? t('pricing.editTax') : t('pricing.newTax');
  return (
    <FormDialog
      triggerLabel={rule ? t('common.edit') : title}
      triggerVariant={rule ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initialForm(rule, sellerCountry));
          setLocalErrors({});
          mutation.reset();
        }
      }}
      testId={rule ? `edit-tax-${rule.id}` : 'new-tax'}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('pricing.country')}
            hint={t('pricing.countryHint')}
            name="country"
            value={form.country}
            maxLength={2}
            required
            error={errors.country}
            onChange={(event) => set('country', event.target.value)}
          />
          <TextField
            label={t('pricing.code')}
            hint={t('pricing.taxCodeHint')}
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
          <TextField
            label={t('pricing.rate')}
            name="rate"
            inputMode="decimal"
            value={form.rate}
            required
            error={errors.rateBps}
            onChange={(event) => set('rate', event.target.value)}
          />
          <SelectField
            label={t('pricing.taxBasis')}
            name="basis"
            value={form.basis}
            options={(['margin', 'full'] as const).map((value) => ({
              value,
              label: label('pricing.taxBases', value),
            }))}
            onChange={(event) => set('basis', event.target.value as Basis)}
          />
          <SelectField
            label={t('pricing.vertical')}
            name="vertical"
            value={form.vertical}
            options={[{ value: '', label: t('pricing.allVerticals') }, ...verticalOptions]}
            onChange={(event) => set('vertical', event.target.value as Vertical | '')}
          />
          <TextField
            label={t('pricing.registration')}
            hint={t('pricing.registrationHint')}
            name="registrationNumber"
            value={form.registrationNumber}
            error={errors.registrationNumber}
            onChange={(event) => set('registrationNumber', event.target.value)}
          />
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

export function Taxes() {
  const query = $api.useQuery('get', '/v1/admin/pricing/taxes', {});
  const sellerCountry = query.data?.sellerCountry ?? 'NG';
  return (
    <Section
      title={t('pricing.taxes')}
      actions={<TaxFormDialog rule={null} sellerCountry={sellerCountry} />}
    >
      <QueryState query={query}>
        {(data) => (
          <>
            <p className="font-body text-body-sm text-foreground">
              {t('pricing.taxesIntro', { country: format.country(data.sellerCountry) })}
            </p>
            <DataTable
              caption={t('pricing.taxes')}
              rows={data.rules}
              rowKey={(row) => row.id}
              empty={t('pricing.noTaxes')}
              columns={[
                {
                  key: 'label',
                  header: t('pricing.label'),
                  cell: (row) => `${row.label} (${row.code})`,
                },
                {
                  key: 'country',
                  header: t('pricing.country'),
                  cell: (row) => format.country(row.country),
                },
                {
                  key: 'rate',
                  header: t('pricing.rate'),
                  cell: (row) => `${percentFromBps(row.rateBps)}%`,
                },
                {
                  key: 'basis',
                  header: t('pricing.taxBasis'),
                  cell: (row) => label('pricing.taxBases', row.basis),
                },
                {
                  key: 'vertical',
                  header: t('pricing.vertical'),
                  cell: (row) =>
                    row.vertical ? label('verticals', row.vertical) : t('pricing.allVerticals'),
                },
                {
                  key: 'active',
                  header: t('common.status'),
                  cell: (row) =>
                    !row.active ? (
                      <StatusBadge tone="neutral">{t('common.inactive')}</StatusBadge>
                    ) : row.country === data.sellerCountry ? (
                      <StatusBadge tone="success">{t('pricing.taxApplies')}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">{t('pricing.taxPrepared')}</StatusBadge>
                    ),
                },
                {
                  key: 'actions',
                  header: t('common.actions'),
                  cell: (row) => <TaxFormDialog rule={row} sellerCountry={data.sellerCountry} />,
                },
              ]}
            />
          </>
        )}
      </QueryState>
    </Section>
  );
}
