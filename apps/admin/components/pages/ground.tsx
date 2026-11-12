'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { minorFromInput } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { formatPolicy, parsePolicy } from '../../lib/policy';
import { RequirePermission } from '../console-shell';
import {
  DataTable,
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

type Operator = Schemas['AdminBusOperators']['operators'][number];
type Trip = Schemas['AdminBusTrips']['trips'][number];
type CancelReason = 'operator_cancelled' | 'weather' | 'security' | 'vehicle_fault' | 'other';

const CANCEL_REASONS: readonly CancelReason[] = [
  'operator_cancelled',
  'weather',
  'security',
  'vehicle_fault',
  'other',
];
const GROUND = '/v1/admin/ground';

function useInvalidateGround() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['operators', 'terminals', 'layouts', 'routes', 'trips'].map((path) =>
        queryClient.invalidateQueries({ queryKey: ['get', `${GROUND}/${path}`] }),
      ),
    );
}

/** A modal form whose mutation closes it and refreshes the ground lists on success. */
function CreateDialog({
  title,
  invalid,
  error,
  pending,
  open,
  onOpenChange,
  onSubmit,
  children,
  testId,
}: {
  title: string;
  invalid: boolean;
  error: unknown;
  pending: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <FormDialog
      triggerLabel={title}
      triggerVariant="secondary"
      title={title}
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
    >
      <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
        {children}
        {invalid ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {t('common.validation')}
          </p>
        ) : null}
        <ProblemAlert error={error} />
        <Button type="submit" loading={pending}>
          {t('common.create')}
        </Button>
      </form>
    </FormDialog>
  );
}

function useSaved(close: () => void) {
  const { toast } = useToast();
  const invalidate = useInvalidateGround();
  return async () => {
    close();
    toast({ title: t('ground.saved'), variant: 'success' });
    await invalidate();
  };
}

function NewOperator() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [policy, setPolicy] = useState('2, 90\n0, 0');
  const [invalid, setInvalid] = useState(false);
  const create = $api.useMutation('post', `${GROUND}/operators`, {
    onSuccess: useSaved(() => setOpen(false)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const tiers = parsePolicy(policy);
    setInvalid(!tiers);
    if (tiers) create.mutate({ body: { name, slug, cancellationPolicy: tiers } });
  };
  return (
    <CreateDialog
      title={t('ground.newOperator')}
      invalid={invalid}
      error={create.error}
      pending={create.isPending}
      open={open}
      onOpenChange={setOpen}
      onSubmit={submit}
    >
      <FormGrid>
        <TextField
          label={t('ground.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={t('ground.slug')}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
      </FormGrid>
      <TextAreaField
        label={t('ground.policy')}
        hint={t('ground.policyHint')}
        value={policy}
        onChange={(e) => setPolicy(e.target.value)}
      />
    </CreateDialog>
  );
}

function AddAgent({ operator }: { operator: Operator }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const { toast } = useToast();
  const invalidate = useInvalidateGround();
  const add = $api.useMutation('put', `${GROUND}/operators/{id}/agents/{userId}`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('ground.agentAdded'), variant: 'success' });
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate({ params: { path: { id: operator.id, userId: userId.trim() } } });
  };
  return (
    <FormDialog
      triggerLabel={t('ground.addAgent')}
      triggerAriaLabel={t('ground.addAgentFor', { name: operator.name })}
      title={t('ground.addAgentFor', { name: operator.name })}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('ground.agentUserId')}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <ProblemAlert error={add.error} />
        <Button type="submit" loading={add.isPending}>
          {t('ground.addAgent')}
        </Button>
      </form>
    </FormDialog>
  );
}

function PublishOperator({ operator }: { operator: Operator }) {
  const { toast } = useToast();
  const invalidate = useInvalidateGround();
  const update = $api.useMutation('patch', `${GROUND}/operators/{id}`, {
    onSuccess: async () => {
      toast({ title: t('ground.saved'), variant: 'success' });
      await invalidate();
    },
  });
  if (operator.status === 'published') return null;
  return (
    <Button
      variant="ghost"
      loading={update.isPending}
      aria-label={t('ground.publishFor', { name: operator.name })}
      onClick={() =>
        update.mutate({ params: { path: { id: operator.id } }, body: { status: 'published' } })
      }
    >
      {t('ground.publish')}
    </Button>
  );
}

function Operators() {
  const query = $api.useQuery('get', `${GROUND}/operators`);
  return (
    <Section title={t('ground.operators')} actions={<NewOperator />}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('ground.operators')}
            rows={data.operators}
            rowKey={(row) => row.id}
            columns={[
              { key: 'name', header: t('ground.name'), cell: (row) => row.name },
              {
                key: 'status',
                header: t('ground.status'),
                cell: (row) => (
                  <StatusBadge tone={row.status === 'published' ? 'success' : 'neutral'}>
                    {label('ground.statuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'policy',
                header: t('ground.policy'),
                cell: (row) => (
                  <span className="whitespace-pre-line">
                    {formatPolicy(row.cancellationPolicy)}
                  </span>
                ),
              },
              { key: 'agents', header: t('ground.agents'), cell: (row) => row.agents },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => (
                  <div className="flex flex-wrap gap-2">
                    <PublishOperator operator={row} />
                    <AddAgent operator={row} />
                  </div>
                ),
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function NewTerminal() {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({
    slug: '',
    name: '',
    cityName: '',
    stateName: '',
    countryCode: 'NG',
    address: '',
    lat: '',
    lng: '',
    timeZone: 'Africa/Lagos',
  });
  const create = $api.useMutation('post', `${GROUND}/terminals`, {
    onSuccess: useSaved(() => setOpen(false)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ body: { ...fields, lat: Number(fields.lat), lng: Number(fields.lng) } });
  };
  const field = (key: keyof typeof fields, text: string) => (
    <TextField
      label={text}
      value={fields[key]}
      onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
    />
  );
  return (
    <CreateDialog
      title={t('ground.newTerminal')}
      invalid={false}
      error={create.error}
      pending={create.isPending}
      open={open}
      onOpenChange={setOpen}
      onSubmit={submit}
    >
      <FormGrid>
        {field('name', t('ground.name'))}
        {field('slug', t('ground.slug'))}
        {field('cityName', t('ground.city'))}
        {field('stateName', t('ground.state'))}
        {field('countryCode', t('ground.country'))}
        {field('address', t('ground.address'))}
        {field('lat', t('ground.lat'))}
        {field('lng', t('ground.lng'))}
        {field('timeZone', t('ground.timeZone'))}
      </FormGrid>
    </CreateDialog>
  );
}

function Terminals() {
  const query = $api.useQuery('get', `${GROUND}/terminals`);
  return (
    <Section title={t('ground.terminals')} actions={<NewTerminal />}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('ground.terminals')}
            rows={data.terminals}
            rowKey={(row) => row.id}
            columns={[
              { key: 'name', header: t('ground.name'), cell: (row) => row.name },
              {
                key: 'city',
                header: t('ground.city'),
                cell: (row) => `${row.cityName}, ${row.stateName}`,
              },
              { key: 'address', header: t('ground.address'), cell: (row) => row.address },
              { key: 'tz', header: t('ground.timeZone'), cell: (row) => row.timeZone },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

/** "1A 1B - 1C 1D" per line; "-" is the aisle. */
function parseRows(text: string): (string | null)[][] | null {
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).map((cell) => (cell === '-' ? null : cell)));
  return rows.length > 0 && rows.every((row) => row.some(Boolean)) ? rows : null;
}

function NewLayout({ operators }: { operators: readonly Operator[] }) {
  const [open, setOpen] = useState(false);
  const [operatorId, setOperatorId] = useState(operators[0]?.id ?? '');
  const [name, setName] = useState('');
  const [rows, setRows] = useState('1A 1B - 1C 1D\n2A 2B - 2C 2D');
  const [amenities, setAmenities] = useState('air_conditioning');
  const [invalid, setInvalid] = useState(false);
  const create = $api.useMutation('post', `${GROUND}/layouts`, {
    onSuccess: useSaved(() => setOpen(false)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const layout = parseRows(rows);
    setInvalid(!layout);
    if (!layout) return;
    create.mutate({
      body: {
        operatorId,
        name,
        layout: { rows: layout },
        amenities: amenities
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      },
    });
  };
  return (
    <CreateDialog
      title={t('ground.newLayout')}
      invalid={invalid}
      error={create.error}
      pending={create.isPending}
      open={open}
      onOpenChange={setOpen}
      onSubmit={submit}
    >
      <SelectField
        label={t('ground.operator')}
        name="operator"
        value={operatorId}
        onChange={(event) => setOperatorId(event.target.value)}
        options={operators.map((operator) => ({ value: operator.id, label: operator.name }))}
      />
      <TextField label={t('ground.name')} value={name} onChange={(e) => setName(e.target.value)} />
      <TextAreaField
        label={t('ground.rows')}
        hint={t('ground.rowsHint')}
        rows={8}
        value={rows}
        onChange={(e) => setRows(e.target.value)}
      />
      <TextField
        label={t('ground.amenities')}
        value={amenities}
        onChange={(e) => setAmenities(e.target.value)}
      />
    </CreateDialog>
  );
}

function NewRoute({
  operators,
  terminals,
}: {
  operators: readonly Operator[];
  terminals: readonly { id: string; name: string; cityName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [operatorId, setOperatorId] = useState(operators[0]?.id ?? '');
  const [originId, setOriginId] = useState(terminals[0]?.id ?? '');
  const [destinationId, setDestinationId] = useState(terminals[1]?.id ?? '');
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const create = $api.useMutation('post', `${GROUND}/routes`, {
    onSuccess: useSaved(() => setOpen(false)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      body: {
        operatorId,
        originId,
        destinationId,
        distanceKm: Number(distance),
        durationMinutes: Number(duration),
      },
    });
  };
  const terminalOptions = terminals.map((terminal) => ({
    value: terminal.id,
    label: `${terminal.cityName}: ${terminal.name}`,
  }));
  return (
    <CreateDialog
      title={t('ground.newRoute')}
      invalid={false}
      error={create.error}
      pending={create.isPending}
      open={open}
      onOpenChange={setOpen}
      onSubmit={submit}
    >
      <SelectField
        label={t('ground.operator')}
        name="operator"
        value={operatorId}
        onChange={(e) => setOperatorId(e.target.value)}
        options={operators.map((operator) => ({ value: operator.id, label: operator.name }))}
      />
      <FormGrid>
        <SelectField
          label={t('ground.origin')}
          name="origin"
          value={originId}
          onChange={(e) => setOriginId(e.target.value)}
          options={terminalOptions}
        />
        <SelectField
          label={t('ground.destination')}
          name="destination"
          value={destinationId}
          onChange={(e) => setDestinationId(e.target.value)}
          options={terminalOptions}
        />
        <TextField
          label={t('ground.distance')}
          inputMode="numeric"
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
        />
        <TextField
          label={t('ground.duration')}
          inputMode="numeric"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </FormGrid>
    </CreateDialog>
  );
}

function Network() {
  const operators = $api.useQuery('get', `${GROUND}/operators`);
  const terminals = $api.useQuery('get', `${GROUND}/terminals`);
  const layouts = $api.useQuery('get', `${GROUND}/layouts`);
  const routes = $api.useQuery('get', `${GROUND}/routes`);
  const operatorList = operators.data?.operators ?? [];
  const terminalList = terminals.data?.terminals ?? [];
  return (
    <>
      <Section
        title={t('ground.layouts')}
        actions={operatorList.length > 0 ? <NewLayout operators={operatorList} /> : null}
      >
        <QueryState query={layouts}>
          {(data) => (
            <DataTable
              caption={t('ground.layouts')}
              rows={data.layouts}
              rowKey={(row) => row.id}
              columns={[
                { key: 'name', header: t('ground.name'), cell: (row) => row.name },
                {
                  key: 'operator',
                  header: t('ground.operator'),
                  cell: (row) =>
                    operatorList.find((operator) => operator.id === row.operatorId)?.name ??
                    t('common.none'),
                },
                { key: 'seats', header: t('ground.seats'), cell: (row) => row.seatCount },
                {
                  key: 'amenities',
                  header: t('ground.amenities'),
                  cell: (row) => row.amenities.join(', '),
                },
              ]}
            />
          )}
        </QueryState>
      </Section>
      <Section
        title={t('ground.routes')}
        actions={
          operatorList.length > 0 && terminalList.length > 1 ? (
            <NewRoute operators={operatorList} terminals={terminalList} />
          ) : null
        }
      >
        <QueryState query={routes}>
          {(data) => (
            <DataTable
              caption={t('ground.routes')}
              rows={data.routes}
              rowKey={(row) => row.id}
              columns={[
                { key: 'operator', header: t('ground.operator'), cell: (row) => row.operatorName },
                {
                  key: 'route',
                  header: t('ground.route'),
                  cell: (row) => `${row.origin} → ${row.destination}`,
                },
                { key: 'distance', header: t('ground.distance'), cell: (row) => row.distanceKm },
                {
                  key: 'duration',
                  header: t('ground.duration'),
                  cell: (row) => row.durationMinutes,
                },
              ]}
            />
          )}
        </QueryState>
      </Section>
    </>
  );
}

function NewTrips() {
  const routes = $api.useQuery('get', `${GROUND}/routes`);
  const layouts = $api.useQuery('get', `${GROUND}/layouts`);
  const [open, setOpen] = useState(false);
  const [routeId, setRouteId] = useState('');
  const [layoutId, setLayoutId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [times, setTimes] = useState('07:00');
  const [fare, setFare] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [invalid, setInvalid] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateGround();
  const schedule = $api.useMutation('post', `${GROUND}/trips/schedule`, {
    onSuccess: async (result) => {
      setOpen(false);
      toast({ title: t('ground.scheduled', result), variant: 'success' });
      await invalidate();
    },
  });
  const routeList = routes.data?.routes ?? [];
  const route = routeList.find((item) => item.id === routeId) ?? routeList[0];
  const layoutList = (layouts.data?.layouts ?? []).filter(
    (layout) => !route || layout.operatorId === route.operatorId,
  );
  // The first layout of the route's operator until staff pick another.
  const selectedLayout = layoutList.some((layout) => layout.id === layoutId)
    ? layoutId
    : (layoutList[0]?.id ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fareMinor = minorFromInput(fare, currency);
    const list = times
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const layout = selectedLayout;
    if (!route || !layout || !fareMinor || !Number.isFinite(fareMinor) || list.length === 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    schedule.mutate({
      body: {
        routeId: route.id,
        layoutId: layout,
        fromDate,
        toDate,
        times: list,
        fareMinor,
        currency,
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('ground.schedule')}
      triggerVariant="secondary"
      title={t('ground.schedule')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('ground.route')}
          name="route"
          value={route?.id ?? ''}
          onChange={(event) => setRouteId(event.target.value)}
          options={routeList.map((item) => ({
            value: item.id,
            label: `${item.operatorName}: ${item.origin} → ${item.destination}`,
          }))}
        />
        <SelectField
          label={t('ground.layout')}
          name="layout"
          value={selectedLayout}
          onChange={(event) => setLayoutId(event.target.value)}
          options={layoutList.map((layout) => ({
            value: layout.id,
            label: `${layout.name} (${layout.seatCount})`,
          }))}
        />
        <FormGrid>
          <TextField
            label={t('ground.fromDate')}
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <TextField
            label={t('ground.toDate')}
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
          <TextField
            label={t('ground.times')}
            value={times}
            onChange={(e) => setTimes(e.target.value)}
          />
          <TextField
            label={t('ground.fare')}
            inputMode="decimal"
            value={fare}
            onChange={(e) => setFare(e.target.value)}
          />
          <TextField
            label={t('common.currency')}
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </FormGrid>
        {invalid ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {t('common.validation')}
          </p>
        ) : null}
        <ProblemAlert error={schedule.error} />
        <Button type="submit" loading={schedule.isPending}>
          {t('ground.schedule')}
        </Button>
      </form>
    </FormDialog>
  );
}

function CancelTrip({ trip }: { trip: Trip }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason>('operator_cancelled');
  const { toast } = useToast();
  const invalidate = useInvalidateGround();
  const cancel = $api.useMutation('post', `${GROUND}/trips/{id}/cancel`, {
    onSuccess: async (result) => {
      setOpen(false);
      toast({
        title: t('ground.tripCancelled', {
          refunded: result.refundedBookings,
          released: result.releasedBookings,
        }),
        variant: 'success',
      });
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    cancel.mutate({ params: { path: { id: trip.id } }, body: { reason } });
  };
  return (
    <FormDialog
      triggerLabel={t('ground.cancelTrip')}
      triggerAriaLabel={t('ground.cancelFor', { time: trip.departsAtLocal.replace('T', ' ') })}
      title={t('ground.cancelTrip')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('ground.cancelReason')}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as CancelReason)}
          options={CANCEL_REASONS.map((value) => ({
            value,
            label: label('ground.cancelReasons', value),
          }))}
        />
        <ProblemAlert error={cancel.error} />
        <Button type="submit" loading={cancel.isPending}>
          {t('ground.cancelTrip')}
        </Button>
      </form>
    </FormDialog>
  );
}

const dayInput = (offsetDays: number): string => {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function Trips() {
  const [from, setFrom] = useState(() => dayInput(0));
  const [to, setTo] = useState(() => dayInput(14));
  const query = $api.useQuery('get', `${GROUND}/trips`, { params: { query: { from, to } } });
  return (
    <Section title={t('ground.trips')} actions={<NewTrips />}>
      <div className="grid max-w-dialog grid-cols-1 gap-4 md:grid-cols-2">
        <TextField
          label={t('ground.fromDate')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label={t('ground.toDate')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('ground.trips')}
            rows={data.trips}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'departs',
                header: t('ground.departs'),
                cell: (row) => row.departsAtLocal.replace('T', ' '),
              },
              { key: 'operator', header: t('ground.operator'), cell: (row) => row.operatorName },
              {
                key: 'route',
                header: t('ground.route'),
                cell: (row) => `${row.origin} → ${row.destination}`,
              },
              { key: 'fare', header: t('ground.fare'), cell: (row) => format.money(row.fare) },
              {
                key: 'sold',
                header: t('ground.sold'),
                cell: (row) => `${row.sold}/${row.seatCount}`,
              },
              {
                key: 'status',
                header: t('ground.status'),
                cell: (row) => (
                  <StatusBadge tone={row.status === 'cancelled' ? 'danger' : 'info'}>
                    {label('ground.tripStatuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => (row.status === 'scheduled' ? <CancelTrip trip={row} /> : null),
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

/** Interstate bus inventory (`ground:manage`, ADR-049). */
export function GroundPage() {
  return (
    <RequirePermission permission="ground:manage">
      <PageHeader title={t('ground.title')} intro={t('ground.intro')} />
      <Trips />
      <Operators />
      <Terminals />
      <Network />
    </RequirePermission>
  );
}
