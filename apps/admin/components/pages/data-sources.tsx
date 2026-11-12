'use client';

import {
  AUTOMATED_ACCESS_FINDINGS,
  PRICE_PRODUCTS,
  PROXY_CLASSES,
  SOURCE_POLICY_BASES,
  type AutomatedAccessFinding,
  type PriceProduct,
  type ProxyClass,
  type SourcePolicyBasis,
} from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { csvCell, saveText } from '../../lib/download';
import {
  fieldIssues,
  microFromUsdInput,
  shareOf,
  usdFineFromMicro,
  usdFromMicro,
} from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  CheckboxField,
  ConfirmAction,
  DataTable,
  DetailList,
  FormDialog,
  FormGrid,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../ui';

type Source = Schemas['PriceSource'];
type Overview = Schemas['PriceIntelOverview'];
type Switch = Overview['switches'][number];
type Budget = Schemas['PriceIntelBudget'];
type Observation = Schemas['PriceObservation'];
type ReadResult = Schemas['PriceReadResult'];
type Health = Schemas['PriceIntelHealth'];
type SourceInput = Schemas['PriceSourceInputInput'];
type SourcePatch = Schemas['PriceSourcePatchInput'];

const ROOT = '/v1/admin/data-sources';
const SWITCH_SCOPES = ['global', 'vendor', 'domain'] as const;
const BUDGET_SCOPES = ['vendor', 'domain'] as const;

/** Every list on the page hangs off the same path prefix: one refresh reads them all again. */
const useRefresh = () => {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[1] === 'string' && query.queryKey[1].startsWith(ROOT),
    });
};

const names = (group: string, values: readonly string[]): string =>
  values.length === 0 ? t('common.none') : values.map((value) => label(group, value)).join(', ');

const switchName = (entry: Switch): string =>
  entry.scope === 'global'
    ? label('dataSources.switchScopes', 'global')
    : t('dataSources.switchValue', {
        scope: label('dataSources.switchScopes', entry.scope),
        subject: entry.subject ?? '',
      });

// --- Switches -----------------------------------------------------------------------------------

function StopDialog() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Switch['scope']>('global');
  const [subject, setSubject] = useState('');
  const { toast } = useToast();
  const refresh = useRefresh();
  const stop = $api.useMutation('post', `${ROOT}/switches/stop`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('dataSources.stopped'), variant: 'success' });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    stop.mutate({
      body: { scope, subject: scope === 'global' ? null : subject.trim().toLowerCase() },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('dataSources.stop')}
      triggerVariant="primary"
      title={t('dataSources.stopTitle')}
      description={t('dataSources.switchesIntro')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setScope('global');
          setSubject('');
          stop.reset();
        }
      }}
      testId="stop-reading"
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('dataSources.stopScope')}
          name="scope"
          value={scope}
          options={SWITCH_SCOPES.map((value) => ({
            value,
            label: label('dataSources.switchScopes', value),
          }))}
          onChange={(event) => setScope(event.target.value as Switch['scope'])}
        />
        {scope === 'global' ? null : (
          <TextField
            label={t('dataSources.stopSubject')}
            hint={t('dataSources.stopSubjectHint')}
            name="subject"
            value={subject}
            maxLength={253}
            required
            error={fieldIssues(stop.error).subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        )}
        <ProblemAlert error={stop.error} />
        <Button type="submit" loading={stop.isPending}>
          {t('dataSources.stopSubmit')}
        </Button>
      </form>
    </FormDialog>
  );
}

function ReleaseAction({ entry }: { entry: Switch }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const release = $api.useMutation('post', `${ROOT}/switches/release`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('dataSources.released'), variant: 'success' });
      await refresh();
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('dataSources.release')}
      triggerAriaLabel={t('dataSources.releaseLabel', { what: switchName(entry) })}
      question={t('dataSources.releaseQuestion')}
      onConfirm={() => release.mutate({ body: { scope: entry.scope, subject: entry.subject } })}
      pending={release.isPending}
      error={release.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) release.reset();
      }}
    />
  );
}

// --- Budgets ------------------------------------------------------------------------------------

function BudgetDialog() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Budget['scope']>('vendor');
  const [subject, setSubject] = useState('');
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const save = $api.useMutation('put', `${ROOT}/budgets`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('dataSources.budgetSaved'), variant: 'success' });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const dailyCapMicroUsd = microFromUsdInput(daily);
    const monthlyCapMicroUsd = microFromUsdInput(monthly);
    const bad = (value: number | null): value is null => value === null || Number.isNaN(value);
    if (bad(dailyCapMicroUsd) || bad(monthlyCapMicroUsd)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate({
      body: { scope, subject: subject.trim().toLowerCase(), dailyCapMicroUsd, monthlyCapMicroUsd },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('dataSources.setBudget')}
      title={t('dataSources.setBudgetTitle')}
      description={t('dataSources.setBudgetNote')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setInvalid(false);
          save.reset();
        }
      }}
      testId="set-budget"
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <SelectField
            label={t('dataSources.budgetFor')}
            name="scope"
            value={scope}
            options={BUDGET_SCOPES.map((value) => ({
              value,
              label: label('dataSources.budgetScopes', value),
            }))}
            onChange={(event) => setScope(event.target.value as Budget['scope'])}
          />
          <TextField
            label={t('dataSources.budgetSubject')}
            name="subject"
            value={subject}
            maxLength={253}
            required
            error={fieldIssues(save.error).subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <TextField
            label={t('dataSources.dailyCap')}
            name="daily"
            inputMode="decimal"
            value={daily}
            required
            error={invalid ? t('common.validation') : undefined}
            onChange={(event) => setDaily(event.target.value)}
          />
          <TextField
            label={t('dataSources.monthlyCap')}
            name="monthly"
            inputMode="decimal"
            value={monthly}
            required
            error={invalid ? t('common.validation') : undefined}
            onChange={(event) => setMonthly(event.target.value)}
          />
        </FormGrid>
        <ProblemAlert error={save.error} />
        <Button type="submit" loading={save.isPending}>
          {t('dataSources.budgetSubmit')}
        </Button>
      </form>
    </FormDialog>
  );
}

// --- A site and its form ------------------------------------------------------------------------

interface SiteForm {
  domain: string;
  name: string;
  products: PriceProduct[];
  country: string;
  currency: string;
  locale: string;
  timeZone: string;
  vendors: string;
  urlTemplates: string;
  recipes: string;
  robots: AutomatedAccessFinding;
  terms: AutomatedAccessFinding;
  maxProxyClass: ProxyClass;
  requestsPerMinute: string;
  active: boolean;
}

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

const BLANK: SiteForm = {
  domain: '',
  name: '',
  products: ['hotel'],
  country: 'NG',
  currency: 'NGN',
  locale: 'en-NG',
  timeZone: 'Africa/Lagos',
  vendors: 'direct',
  urlTemplates: pretty({ hotel: 'https://example.com/search?city={place}&in={from}&out={to}' }),
  recipes: pretty({
    hotel: { version: 'v1', methods: [{ method: 'structured_data', types: ['Hotel'] }] },
  }),
  robots: 'unknown',
  terms: 'unknown',
  maxProxyClass: 'none',
  requestsPerMinute: '6',
  active: true,
};

const formOf = (site: Source): SiteForm => ({
  domain: site.domain,
  name: site.name,
  products: [...site.products],
  country: site.country,
  currency: site.currency,
  locale: site.locale,
  timeZone: site.timeZone,
  vendors: site.vendors.join(', '),
  urlTemplates: pretty(site.urlTemplates),
  recipes: pretty(site.recipes),
  robots: site.robots,
  terms: site.terms,
  maxProxyClass: site.maxProxyClass,
  requestsPerMinute: String(site.requestsPerMinute),
  active: site.active,
});

const parsed = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
};

const vendorList = (text: string): SourceInput['vendors'] =>
  text
    .split(',')
    .map((vendor) => vendor.trim().toLowerCase())
    .filter(Boolean) as SourceInput['vendors'];

/**
 * The fields of the form as the API takes them: all of them for a new site, only the changed
 * ones for an edit (a field that was not touched must not travel, or the API would read a
 * default as a change and send an approved site back to review).
 */
function bodyOf(
  form: SiteForm,
  before: SiteForm | null,
): { body: SourcePatch & { domain?: string } } | { invalid: 'urlTemplates' | 'recipes' } {
  const templates = parsed(form.urlTemplates);
  if (!templates.ok) return { invalid: 'urlTemplates' };
  const recipes = parsed(form.recipes);
  if (!recipes.ok) return { invalid: 'recipes' };
  const changed = <K extends keyof SiteForm>(key: K): boolean =>
    before === null || JSON.stringify(before[key]) !== JSON.stringify(form[key]);
  const body: SourcePatch & { domain?: string } = {};
  if (before === null) body.domain = form.domain.trim().toLowerCase();
  if (changed('name')) body.name = form.name.trim();
  if (changed('products')) body.products = form.products;
  if (changed('country')) body.country = form.country.trim().toUpperCase();
  if (changed('currency')) body.currency = form.currency.trim().toUpperCase();
  if (changed('locale')) body.locale = form.locale.trim();
  if (changed('timeZone')) body.timeZone = form.timeZone.trim();
  if (changed('vendors')) body.vendors = vendorList(form.vendors);
  if (changed('urlTemplates')) body.urlTemplates = templates.value as SourceInput['urlTemplates'];
  if (changed('recipes')) body.recipes = recipes.value as SourceInput['recipes'];
  if (changed('robots')) body.robots = form.robots;
  if (changed('terms')) body.terms = form.terms;
  if (changed('maxProxyClass')) body.maxProxyClass = form.maxProxyClass;
  if (changed('requestsPerMinute')) body.requestsPerMinute = Number(form.requestsPerMinute);
  if (changed('active')) body.active = form.active;
  return { body };
}

function SiteDialog({ site }: { site: Source | null }) {
  const initial = (): SiteForm => (site ? formOf(site) : BLANK);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SiteForm>(initial);
  const [invalid, setInvalid] = useState<'urlTemplates' | 'recipes' | null>(null);
  const { toast } = useToast();
  const refresh = useRefresh();
  const done = async () => {
    setOpen(false);
    toast({ title: t('dataSources.siteSaved'), variant: 'success' });
    await refresh();
  };
  const create = $api.useMutation('post', ROOT, { onSuccess: done });
  const update = $api.useMutation('patch', `${ROOT}/{sourceId}`, { onSuccess: done });
  const error = create.error ?? update.error;
  const errors = fieldIssues(error);
  const set = <K extends keyof SiteForm>(key: K, value: SiteForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const built = bodyOf(form, site ? formOf(site) : null);
    if ('invalid' in built) {
      setInvalid(built.invalid);
      return;
    }
    setInvalid(null);
    if (site) {
      update.mutate({ params: { path: { sourceId: site.id } }, body: built.body });
    } else {
      create.mutate({ body: built.body as SourceInput });
    }
  };
  const findings = AUTOMATED_ACCESS_FINDINGS.map((value) => ({
    value,
    label: label('dataSources.findings', value),
  }));
  return (
    <FormDialog
      triggerLabel={site ? t('dataSources.editSite') : t('dataSources.addSite')}
      triggerVariant={site ? 'ghost' : 'primary'}
      triggerAriaLabel={site ? t('dataSources.editSiteLabel', { name: site.name }) : undefined}
      title={
        site ? t('dataSources.editSiteTitle', { name: site.name }) : t('dataSources.addSiteTitle')
      }
      description={site ? t('dataSources.editNote') : t('dataSources.sitesIntro')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initial());
          setInvalid(null);
          create.reset();
          update.reset();
        }
      }}
      testId={site ? `edit-site-${site.domain}` : 'add-site'}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          {site ? null : (
            <TextField
              label={t('dataSources.domain')}
              hint={t('dataSources.domainHint')}
              name="domain"
              value={form.domain}
              maxLength={253}
              required
              error={errors.domain}
              onChange={(event) => set('domain', event.target.value)}
            />
          )}
          <TextField
            label={t('dataSources.name')}
            name="name"
            value={form.name}
            maxLength={120}
            required
            error={errors.name}
            onChange={(event) => set('name', event.target.value)}
          />
          <TextField
            label={t('dataSources.country')}
            name="country"
            value={form.country}
            maxLength={2}
            required
            error={errors.country}
            onChange={(event) => set('country', event.target.value)}
          />
          <TextField
            label={t('dataSources.currency')}
            name="currency"
            value={form.currency}
            maxLength={3}
            required
            error={errors.currency}
            onChange={(event) => set('currency', event.target.value)}
          />
          <TextField
            label={t('dataSources.locale')}
            name="locale"
            value={form.locale}
            maxLength={6}
            required
            error={errors.locale}
            onChange={(event) => set('locale', event.target.value)}
          />
          <TextField
            label={t('dataSources.timeZone')}
            name="timeZone"
            value={form.timeZone}
            maxLength={64}
            required
            error={errors.timeZone}
            onChange={(event) => set('timeZone', event.target.value)}
          />
          <TextField
            label={t('dataSources.vendorsField')}
            hint={t('dataSources.vendorsHint')}
            name="vendors"
            value={form.vendors}
            required
            error={errors.vendors}
            onChange={(event) => set('vendors', event.target.value)}
          />
          <TextField
            label={t('dataSources.requestsPerMinute')}
            name="requestsPerMinute"
            type="number"
            min={1}
            max={600}
            value={form.requestsPerMinute}
            required
            error={errors.requestsPerMinute}
            onChange={(event) => set('requestsPerMinute', event.target.value)}
          />
          <SelectField
            label={t('dataSources.robots')}
            name="robots"
            value={form.robots}
            options={findings}
            onChange={(event) => set('robots', event.target.value as AutomatedAccessFinding)}
          />
          <SelectField
            label={t('dataSources.terms')}
            name="terms"
            value={form.terms}
            options={findings}
            onChange={(event) => set('terms', event.target.value as AutomatedAccessFinding)}
          />
          <SelectField
            label={t('dataSources.maxProxyClass')}
            name="maxProxyClass"
            value={form.maxProxyClass}
            options={PROXY_CLASSES.map((value) => ({
              value,
              label: label('dataSources.proxyNames', value),
            }))}
            onChange={(event) => set('maxProxyClass', event.target.value as ProxyClass)}
          />
        </FormGrid>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-body text-body-sm font-medium text-foreground">
            {t('dataSources.productsField')}
          </legend>
          {PRICE_PRODUCTS.map((product) => (
            <CheckboxField
              key={product}
              label={label('dataSources.productNames', product)}
              name="products"
              value={product}
              checked={form.products.includes(product)}
              onChange={(event) =>
                set(
                  'products',
                  event.target.checked
                    ? PRICE_PRODUCTS.filter((p) => p === product || form.products.includes(p))
                    : form.products.filter((p) => p !== product),
                )
              }
            />
          ))}
          {errors.products ? (
            <span className="font-body text-caption text-danger">{errors.products}</span>
          ) : null}
        </fieldset>
        <TextAreaField
          label={t('dataSources.urlTemplates')}
          hint={t('dataSources.urlTemplatesHint')}
          name="urlTemplates"
          rows={4}
          spellCheck={false}
          value={form.urlTemplates}
          required
          error={invalid === 'urlTemplates' ? t('dataSources.invalidJson') : errors.urlTemplates}
          onChange={(event) => set('urlTemplates', event.target.value)}
        />
        <TextAreaField
          label={t('dataSources.recipes')}
          hint={t('dataSources.recipesHint')}
          name="recipes"
          rows={8}
          spellCheck={false}
          value={form.recipes}
          required
          error={invalid === 'recipes' ? t('dataSources.invalidJson') : errors.recipes}
          onChange={(event) => set('recipes', event.target.value)}
        />
        <CheckboxField
          label={t('common.active')}
          name="active"
          checked={form.active}
          onChange={(event) => set('active', event.target.checked)}
        />
        <ProblemAlert error={error} />
        <Button type="submit" loading={create.isPending || update.isPending}>
          {t('dataSources.saveSite')}
        </Button>
      </form>
    </FormDialog>
  );
}

/** Approval states on what basis the site may be read, and where that is written (ADR-102). */
function ApproveDialog({ site }: { site: Source }) {
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState<SourcePolicyBasis>(site.basis ?? 'permission');
  const [reference, setReference] = useState(site.basisReference ?? '');
  const { toast } = useToast();
  const refresh = useRefresh();
  const approve = $api.useMutation('post', `${ROOT}/{sourceId}/approve`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('dataSources.approved'), variant: 'success' });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    approve.mutate({
      params: { path: { sourceId: site.id } },
      body: { basis, basisReference: reference.trim() },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('dataSources.approve')}
      triggerVariant="primary"
      triggerAriaLabel={t('dataSources.approveLabel', { name: site.name })}
      title={t('dataSources.approveTitle', { name: site.name })}
      description={t('dataSources.approveNote')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) approve.reset();
      }}
      testId={`approve-site-${site.domain}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('dataSources.basis')}
          name="basis"
          value={basis}
          options={SOURCE_POLICY_BASES.map((value) => ({
            value,
            label: label('dataSources.bases', value),
          }))}
          onChange={(event) => setBasis(event.target.value as SourcePolicyBasis)}
        />
        <TextField
          label={t('dataSources.basisReference')}
          name="basisReference"
          value={reference}
          maxLength={200}
          required
          error={fieldIssues(approve.error).basisReference}
          onChange={(event) => setReference(event.target.value)}
        />
        <ProblemAlert error={approve.error} />
        <Button type="submit" loading={approve.isPending}>
          {t('dataSources.approveSubmit')}
        </Button>
      </form>
    </FormDialog>
  );
}

function DecideAction({ site, decision }: { site: Source; decision: 'block' | 'review' }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const onSuccess = async () => {
    setOpen(false);
    toast({
      title: decision === 'block' ? t('dataSources.blocked') : t('dataSources.reviewed'),
      variant: 'success',
    });
    await refresh();
  };
  const block = $api.useMutation('post', `${ROOT}/{sourceId}/block`, { onSuccess });
  const review = $api.useMutation('post', `${ROOT}/{sourceId}/review`, { onSuccess });
  const mutation = decision === 'block' ? block : review;
  return (
    <ConfirmAction
      triggerLabel={decision === 'block' ? t('dataSources.block') : t('dataSources.review')}
      triggerAriaLabel={
        decision === 'block'
          ? t('dataSources.blockLabel', { name: site.name })
          : t('dataSources.reviewLabel', { name: site.name })
      }
      question={
        decision === 'block' ? t('dataSources.blockQuestion') : t('dataSources.reviewQuestion')
      }
      onConfirm={() => mutation.mutate({ params: { path: { sourceId: site.id } } })}
      pending={mutation.isPending}
      error={mutation.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) mutation.reset();
      }}
    />
  );
}

const observationColumns = [
  {
    key: 'what',
    header: t('dataSources.what'),
    cell: (row: Observation) =>
      typeof row.item.title === 'string'
        ? row.item.title
        : label('dataSources.productNames', row.product),
  },
  {
    key: 'price',
    header: t('dataSources.price'),
    cell: (row: Observation) => format.money(row.price),
  },
  {
    key: 'seen',
    header: t('dataSources.seen'),
    cell: (row: Observation) => (
      <span className="flex flex-col gap-1">
        <span>{format.dateTime(row.observedAt)}</span>
        {row.stale ? <span className="text-muted">{t('dataSources.stale')}</span> : null}
      </span>
    ),
  },
  {
    key: 'status',
    header: t('common.status'),
    cell: (row: Observation) => label('dataSources.observationStatuses', row.status),
  },
  {
    key: 'confidence',
    header: t('dataSources.confidence'),
    cell: (row: Observation) => format.number(row.confidence),
  },
];

/** One read through the site's policy, as a search would make it. */
function ReadDialog({ site }: { site: Source }) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<PriceProduct>(site.products[0] ?? 'hotel');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [place, setPlace] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<ReadResult | null>(null);
  const refresh = useRefresh();
  const read = $api.useMutation('post', `${ROOT}/{sourceId}/read`, {
    onSuccess: async (data) => {
      setResult(data);
      await refresh();
    },
  });
  const flight = product === 'flight';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    read.mutate({
      params: { path: { sourceId: site.id } },
      body: {
        product,
        query: {
          from,
          ...(to ? { to } : {}),
          ...(flight
            ? { origin: origin.trim().toUpperCase(), destination: destination.trim().toUpperCase() }
            : { place: place.trim() }),
        },
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('dataSources.read')}
      triggerAriaLabel={t('dataSources.readLabel', { name: site.name })}
      title={t('dataSources.readTitle', { name: site.name })}
      description={t('dataSources.readNote')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setResult(null);
          read.reset();
        }
      }}
      testId={`read-site-${site.domain}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <SelectField
            label={t('dataSources.readProduct')}
            name="product"
            value={product}
            options={site.products.map((value) => ({
              value,
              label: label('dataSources.productNames', value),
            }))}
            onChange={(event) => setProduct(event.target.value as PriceProduct)}
          />
          {flight ? (
            <>
              <TextField
                label={t('dataSources.readOrigin')}
                name="origin"
                value={origin}
                maxLength={3}
                required
                onChange={(event) => setOrigin(event.target.value)}
              />
              <TextField
                label={t('dataSources.readDestination')}
                name="destination"
                value={destination}
                maxLength={3}
                required
                onChange={(event) => setDestination(event.target.value)}
              />
            </>
          ) : (
            <TextField
              label={t('dataSources.readPlace')}
              name="place"
              value={place}
              maxLength={60}
              required
              onChange={(event) => setPlace(event.target.value)}
            />
          )}
          <TextField
            label={t('dataSources.readFrom')}
            name="from"
            type="date"
            value={from}
            required
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            label={t('dataSources.readTo')}
            name="to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </FormGrid>
        <ProblemAlert error={read.error} />
        <Button type="submit" loading={read.isPending}>
          {t('dataSources.readSubmit')}
        </Button>
      </form>
      {result ? (
        <div className="flex flex-col gap-3" data-testid="read-result">
          <p role="status" className="font-body text-body-sm text-foreground">
            {label('dataSources.readStates', result.state)}
            {result.failure ? `: ${label('dataSources.readFailures', result.failure)}` : ''}
          </p>
          <DataTable
            caption={t('dataSources.observationsCaption')}
            rows={result.observations}
            rowKey={(row) => row.id}
            columns={observationColumns}
            empty={t('dataSources.noObservations')}
          />
        </div>
      ) : null}
    </FormDialog>
  );
}

function ObservationsDialog({ site }: { site: Source }) {
  const [open, setOpen] = useState(false);
  const query = $api.useQuery(
    'get',
    `${ROOT}/{sourceId}/observations`,
    { params: { path: { sourceId: site.id }, query: { limit: 30 } } },
    { enabled: open },
  );
  return (
    <FormDialog
      triggerLabel={t('dataSources.observations')}
      triggerAriaLabel={t('dataSources.observationsLabel', { name: site.name })}
      title={t('dataSources.observationsTitle', { name: site.name })}
      open={open}
      onOpenChange={setOpen}
    >
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('dataSources.observationsCaption')}
            rows={data.items}
            rowKey={(row) => row.id}
            columns={observationColumns}
            empty={t('dataSources.noObservations')}
          />
        )}
      </QueryState>
    </FormDialog>
  );
}

const statusTone = (status: Source['status']) =>
  status === 'approved' ? 'success' : status === 'blocked' ? 'danger' : 'warning';

function SiteCard({ site, manage }: { site: Source; manage: boolean }) {
  const actions: ReactNode[] = [<ObservationsDialog key="observations" site={site} />];
  if (manage) {
    // A blocked site goes back to review before it can be approved again (the API refuses it).
    if (site.status === 'review') actions.push(<ApproveDialog key="approve" site={site} />);
    actions.push(<ReadDialog key="read" site={site} />);
    actions.push(<SiteDialog key="edit" site={site} />);
    if (site.status !== 'review') {
      actions.push(<DecideAction key="review" site={site} decision="review" />);
    }
    if (site.status !== 'blocked') {
      actions.push(<DecideAction key="block" site={site} decision="block" />);
    }
  }
  const none = t('common.none');
  return (
    <Section title={site.name} intro={site.domain} actions={actions}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={statusTone(site.status)}>
          {label('dataSources.statuses', site.status)}
        </StatusBadge>
        <StatusBadge tone={site.readable === 'yes' ? 'info' : 'neutral'}>
          {label('dataSources.readable', site.readable)}
        </StatusBadge>
      </div>
      {site.drift ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {t('dataSources.drift', { time: format.dateTime(site.drift.since) })}
        </p>
      ) : null}
      <DetailList
        items={[
          {
            term: t('dataSources.products'),
            value: names('dataSources.productNames', site.products),
          },
          { term: t('dataSources.vendors'), value: names('dataSources.vendorNames', site.vendors) },
          { term: t('dataSources.robots'), value: label('dataSources.findings', site.robots) },
          { term: t('dataSources.terms'), value: label('dataSources.findings', site.terms) },
          {
            term: t('dataSources.basis'),
            value: site.basis ? label('dataSources.bases', site.basis) : none,
          },
          { term: t('dataSources.basisReference'), value: site.basisReference ?? none },
          {
            term: t('dataSources.maxProxyClass'),
            value: label('dataSources.proxyNames', site.maxProxyClass),
          },
          { term: t('dataSources.rate'), value: format.number(site.requestsPerMinute) },
          {
            term: t('dataSources.decidedAt'),
            value: site.decidedAt ? format.dateTime(site.decidedAt) : none,
          },
        ]}
      />
    </Section>
  );
}

// --- Sections -----------------------------------------------------------------------------------

function OverviewSection({ overview, manage }: { overview: Overview; manage: boolean }) {
  return (
    <>
      <Section title={t('dataSources.overview')}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={overview.enabled ? 'success' : 'neutral'}>
            {overview.enabled ? t('dataSources.on') : t('dataSources.off')}
          </StatusBadge>
        </div>
        {overview.enabled ? null : (
          <p className="font-body text-body-sm text-muted">{t('dataSources.offNote')}</p>
        )}
        <DetailList
          items={[
            {
              term: t('dataSources.sitesInReview'),
              value: format.number(overview.sources.review),
            },
            {
              term: t('dataSources.sitesApproved'),
              value: format.number(overview.sources.approved),
            },
            {
              term: t('dataSources.sitesBlocked'),
              value: format.number(overview.sources.blocked),
            },
          ]}
        />
        <DataTable
          caption={t('dataSources.vendorsCaption')}
          rows={overview.vendors}
          rowKey={(row) => row.vendor}
          columns={[
            {
              key: 'vendor',
              header: t('dataSources.vendor'),
              cell: (row) => label('dataSources.vendorNames', row.vendor),
            },
            {
              key: 'key',
              header: t('dataSources.key'),
              cell: (row) =>
                row.ok === null
                  ? t('dataSources.keyUnknown')
                  : row.ok
                    ? t('dataSources.keyWorks')
                    : t('dataSources.keyFails'),
            },
            {
              key: 'classes',
              header: t('dataSources.proxyClasses'),
              cell: (row) => names('dataSources.proxyNames', row.proxyClasses),
            },
            {
              key: 'render',
              header: t('dataSources.renders'),
              cell: (row) => (row.render ? t('common.yes') : t('common.no')),
            },
          ]}
        />
      </Section>
      <Section
        title={t('dataSources.switches')}
        intro={t('dataSources.switchesIntro')}
        actions={manage ? <StopDialog /> : undefined}
      >
        {overview.switches.length === 0 ? (
          <p className="font-body text-body-sm text-muted">{t('dataSources.noSwitches')}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="switches">
            {overview.switches.map((entry) => (
              <li
                key={`${entry.scope}-${entry.subject ?? ''}`}
                className="flex flex-wrap items-center gap-3 font-body text-body-sm text-foreground"
              >
                <span>{switchName(entry)}</span>
                {manage ? <ReleaseAction entry={entry} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        title={t('dataSources.budgets')}
        intro={t('dataSources.budgetsIntro')}
        actions={manage ? <BudgetDialog /> : undefined}
      >
        <DataTable
          caption={t('dataSources.budgetsCaption')}
          rows={overview.budgets}
          rowKey={(row) => `${row.scope}-${row.subject}`}
          columns={[
            {
              key: 'for',
              header: t('dataSources.budgetFor'),
              cell: (row) =>
                `${label('dataSources.budgetScopes', row.scope)}: ${
                  row.scope === 'vendor'
                    ? label('dataSources.vendorNames', row.subject)
                    : row.subject
                }`,
            },
            {
              key: 'today',
              header: t('dataSources.today'),
              cell: (row) =>
                t('dataSources.spendOf', {
                  spent: usdFromMicro(row.spentTodayMicroUsd),
                  cap: usdFromMicro(row.dailyCapMicroUsd),
                }),
            },
            {
              key: 'month',
              header: t('dataSources.month'),
              cell: (row) =>
                t('dataSources.spendOf', {
                  spent: usdFromMicro(row.spentThisMonthMicroUsd),
                  cap: usdFromMicro(row.monthlyCapMicroUsd),
                }),
            },
            {
              key: 'set',
              header: t('common.status'),
              cell: (row) =>
                row.set ? t('dataSources.budgetSet') : t('dataSources.budgetDefault'),
            },
          ]}
        />
      </Section>
    </>
  );
}

function JobsSection() {
  const query = $api.useQuery('get', `${ROOT}/jobs`, { params: { query: { limit: 20 } } });
  return (
    <Section title={t('dataSources.jobs')}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('dataSources.jobsCaption')}
            rows={data.items}
            rowKey={(row) => row.id}
            empty={t('dataSources.noJobs')}
            columns={[
              { key: 'site', header: t('dataSources.site'), cell: (row) => row.domain },
              {
                key: 'product',
                header: t('dataSources.product'),
                cell: (row) => label('dataSources.productNames', row.product),
              },
              {
                key: 'outcome',
                header: t('dataSources.outcome'),
                cell: (row) =>
                  `${label('dataSources.jobStatuses', row.status)}${
                    row.failureClass
                      ? `: ${label('dataSources.readFailures', row.failureClass)}`
                      : ''
                  }`,
              },
              {
                key: 'tries',
                header: t('dataSources.tries'),
                cell: (row) => format.number(row.attempts.length),
              },
              {
                key: 'found',
                header: t('dataSources.found'),
                cell: (row) => format.number(row.observationCount),
              },
              {
                key: 'cost',
                header: t('dataSources.cost'),
                cell: (row) => usdFromMicro(row.costMicroUsd),
              },
              {
                key: 'started',
                header: t('dataSources.started'),
                cell: (row) => format.dateTime(row.startedAt),
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function RegisterSection() {
  const query = $api.useQuery('get', `${ROOT}/register`);
  const download = (rows: Schemas['ScrapingRegister']['rows']) => {
    const header = [
      'domain',
      'name',
      'status',
      'basis',
      'basis_reference',
      'robots',
      'terms',
      'products',
      'vendors',
      'max_access_class',
      'reads_per_minute',
      'decided_at',
    ];
    const lines = rows.map((row) =>
      [
        row.domain,
        row.name,
        row.status,
        row.basis ?? '',
        row.basisReference ?? '',
        row.robots,
        row.terms,
        row.products.join(' '),
        row.vendors.join(' '),
        row.maxProxyClass,
        String(row.requestsPerMinute),
        row.decidedAt ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
    saveText('scraping-register.csv', [header.join(','), ...lines].join('\n'));
  };
  return (
    <Section title={t('dataSources.register')} intro={t('dataSources.registerIntro')}>
      <QueryState query={query}>
        {(data) => (
          <>
            <div>
              <Button variant="ghost" onClick={() => download(data.rows)}>
                {t('dataSources.downloadRegister')}
              </Button>
            </div>
            <DataTable
              caption={t('dataSources.registerCaption')}
              rows={data.rows}
              rowKey={(row) => row.domain}
              empty={t('dataSources.noSites')}
              columns={[
                { key: 'domain', header: t('dataSources.domain'), cell: (row) => row.domain },
                {
                  key: 'status',
                  header: t('common.status'),
                  cell: (row) => label('dataSources.statuses', row.status),
                },
                {
                  key: 'basis',
                  header: t('dataSources.basis'),
                  cell: (row) =>
                    row.basis ? label('dataSources.bases', row.basis) : t('common.none'),
                },
                {
                  key: 'reference',
                  header: t('dataSources.basisReference'),
                  cell: (row) => row.basisReference ?? t('common.none'),
                },
                {
                  key: 'robots',
                  header: t('dataSources.robots'),
                  cell: (row) => label('dataSources.findings', row.robots),
                },
                {
                  key: 'terms',
                  header: t('dataSources.terms'),
                  cell: (row) => label('dataSources.findings', row.terms),
                },
                {
                  key: 'decided',
                  header: t('dataSources.decidedAt'),
                  cell: (row) =>
                    row.decidedAt ? format.dateTime(row.decidedAt) : t('common.none'),
                },
              ]}
            />
          </>
        )}
      </QueryState>
    </Section>
  );
}

/**
 * Data sources (ADR-102): the sites whose public prices may be read, each with its policy, the
 * vendors that read them, the switches and the budgets. Reading needs `ai:read`; every change
 * needs `datasources:manage`, and approving a site, switching reading back on and setting a
 * budget also an authenticator code.
 */
const HEALTH_WINDOWS = [24, 72, 168] as const;
type HealthWindow = (typeof HEALTH_WINDOWS)[number];

/** What a row of reading holds, for a vendor or for a site. */
interface Reads {
  attempts: number;
  ok: number;
  blocked: number;
  medianMs: number | null;
  costMicroUsd: number;
}

const rate = (count: number, total: number) =>
  t('dataSources.shareOfTries', { count: format.number(count), percent: shareOf(count, total) });

const readColumns = <Row extends Reads>() =>
  [
    {
      key: 'attempts',
      header: t('dataSources.attempts'),
      cell: (row: Row) => format.number(row.attempts),
    },
    {
      key: 'usable',
      header: t('dataSources.usable'),
      cell: (row: Row) => rate(row.ok, row.attempts),
    },
    {
      key: 'refused',
      header: t('dataSources.refused'),
      cell: (row: Row) => rate(row.blocked, row.attempts),
    },
    {
      key: 'median',
      header: t('dataSources.medianTime'),
      cell: (row: Row) =>
        row.medianMs === null
          ? t('common.none')
          : t('dataSources.milliseconds', { ms: format.number(row.medianMs) }),
    },
    {
      key: 'spent',
      header: t('dataSources.spent'),
      cell: (row: Row) => usdFineFromMicro(row.costMicroUsd),
    },
  ] as const;

const perUnit = (micro: number | null) =>
  micro === null ? t('common.none') : usdFineFromMicro(micro);

function HealthTables({ health }: { health: Health }) {
  return (
    <div className="flex flex-col gap-4" data-testid="source-health">
      <DataTable
        caption={t('dataSources.healthVendorsCaption')}
        rows={health.vendors}
        rowKey={(row) => row.vendor}
        columns={[
          {
            key: 'vendor',
            header: t('dataSources.vendor'),
            cell: (row) => label('dataSources.vendorNames', row.vendor),
          },
          ...readColumns<Health['vendors'][number]>(),
          {
            key: 'perUsable',
            header: t('dataSources.costPerUsable'),
            cell: (row) => perUnit(row.costPerSuccessMicroUsd),
          },
          {
            key: 'breaker',
            header: t('dataSources.breaker'),
            cell: (row) => (
              <StatusBadge tone={row.breakerOpen ? 'warning' : 'success'}>
                {row.breakerOpen ? t('dataSources.breakerOpen') : t('dataSources.breakerClosed')}
              </StatusBadge>
            ),
          },
        ]}
      />
      <DataTable
        caption={t('dataSources.healthSitesCaption')}
        rows={health.sites}
        rowKey={(row) => row.domain}
        empty={t('dataSources.noAttempts')}
        columns={[
          {
            key: 'site',
            header: t('dataSources.site'),
            cell: (row) => <code className="break-all">{row.domain}</code>,
          },
          ...readColumns<Health['sites'][number]>(),
          {
            key: 'kept',
            header: t('dataSources.pricesKept'),
            cell: (row) => format.number(row.observations),
          },
          {
            key: 'perPrice',
            header: t('dataSources.costPerPrice'),
            cell: (row) => perUnit(row.costPerObservationMicroUsd),
          },
        ]}
      />
      {health.drift.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1">
          <p className="font-body text-body-sm font-bold text-danger">
            {t('dataSources.driftOpen')}
          </p>
          <ul className="flex flex-col gap-1">
            {health.drift.map((incident) => (
              <li key={incident.domain} className="font-body text-body-sm text-foreground">
                {t('dataSources.driftRow', {
                  domain: incident.domain,
                  time: format.dateTime(incident.since),
                  version: incident.parserVersion,
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** How reading has gone in a period: per vendor and per site, with breakers and drift. */
function HealthSection() {
  const [hours, setHours] = useState<HealthWindow>(24);
  const query = $api.useQuery('get', `${ROOT}/health`, { params: { query: { hours } } });
  return (
    <Section title={t('dataSources.health')} intro={t('dataSources.healthIntro')}>
      <SelectField
        className="max-w-popover"
        label={t('dataSources.healthWindow')}
        name="hours"
        value={String(hours)}
        options={HEALTH_WINDOWS.map((value) => ({
          value: String(value),
          label: label('dataSources.healthWindows', `h${String(value)}`),
        }))}
        onChange={(event) => setHours(Number(event.target.value) as HealthWindow)}
      />
      <QueryState query={query}>{(health) => <HealthTables health={health} />}</QueryState>
    </Section>
  );
}

export function DataSourcesPage() {
  const { can } = useStaffSession();
  const manage = can('datasources:manage');
  const overview = $api.useQuery('get', `${ROOT}/overview`);
  const sites = $api.useQuery('get', ROOT);
  return (
    <RequirePermission permission="ai:read">
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('dataSources.title')}
          intro={t('dataSources.intro')}
          actions={manage ? <SiteDialog site={null} /> : undefined}
        />
        <QueryState query={overview}>
          {(data) => <OverviewSection overview={data} manage={manage} />}
        </QueryState>
        <HealthSection />
        <h2 className="font-heading text-h3 font-bold text-heading">{t('dataSources.sites')}</h2>
        <p className="font-body text-body-sm text-muted">{t('dataSources.sitesIntro')}</p>
        <QueryState query={sites}>
          {(data) =>
            data.items.length === 0 ? (
              <p className="font-body text-body-sm text-muted">{t('dataSources.noSites')}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {data.items.map((site) => (
                  <SiteCard key={site.id} site={site} manage={manage} />
                ))}
              </div>
            )
          }
        </QueryState>
        <JobsSection />
        <RegisterSection />
      </div>
    </RequirePermission>
  );
}
