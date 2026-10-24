'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { bpsFromPercent, inputFromMinor, minorFromInput, percentFromBps } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  CheckboxField,
  ConfirmAction,
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

type Category = 'standard' | 'comfort' | 'xl';
type CancelReason = 'safety' | 'driver_unreachable' | 'rider_request' | 'fraud' | 'other';
type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
type Resolution = 'false_alarm' | 'assisted' | 'escalated_to_police' | 'driver_suspended' | 'other';
type FareRule = Schemas['RideFareRules']['rules'][number];
type PlaceKind = 'airport' | 'terminal' | 'landmark';

const CATEGORIES: readonly Category[] = ['standard', 'comfort', 'xl'];
const CANCEL_REASONS: readonly CancelReason[] = [
  'safety',
  'driver_unreachable',
  'rider_request',
  'fraud',
  'other',
];
const RESOLUTIONS: readonly Resolution[] = [
  'false_alarm',
  'assisted',
  'escalated_to_police',
  'driver_suspended',
  'other',
];
const LIVE_REFRESH_MS = 10_000;

function StopRide({ rideId }: { rideId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason>('safety');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const cancel = $api.useMutation('post', '/v1/admin/rides/{rideId}/cancel', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('rides.cancelled'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/rides/live'] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    cancel.mutate({ params: { path: { rideId } }, body: { reason } });
  };
  return (
    <FormDialog
      triggerLabel={t('rides.cancel')}
      triggerAriaLabel={t('rides.cancelFor', { id: rideId.slice(0, 8) })}
      title={t('rides.cancel')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('rides.cancelReason')}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as CancelReason)}
          options={CANCEL_REASONS.map((value) => ({
            value,
            label: label('rides.cancelReasons', value),
          }))}
        />
        <ProblemAlert error={cancel.error} />
        <Button type="submit" loading={cancel.isPending}>
          {t('rides.cancel')}
        </Button>
      </form>
    </FormDialog>
  );
}

function LiveRides() {
  const { can } = useStaffSession();
  const query = $api.useQuery(
    'get',
    '/v1/admin/rides/live',
    {},
    { refetchInterval: LIVE_REFRESH_MS },
  );
  return (
    <Section title={t('rides.live')} intro={t('rides.liveIntro')}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('rides.live')}
            rows={data.rides}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'ride',
                header: t('rides.ride'),
                cell: (row) => (
                  <Link
                    href={`/bookings/${row.bookingId}` as Route}
                    className="font-bold text-primary underline focus-visible:focus-ring"
                  >
                    {row.id.slice(0, 8)}
                  </Link>
                ),
              },
              { key: 'city', header: t('rides.city'), cell: (row) => row.cityName },
              {
                key: 'category',
                header: t('rides.category'),
                cell: (row) => label('rides.categories', row.category),
              },
              {
                key: 'status',
                header: t('rides.status'),
                cell: (row) => (
                  <StatusBadge tone={row.offRoute || row.openIncidents > 0 ? 'danger' : 'info'}>
                    {label('rides.statuses', row.status)}
                    {row.offRoute ? ` · ${t('rides.offRoute')}` : ''}
                  </StatusBadge>
                ),
              },
              {
                key: 'pickup',
                header: t('rides.pickup'),
                cell: (row) => `${row.pickup.lat.toFixed(3)}, ${row.pickup.lng.toFixed(3)}`,
              },
              {
                key: 'incidents',
                header: t('rides.incidentsOpen'),
                cell: (row) => row.openIncidents,
              },
              {
                key: 'started',
                header: t('rides.started'),
                cell: (row) => format.dateTime(row.createdAt),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => (can('safety:manage') ? <StopRide rideId={row.id} /> : null),
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function Acknowledge({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const acknowledge = $api.useMutation('post', '/v1/admin/rides/incidents/{id}/acknowledge', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('rides.acknowledged'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/rides/incidents'] });
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('rides.acknowledge')}
      question={t('rides.acknowledge')}
      onConfirm={() => acknowledge.mutate({ params: { path: { id } } })}
      pending={acknowledge.isPending}
      error={acknowledge.error}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

function Resolve({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<Resolution>('assisted');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resolve = $api.useMutation('post', '/v1/admin/rides/incidents/{id}/resolve', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('rides.resolved'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/rides/incidents'] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    resolve.mutate({ params: { path: { id } }, body: { resolution } });
  };
  return (
    <FormDialog
      triggerLabel={t('rides.resolve')}
      triggerAriaLabel={t('rides.resolveFor', { id: id.slice(0, 8) })}
      title={t('rides.resolve')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('rides.resolution')}
          name="resolution"
          value={resolution}
          onChange={(event) => setResolution(event.target.value as Resolution)}
          options={RESOLUTIONS.map((value) => ({
            value,
            label: label('rides.resolutions', value),
          }))}
        />
        <ProblemAlert error={resolve.error} />
        <Button type="submit" loading={resolve.isPending}>
          {t('rides.resolve')}
        </Button>
      </form>
    </FormDialog>
  );
}

function Incidents() {
  const { can } = useStaffSession();
  const [status, setStatus] = useState<IncidentStatus>('open');
  const query = $api.useQuery(
    'get',
    '/v1/admin/rides/incidents',
    { params: { query: { status } } },
    { refetchInterval: LIVE_REFRESH_MS },
  );
  return (
    <Section title={t('rides.incidents')}>
      <div className="max-w-popover">
        <SelectField
          label={t('rides.incidentStatus')}
          name="incident-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as IncidentStatus)}
          options={(['open', 'acknowledged', 'resolved'] as const).map((value) => ({
            value,
            label: label('rides.incidentStatuses', value),
          }))}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('rides.incidents')}
            rows={data.incidents}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'kind',
                header: t('rides.kind'),
                cell: (row) => label('rides.kinds', row.kind),
              },
              {
                key: 'reporter',
                header: t('rides.reporter'),
                cell: (row) => label('rides.reporters', row.reporter),
              },
              {
                key: 'ride',
                header: t('rides.ride'),
                cell: (row) => (row.rideId ? row.rideId.slice(0, 8) : t('common.none')),
              },
              {
                key: 'position',
                header: t('rides.position'),
                cell: (row) =>
                  row.position
                    ? `${row.position.lat.toFixed(4)}, ${row.position.lng.toFixed(4)}`
                    : t('common.none'),
              },
              {
                key: 'raised',
                header: t('rides.raised'),
                cell: (row) => format.dateTime(row.createdAt),
              },
              {
                key: 'status',
                header: t('rides.incidentStatus'),
                cell: (row) => (
                  <StatusBadge tone={row.status === 'resolved' ? 'success' : 'danger'}>
                    {row.resolution
                      ? label('rides.resolutions', row.resolution)
                      : label('rides.incidentStatuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) =>
                  can('safety:manage') && row.status !== 'resolved' ? (
                    <div className="flex flex-wrap gap-2">
                      {row.status === 'open' ? <Acknowledge id={row.id} /> : null}
                      <Resolve id={row.id} />
                    </div>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

const EMPTY_RULE: Omit<FareRule, 'id'> = {
  cityName: 'Lagos',
  category: 'standard',
  currency: 'NGN',
  baseMinor: 0,
  perKmMinor: 0,
  perMinuteMinor: 0,
  bookingFeeMinor: 0,
  minimumMinor: 0,
  cancellationFeeMinor: 0,
  freeCancelSeconds: 120,
  waitGraceSeconds: 300,
  driverShareBps: 8000,
  surgeBps: 0,
  active: true,
};
const MONEY_FIELDS = [
  ['baseMinor', 'rides.base'],
  ['perKmMinor', 'rides.perKm'],
  ['perMinuteMinor', 'rides.perMinute'],
  ['bookingFeeMinor', 'rides.bookingFee'],
  ['minimumMinor', 'rides.minimum'],
  ['cancellationFeeMinor', 'rides.cancellationFee'],
] as const;

function FareRuleForm({ rule }: { rule: FareRule | null }) {
  const start = rule ?? { ...EMPTY_RULE, id: '' };
  const [open, setOpen] = useState(false);
  const [cityName, setCityName] = useState(start.cityName);
  const [category, setCategory] = useState<Category>(start.category);
  const [currency, setCurrency] = useState(start.currency);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      MONEY_FIELDS.map(([key]) => [key, inputFromMinor(start[key], start.currency)]),
    ),
  );
  const [freeCancel, setFreeCancel] = useState(String(start.freeCancelSeconds));
  const [waitGrace, setWaitGrace] = useState(String(start.waitGraceSeconds));
  const [share, setShare] = useState(percentFromBps(start.driverShareBps));
  const [surge, setSurge] = useState(percentFromBps(start.surgeBps));
  const [active, setActive] = useState(start.active);
  const [invalid, setInvalid] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const save = $api.useMutation('put', '/v1/admin/rides/fare-rules', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('rides.ruleSaved'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/rides/fare-rules'] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const minor = Object.fromEntries(
      MONEY_FIELDS.map(([key]) => [key, minorFromInput(amounts[key] ?? '', currency) ?? 0]),
    ) as Record<(typeof MONEY_FIELDS)[number][0], number>;
    const numbers = [
      ...Object.values(minor),
      Number(freeCancel),
      Number(waitGrace),
      bpsFromPercent(share),
      bpsFromPercent(surge),
    ];
    if (numbers.some((value) => !Number.isFinite(value))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate({
      body: {
        cityName,
        category,
        currency,
        ...minor,
        freeCancelSeconds: Number(freeCancel),
        waitGraceSeconds: Number(waitGrace),
        driverShareBps: bpsFromPercent(share),
        surgeBps: bpsFromPercent(surge),
        active,
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={rule ? t('rides.editRule') : t('rides.newRule')}
      triggerVariant={rule ? 'ghost' : 'secondary'}
      title={
        rule ? `${rule.cityName} · ${label('rides.categories', rule.category)}` : t('rides.newRule')
      }
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('rides.city')}
            value={cityName}
            onChange={(e) => setCityName(e.target.value)}
            disabled={rule !== null}
          />
          <SelectField
            label={t('rides.category')}
            name="category"
            value={category}
            disabled={rule !== null}
            onChange={(event) => setCategory(event.target.value as Category)}
            options={CATEGORIES.map((value) => ({
              value,
              label: label('rides.categories', value),
            }))}
          />
          <TextField
            label={t('common.currency')}
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
          {MONEY_FIELDS.map(([key, text]) => (
            <TextField
              key={key}
              label={t(text)}
              inputMode="decimal"
              value={amounts[key] ?? ''}
              onChange={(event) => setAmounts({ ...amounts, [key]: event.target.value })}
            />
          ))}
          <TextField
            label={t('rides.freeCancel')}
            inputMode="numeric"
            value={freeCancel}
            onChange={(e) => setFreeCancel(e.target.value)}
          />
          <TextField
            label={t('rides.waitGrace')}
            inputMode="numeric"
            value={waitGrace}
            onChange={(e) => setWaitGrace(e.target.value)}
          />
          <TextField
            label={t('rides.driverShare')}
            inputMode="decimal"
            value={share}
            onChange={(e) => setShare(e.target.value)}
          />
          <TextField
            label={t('rides.surge')}
            inputMode="decimal"
            value={surge}
            onChange={(e) => setSurge(e.target.value)}
          />
        </FormGrid>
        <CheckboxField
          label={t('rides.active')}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        {invalid ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {t('common.validation')}
          </p>
        ) : null}
        <ProblemAlert error={save.error} />
        <Button type="submit" loading={save.isPending}>
          {t('rides.saveRule')}
        </Button>
      </form>
    </FormDialog>
  );
}

function FareRules() {
  const query = $api.useQuery('get', '/v1/admin/rides/fare-rules');
  return (
    <Section
      title={t('rides.fares')}
      intro={t('rides.faresIntro')}
      actions={<FareRuleForm rule={null} />}
    >
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('rides.fares')}
            rows={data.rules}
            rowKey={(row) => row.id}
            columns={[
              { key: 'city', header: t('rides.city'), cell: (row) => row.cityName },
              {
                key: 'category',
                header: t('rides.category'),
                cell: (row) => label('rides.categories', row.category),
              },
              {
                key: 'base',
                header: t('rides.base'),
                cell: (row) => format.money({ amountMinor: row.baseMinor, currency: row.currency }),
              },
              {
                key: 'perKm',
                header: t('rides.perKm'),
                cell: (row) =>
                  format.money({ amountMinor: row.perKmMinor, currency: row.currency }),
              },
              {
                key: 'minimum',
                header: t('rides.minimum'),
                cell: (row) =>
                  format.money({ amountMinor: row.minimumMinor, currency: row.currency }),
              },
              {
                key: 'share',
                header: t('rides.driverShare'),
                cell: (row) => `${percentFromBps(row.driverShareBps)}%`,
              },
              {
                key: 'active',
                header: t('rides.active'),
                cell: (row) => (row.active ? t('common.active') : t('common.inactive')),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <FareRuleForm rule={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function NewPlace() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlaceKind>('landmark');
  const [cityName, setCityName] = useState('Lagos');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = $api.useMutation('post', '/v1/admin/rides/places', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('rides.placeSaved'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/rides/places'] });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      body: { name, kind, cityName, lat: Number(lat), lng: Number(lng), active: true },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('rides.newPlace')}
      triggerVariant="secondary"
      title={t('rides.newPlace')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('rides.placeName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <SelectField
            label={t('rides.placeKind')}
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as PlaceKind)}
            options={(['airport', 'terminal', 'landmark'] as const).map((value) => ({
              value,
              label: label('rides.placeKinds', value),
            }))}
          />
          <TextField
            label={t('rides.city')}
            value={cityName}
            onChange={(e) => setCityName(e.target.value)}
          />
          <TextField
            label={t('rides.lat')}
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
          <TextField
            label={t('rides.lng')}
            inputMode="decimal"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </FormGrid>
        <ProblemAlert error={create.error} />
        <Button type="submit" loading={create.isPending}>
          {t('common.create')}
        </Button>
      </form>
    </FormDialog>
  );
}

function Places() {
  const query = $api.useQuery('get', '/v1/rides/places', { params: { query: {} } });
  return (
    <Section title={t('rides.places')} actions={<NewPlace />}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('rides.places')}
            rows={data.places}
            rowKey={(row) => row.id}
            columns={[
              { key: 'name', header: t('rides.placeName'), cell: (row) => row.name },
              {
                key: 'kind',
                header: t('rides.placeKind'),
                cell: (row) => label('rides.placeKinds', row.kind),
              },
              { key: 'city', header: t('rides.city'), cell: (row) => row.cityName },
              {
                key: 'position',
                header: t('rides.position'),
                cell: (row) => `${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}`,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

/**
 * Rides and safety (ADR-050 to ADR-053): the live board and incidents for `safety:manage`, fare
 * rules and pick-up places for `ground:manage`. The shell mounts the page for either role.
 */
export function RidesPage() {
  const { can } = useStaffSession();
  return (
    <RequirePermission permission={can('safety:manage') ? 'safety:manage' : 'ground:manage'}>
      <PageHeader title={t('rides.title')} intro={t('rides.intro')} />
      {can('safety:manage') ? (
        <>
          <LiveRides />
          <Incidents />
        </>
      ) : null}
      {can('ground:manage') ? (
        <>
          <FareRules />
          <Places />
        </>
      ) : null}
    </RequirePermission>
  );
}
