'use client';

import { DEPARTURE_STATUSES, SUPPORTED_CURRENCIES } from '@suskii/shared';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, problemMessage, type Schemas } from '../../lib/api';
import { fieldIssues, inputFromMinor, minorFromInput, parseJsonObject } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { CityPicker, type PickedCity } from '../city-picker';
import { RequirePermission } from '../console-shell';
import {
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

type Kind = 'package' | 'tour' | 'addon' | 'visa';
type Product = Schemas['AdminProduct'];
type Departure = Schemas['AdminDeparture'];
type Status = Product['status'];

const KINDS: readonly Kind[] = ['package', 'tour', 'addon', 'visa'];
const POLICY = [
  { daysBefore: 7, refundBps: 10_000 },
  { daysBefore: 0, refundBps: 0 },
];

/** A starting point for each kind's details (everything but the slug and city). */
function template(kind: Kind, city: PickedCity | null): Record<string, unknown> {
  switch (kind) {
    case 'package':
      return {
        title: '',
        summary: '',
        nights: 3,
        passportRequired: true,
        featured: false,
        highlights: [],
        inclusions: [],
        exclusions: [],
        cancellationPolicy: POLICY,
      };
    case 'tour':
      return {
        title: '',
        summary: '',
        timeZone: city?.timeZone ?? 'Africa/Lagos',
        durationMinutes: 180,
        category: null,
        featured: false,
        meetingPoint: { name: '', address: '', notes: null },
        highlights: [],
        inclusions: [],
        exclusions: [],
        cancellationPolicy: POLICY,
      };
    case 'addon':
      return {
        type: 'airport_transfer',
        title: '',
        summary: '',
        description: '',
        countryCodes: ['NG'],
        pricingBasis: 'per_booking',
        price: { amountMinor: 2_500_000, currency: 'NGN' },
        maxTravellers: 4,
        requiredDetails: [],
        cancellationPolicy: POLICY,
      };
    case 'visa':
      return {
        title: '',
        summary: '',
        destination: 'GB',
        purposes: ['tourism'],
        processingDaysMin: 5,
        processingDaysMax: 15,
        price: { amountMinor: 8_000_000, currency: 'NGN' },
        checklist: [
          { key: 'passport', label: 'Passport', description: 'Bio page', required: true },
        ],
        governmentFeeNote: null,
      };
  }
}

const statusTone = (status: Status) =>
  status === 'published' ? 'success' : status === 'archived' ? 'neutral' : 'warning';

function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/catalog'] });
}

/** PATCH a product of any kind (bodies are checked by the kind's update route). */
async function updateProduct(kind: Kind, id: string, body: Record<string, unknown>) {
  const path = { params: { path: { id } } };
  switch (kind) {
    case 'package':
      return adminApi.PATCH('/v1/admin/packages/{id}', { ...path, body });
    case 'tour':
      return adminApi.PATCH('/v1/admin/tours/{id}', { ...path, body });
    case 'addon':
      return adminApi.PATCH('/v1/admin/addons/{id}', { ...path, body });
    case 'visa':
      return adminApi.PATCH('/v1/admin/visa-products/{id}', { ...path, body });
  }
}

async function createProduct(kind: Kind, body: Record<string, unknown>) {
  switch (kind) {
    case 'package':
      return adminApi.POST('/v1/admin/packages', { body: body as Schemas['CreatePackageInput'] });
    case 'tour':
      return adminApi.POST('/v1/admin/tours', { body: body as Schemas['CreateTourInput'] });
    case 'addon':
      return adminApi.POST('/v1/admin/addons', { body: body as Schemas['CreateAddonInput'] });
    case 'visa':
      return adminApi.POST('/v1/admin/visa-products', {
        body: body as Schemas['CreateVisaProductInput'],
      });
  }
}

function ProductDialog({ kind, product }: { kind: Kind; product: Product | null }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [city, setCity] = useState<PickedCity | null>(null);
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | undefined>();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateCatalog();
  const needsCity = !product && (kind === 'package' || kind === 'tour');

  const reset = () => {
    setSlug('');
    setCity(null);
    setJson(JSON.stringify(product ? product.editable : template(kind, null), null, 2));
    setJsonError(undefined);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const details = parseJsonObject(json);
    if (!details) {
      setJsonError(t('validation.json'));
      return;
    }
    setJsonError(undefined);
    setBusy(true);
    const result = product
      ? await updateProduct(kind, product.id, details)
      : await createProduct(kind, {
          ...details,
          slug: slug.trim(),
          ...(city ? { cityId: city.id } : {}),
        });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await invalidate();
  };

  const title = product
    ? t('catalog.editProduct', { title: product.title })
    : label('catalog.newProduct', kind);
  const issues = fieldIssues(error);
  return (
    <FormDialog
      triggerLabel={product ? t('catalog.editDetails') : title}
      triggerVariant={product ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
      testId={product ? `edit-product-${product.slug}` : `new-${kind}`}
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {product ? null : (
          <TextField
            label={t('catalog.slug')}
            hint={t('deals.slugHint')}
            name="slug"
            value={slug}
            required
            error={issues.slug}
            onChange={(event) => setSlug(event.target.value)}
            data-testid="product-slug"
          />
        )}
        {needsCity ? (
          <CityPicker
            value={city}
            error={issues.cityId}
            onChange={(picked) => {
              setCity(picked);
              if (picked && kind === 'tour') {
                const details = parseJsonObject(json);
                if (details)
                  setJson(
                    JSON.stringify(
                      { ...details, timeZone: picked.timeZone ?? details.timeZone },
                      null,
                      2,
                    ),
                  );
              }
            }}
          />
        ) : null}
        <TextAreaField
          label={t('catalog.details')}
          hint={t('catalog.detailsHint')}
          name="details"
          rows={16}
          spellCheck={false}
          value={json}
          error={jsonError}
          onChange={(event) => setJson(event.target.value)}
          data-testid="product-json"
        />
        <ProblemAlert error={error} />
        <Button type="submit" loading={busy} disabled={needsCity && !city}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function StatusActions({ kind, product }: { kind: Kind; product: Product }) {
  const { toast } = useToast();
  const invalidate = useInvalidateCatalog();
  const [busy, setBusy] = useState<Status | null>(null);
  const change = async (status: Status) => {
    setBusy(status);
    const result = await updateProduct(kind, product.id, { status });
    setBusy(null);
    if (result.error) toast({ title: problemMessage(result.error), variant: 'error' });
    else {
      toast({ title: t('catalog.statusChanged'), variant: 'success' });
      await invalidate();
    }
  };
  const actions: { status: Status; text: string }[] = [
    ...(product.status !== 'published'
      ? [{ status: 'published' as const, text: t('catalog.publish') }]
      : []),
    ...(product.status === 'published'
      ? [{ status: 'draft' as const, text: t('catalog.toDraft') }]
      : []),
    ...(product.status !== 'archived'
      ? [{ status: 'archived' as const, text: t('catalog.archive') }]
      : []),
  ];
  return (
    <>
      {actions.map((action) => (
        <Button
          key={action.status}
          variant="ghost"
          loading={busy === action.status}
          onClick={() => void change(action.status)}
        >
          {action.text}
        </Button>
      ))}
    </>
  );
}

interface PriceDraft {
  adult: string;
  child: string;
  infant: string;
  currency: string;
}

const priceDraft = (prices: Departure['prices'] | null): PriceDraft => {
  const currency = prices?.adult.currency ?? 'NGN';
  return {
    adult: prices ? inputFromMinor(prices.adult.amountMinor, currency) : '',
    child: prices?.child ? inputFromMinor(prices.child.amountMinor, currency) : '',
    infant: prices?.infant ? inputFromMinor(prices.infant.amountMinor, currency) : '',
    currency,
  };
};

/** Per-person prices in minor units, or the name of the field that is wrong. */
function pricesFromDraft(draft: PriceDraft): Departure['prices'] | string {
  const adult = minorFromInput(draft.adult, draft.currency);
  const child = minorFromInput(draft.child, draft.currency);
  const infant = minorFromInput(draft.infant, draft.currency);
  if (adult === null || Number.isNaN(adult)) return 'adult';
  if (Number.isNaN(child)) return 'child';
  if (Number.isNaN(infant)) return 'infant';
  const money = (amountMinor: number | null) =>
    amountMinor === null ? null : { amountMinor, currency: draft.currency };
  return {
    adult: { amountMinor: adult, currency: draft.currency },
    child: money(child),
    infant: money(infant),
  };
}

function PriceFields({
  draft,
  onChange,
  errorField,
}: {
  draft: PriceDraft;
  onChange: (draft: PriceDraft) => void;
  errorField?: string;
}) {
  return (
    <>
      <SelectField
        label={t('common.currency')}
        name="priceCurrency"
        value={draft.currency}
        options={SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: code }))}
        onChange={(event) => onChange({ ...draft, currency: event.target.value })}
      />
      <TextField
        label={t('catalog.adultPrice')}
        name="adult"
        inputMode="decimal"
        value={draft.adult}
        required
        error={errorField === 'adult' ? t('validation.amount') : undefined}
        onChange={(event) => onChange({ ...draft, adult: event.target.value })}
        data-testid="adult-price"
      />
      <TextField
        label={t('catalog.childPrice')}
        name="child"
        inputMode="decimal"
        value={draft.child}
        error={errorField === 'child' ? t('validation.amount') : undefined}
        onChange={(event) => onChange({ ...draft, child: event.target.value })}
      />
      <TextField
        label={t('catalog.infantPrice')}
        name="infant"
        inputMode="decimal"
        value={draft.infant}
        error={errorField === 'infant' ? t('validation.amount') : undefined}
        onChange={(event) => onChange({ ...draft, infant: event.target.value })}
      />
    </>
  );
}

function NewDepartureForm({ kind, product }: { kind: 'package' | 'tour'; product: Product }) {
  const [form, setForm] = useState({ start: '', end: '', capacity: '10' });
  const [prices, setPrices] = useState<PriceDraft>(priceDraft(null));
  const [priceError, setPriceError] = useState<string | undefined>();
  const { toast } = useToast();
  const invalidate = useInvalidateCatalog();
  const onSuccess = async () => {
    toast({ title: t('common.saved'), variant: 'success' });
    setForm({ start: '', end: '', capacity: form.capacity });
    await invalidate();
  };
  const createPackage = $api.useMutation('post', '/v1/admin/packages/{id}/departures', {
    onSuccess,
  });
  const createTour = $api.useMutation('post', '/v1/admin/tours/{id}/departures', { onSuccess });
  const mutation = kind === 'package' ? createPackage : createTour;
  const issues = fieldIssues(mutation.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = pricesFromDraft(prices);
    if (typeof parsed === 'string') {
      setPriceError(parsed);
      return;
    }
    setPriceError(undefined);
    const path = { id: product.id };
    if (kind === 'package') {
      createPackage.mutate({
        params: { path },
        body: {
          startDate: form.start,
          endDate: form.end,
          capacity: Number(form.capacity),
          prices: parsed,
        },
      });
    } else {
      createTour.mutate({
        params: { path },
        body: { startsAtLocal: form.start, capacity: Number(form.capacity), prices: parsed },
      });
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label={t('catalog.newDeparture')}>
      <h3 className="font-heading text-body font-bold text-heading">{t('catalog.newDeparture')}</h3>
      <FormGrid>
        {kind === 'package' ? (
          <>
            <TextField
              label={t('catalog.startDate')}
              name="startDate"
              type="date"
              value={form.start}
              required
              error={issues.startDate}
              onChange={(event) => setForm({ ...form, start: event.target.value })}
            />
            <TextField
              label={t('catalog.endDate')}
              name="endDate"
              type="date"
              value={form.end}
              required
              error={issues.endDate}
              onChange={(event) => setForm({ ...form, end: event.target.value })}
            />
          </>
        ) : (
          <TextField
            label={t('catalog.startsAt')}
            name="startsAtLocal"
            type="datetime-local"
            value={form.start}
            required
            error={issues.startsAtLocal}
            onChange={(event) => setForm({ ...form, start: event.target.value })}
          />
        )}
        <TextField
          label={t('catalog.capacity')}
          name="capacity"
          type="number"
          min={1}
          max={1000}
          value={form.capacity}
          required
          onChange={(event) => setForm({ ...form, capacity: event.target.value })}
        />
        <PriceFields draft={prices} onChange={setPrices} errorField={priceError} />
      </FormGrid>
      <ProblemAlert error={mutation.error} />
      <div>
        <Button type="submit" loading={mutation.isPending}>
          {t('catalog.newDeparture')}
        </Button>
      </div>
    </form>
  );
}

function DepartureEditor({ kind, departure }: { kind: 'package' | 'tour'; departure: Departure }) {
  const [open, setOpen] = useState(false);
  const [capacity, setCapacity] = useState(String(departure.capacity));
  const [status, setStatus] = useState(departure.status);
  const [prices, setPrices] = useState<PriceDraft>(priceDraft(departure.prices));
  const [priceError, setPriceError] = useState<string | undefined>();
  const { toast } = useToast();
  const invalidate = useInvalidateCatalog();
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await invalidate();
  };
  const updatePackage = $api.useMutation('patch', '/v1/admin/package-departures/{id}', {
    onSuccess,
  });
  const updateTour = $api.useMutation('patch', '/v1/admin/tour-departures/{id}', { onSuccess });
  const mutation = kind === 'package' ? updatePackage : updateTour;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = pricesFromDraft(prices);
    if (typeof parsed === 'string') {
      setPriceError(parsed);
      return;
    }
    setPriceError(undefined);
    const args = {
      params: { path: { id: departure.id } },
      body: { capacity: Number(capacity), status, prices: parsed },
    };
    if (kind === 'package') updatePackage.mutate(args);
    else updateTour.mutate(args);
  };
  return (
    <FormDialog
      triggerLabel={t('common.edit')}
      title={t('catalog.editDeparture')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) mutation.reset();
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('catalog.capacity')}
            name="capacity"
            type="number"
            min={1}
            max={1000}
            value={capacity}
            required
            onChange={(event) => setCapacity(event.target.value)}
          />
          <SelectField
            label={t('catalog.departureStatus')}
            name="status"
            value={status}
            options={DEPARTURE_STATUSES.map((value) => ({
              value,
              label: label('catalog.departureStatuses', value),
            }))}
            onChange={(event) => setStatus(event.target.value as Departure['status'])}
          />
          <PriceFields draft={prices} onChange={setPrices} errorField={priceError} />
        </FormGrid>
        <ProblemAlert error={mutation.error} />
        <Button type="submit" loading={mutation.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function DeparturesDialog({ kind, product }: { kind: 'package' | 'tour'; product: Product }) {
  const [open, setOpen] = useState(false);
  return (
    <FormDialog
      triggerLabel={t('catalog.manageDepartures', { count: product.departures.length })}
      title={t('catalog.departuresOf', { title: product.title })}
      open={open}
      onOpenChange={setOpen}
      testId={`departures-${product.slug}`}
    >
      <div className="flex flex-col gap-6">
        <DataTable
          caption={t('catalog.departures')}
          rows={product.departures}
          rowKey={(row) => row.id}
          empty={t('catalog.noDepartures')}
          columns={[
            {
              key: 'start',
              header: t('catalog.startDate'),
              cell: (row) =>
                row.startsOn.length > 10
                  ? row.startsOn.replace('T', ' ')
                  : format.date(row.startsOn, 'medium'),
            },
            {
              key: 'seats',
              header: t('catalog.capacity'),
              cell: (row) =>
                t('catalog.seats', {
                  sold: row.seatsSold,
                  reserved: row.seatsReserved,
                  capacity: row.capacity,
                }),
            },
            {
              key: 'price',
              header: t('catalog.adultPrice'),
              cell: (row) => format.money(row.prices.adult),
            },
            {
              key: 'status',
              header: t('common.status'),
              cell: (row) => label('catalog.departureStatuses', row.status),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              cell: (row) => <DepartureEditor kind={kind} departure={row} />,
            },
          ]}
        />
        <NewDepartureForm kind={kind} product={product} />
      </div>
    </FormDialog>
  );
}

function ProductList({ kind }: { kind: Kind }) {
  const [status, setStatus] = useState<Status | ''>('');
  const query = $api.useQuery('get', '/v1/admin/catalog', {
    params: { query: { kind, ...(status ? { status } : {}) } },
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="max-w-popover">
          <SelectField
            label={t('common.status')}
            name={`${kind}-status`}
            value={status}
            options={[
              { value: '', label: t('common.all') },
              ...(['draft', 'published', 'archived'] as const).map((value) => ({
                value,
                label: label('catalog.statuses', value),
              })),
            ]}
            onChange={(event) => setStatus(event.target.value as Status | '')}
          />
        </div>
        <ProductDialog kind={kind} product={null} />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={label('catalog.kinds', kind)}
            rows={data.products}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'title',
                header: t('catalog.title_'),
                cell: (row) => (
                  <div className="flex flex-col gap-1">
                    <span className="font-bold">{row.title}</span>
                    <span className="font-body text-caption text-muted">{row.slug}</span>
                  </div>
                ),
              },
              {
                key: 'status',
                header: t('common.status'),
                cell: (row) => (
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge tone={statusTone(row.status)}>
                      {label('catalog.statuses', row.status)}
                    </StatusBadge>
                    {row.sample ? (
                      <StatusBadge tone="info">{t('catalog.sample')}</StatusBadge>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'updated',
                header: t('common.updated'),
                cell: (row) => format.dateTime(row.updatedAt),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => (
                  <div className="flex flex-wrap gap-2">
                    <ProductDialog kind={kind} product={row} />
                    {kind === 'package' || kind === 'tour' ? (
                      <DeparturesDialog kind={kind} product={row} />
                    ) : null}
                    <StatusActions kind={kind} product={row} />
                  </div>
                ),
              },
            ]}
          />
        )}
      </QueryState>
    </div>
  );
}

export function CatalogPage() {
  return (
    <RequirePermission permission="catalog:manage">
      <PageHeader title={t('catalog.title')} intro={t('catalog.intro')} />
      <Tabs defaultValue="package">
        <TabsList aria-label={t('catalog.title')}>
          {KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind}>
              {label('catalog.kinds', kind)}
            </TabsTrigger>
          ))}
        </TabsList>
        {KINDS.map((kind) => (
          <TabsContent key={kind} value={kind} className="pt-4">
            <ProductList kind={kind} />
          </TabsContent>
        ))}
      </Tabs>
    </RequirePermission>
  );
}
