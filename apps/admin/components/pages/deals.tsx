'use client';

import { CABIN_CLASSES } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { fieldIssues, nullable } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { CityPicker, type PickedCity } from '../city-picker';
import { useStaffSession } from '../staff-session';
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
} from '../ui';

type Route = Schemas['AdminDealRoute'];
type Destination = Schemas['AdminDestination'];

const badge = (on: boolean, onLabel: string, offLabel: string) => (
  <StatusBadge tone={on ? 'success' : 'neutral'}>{on ? onLabel : offLabel}</StatusBadge>
);

function RouteDialog({ route }: { route: Route | null }) {
  const blank = {
    slug: route?.slug ?? '',
    originCode: route?.originCode ?? '',
    destinationCode: route?.destinationCode ?? '',
    cabinClass: route?.cabinClass ?? 'economy',
    stayNights: String(route?.stayNights ?? 7),
    sortOrder: String(route?.sortOrder ?? 0),
    active: route?.active ?? true,
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/deal-routes'] });
  };
  const create = $api.useMutation('post', '/v1/admin/deal-routes', { onSuccess });
  const update = $api.useMutation('patch', '/v1/admin/deal-routes/{id}', { onSuccess });
  const mutation = route ? update : create;
  const errors = fieldIssues(mutation.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = {
      slug: form.slug.trim(),
      originCode: form.originCode.trim().toUpperCase(),
      destinationCode: form.destinationCode.trim().toUpperCase(),
      cabinClass: form.cabinClass,
      stayNights: Number(form.stayNights),
      sortOrder: Number(form.sortOrder),
      active: form.active,
    };
    if (route) update.mutate({ params: { path: { id: route.id } }, body });
    else create.mutate({ body });
  };
  const title = route ? t('deals.editRoute') : t('deals.newRoute');
  return (
    <FormDialog
      triggerLabel={route ? t('common.edit') : title}
      triggerVariant={route ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank);
          mutation.reset();
        }
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('deals.slug')}
            hint={t('deals.slugHint')}
            name="slug"
            value={form.slug}
            required
            error={errors.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value })}
          />
          <SelectField
            label={t('deals.cabin')}
            name="cabinClass"
            value={form.cabinClass}
            options={CABIN_CLASSES.map((value) => ({
              value,
              label: label('pricing.cabins', value),
            }))}
            onChange={(event) =>
              setForm({ ...form, cabinClass: event.target.value as Route['cabinClass'] })
            }
          />
          <TextField
            label={t('deals.origin')}
            name="originCode"
            maxLength={3}
            value={form.originCode}
            required
            error={errors.originCode}
            onChange={(event) => setForm({ ...form, originCode: event.target.value })}
          />
          <TextField
            label={t('deals.destination')}
            name="destinationCode"
            maxLength={3}
            value={form.destinationCode}
            required
            error={errors.destinationCode}
            onChange={(event) => setForm({ ...form, destinationCode: event.target.value })}
          />
          <TextField
            label={t('deals.stayNights')}
            name="stayNights"
            type="number"
            min={1}
            max={60}
            value={form.stayNights}
            onChange={(event) => setForm({ ...form, stayNights: event.target.value })}
          />
          <TextField
            label={t('deals.sortOrder')}
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
          />
        </FormGrid>
        <CheckboxField
          label={t('common.active')}
          name="active"
          checked={form.active}
          onChange={(event) => setForm({ ...form, active: event.target.checked })}
        />
        <ProblemAlert error={mutation.error} />
        <Button type="submit" loading={mutation.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function DestinationDialog({ destination }: { destination: Destination | null }) {
  const blank = {
    slug: destination?.slug ?? '',
    featured: destination?.featured ?? false,
    sortOrder: String(destination?.sortOrder ?? 0),
    imageUrl: destination?.imageUrl ?? '',
    published: destination?.published ?? false,
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [city, setCity] = useState<PickedCity | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/destinations'] });
  };
  const create = $api.useMutation('post', '/v1/admin/destinations', { onSuccess });
  const update = $api.useMutation('patch', '/v1/admin/destinations/{id}', { onSuccess });
  const mutation = destination ? update : create;
  const errors = fieldIssues(mutation.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = {
      slug: form.slug.trim(),
      featured: form.featured,
      sortOrder: Number(form.sortOrder),
      imageUrl: nullable(form.imageUrl),
      published: form.published,
    };
    if (destination) update.mutate({ params: { path: { id: destination.id } }, body });
    else if (city) create.mutate({ body: { ...body, cityId: city.id } });
  };
  const title = destination ? t('deals.editDestination') : t('deals.newDestination');
  return (
    <FormDialog
      triggerLabel={destination ? t('common.edit') : title}
      triggerVariant={destination ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank);
          setCity(null);
          mutation.reset();
        }
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {destination ? (
          <p className="font-body text-body-sm text-foreground">
            {t('form.selectedCity', {
              name: destination.cityName,
              country: destination.countryCode,
            })}
          </p>
        ) : (
          <CityPicker value={city} onChange={setCity} error={errors.cityId} />
        )}
        <FormGrid>
          <TextField
            label={t('deals.slug')}
            hint={t('deals.slugHint')}
            name="slug"
            value={form.slug}
            required
            error={errors.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value })}
          />
          <TextField
            label={t('deals.sortOrder')}
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
          />
        </FormGrid>
        <TextField
          label={t('deals.imageUrl')}
          name="imageUrl"
          type="url"
          value={form.imageUrl}
          error={errors.imageUrl}
          onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
        />
        <CheckboxField
          label={t('deals.featured')}
          name="featured"
          checked={form.featured}
          onChange={(event) => setForm({ ...form, featured: event.target.checked })}
        />
        <CheckboxField
          label={t('deals.published')}
          name="published"
          checked={form.published}
          onChange={(event) => setForm({ ...form, published: event.target.checked })}
        />
        <ProblemAlert error={mutation.error} />
        <Button type="submit" loading={mutation.isPending} disabled={!destination && !city}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function Routes() {
  const query = $api.useQuery('get', '/v1/admin/deal-routes');
  return (
    <Section
      title={t('deals.routes')}
      intro={t('deals.routesIntro')}
      actions={<RouteDialog route={null} />}
    >
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('deals.routes')}
            rows={data.routes}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'route',
                header: t('dashboard.route'),
                cell: (row) => `${row.originCode} → ${row.destinationCode}`,
              },
              { key: 'slug', header: t('deals.slug'), cell: (row) => row.slug },
              {
                key: 'cabin',
                header: t('deals.cabin'),
                cell: (row) => label('pricing.cabins', row.cabinClass),
              },
              { key: 'nights', header: t('deals.stayNights'), cell: (row) => row.stayNights },
              {
                key: 'refreshed',
                header: t('deals.lastRefreshed'),
                cell: (row) =>
                  row.lastRefreshedAt ? format.dateTime(row.lastRefreshedAt) : t('deals.never'),
              },
              {
                key: 'active',
                header: t('common.status'),
                cell: (row) => badge(row.active, t('common.active'), t('common.inactive')),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <RouteDialog route={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function Destinations() {
  const query = $api.useQuery('get', '/v1/admin/destinations');
  return (
    <Section
      title={t('deals.destinations')}
      intro={t('deals.destinationsIntro')}
      actions={<DestinationDialog destination={null} />}
    >
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('deals.destinations')}
            rows={data.destinations}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'city',
                header: t('deals.city'),
                cell: (row) => `${row.cityName}, ${row.countryCode}`,
              },
              { key: 'slug', header: t('deals.slug'), cell: (row) => row.slug },
              {
                key: 'featured',
                header: t('deals.featured'),
                cell: (row) => (row.featured ? t('common.yes') : t('common.no')),
              },
              { key: 'order', header: t('deals.sortOrder'), cell: (row) => row.sortOrder },
              {
                key: 'published',
                header: t('common.status'),
                cell: (row) => badge(row.published, t('common.published'), t('common.unpublished')),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <DestinationDialog destination={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

export function DealsPage() {
  const { can } = useStaffSession();
  return (
    <>
      <PageHeader title={t('deals.title')} />
      {can('deals:manage') ? <Routes /> : null}
      {can('cms:manage') ? <Destinations /> : null}
      {!can('deals:manage') && !can('cms:manage') ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {t('common.forbidden')}
        </p>
      ) : null}
    </>
  );
}
