'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, problemMessage, type Schemas } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { minorFromInput } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { parsePolicy } from '../../lib/policy';
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

type Vehicle = Schemas['AdminRentalVehicles']['vehicles'][number];
type Reservation = Schemas['AdminRentalReservation'];
type RentalStatus = Reservation['status'];
type LicenceStatus = NonNullable<Reservation['licence']>['status'];
type RejectReason = 'unreadable' | 'expired' | 'name_mismatch' | 'not_a_licence' | 'other';
type KeptReason = 'damage' | 'fuel' | 'excess_mileage' | 'late_return' | 'cleaning' | 'other';

const RENTAL_STATUSES: readonly RentalStatus[] = [
  'reserved',
  'checked_out',
  'returned',
  'cancelled',
];
const LICENCE_STATUSES: readonly LicenceStatus[] = [
  'pending_upload',
  'pending_scan',
  'pending_review',
  'approved',
  'rejected',
];
const REJECT_REASONS: readonly RejectReason[] = [
  'unreadable',
  'expired',
  'name_mismatch',
  'not_a_licence',
  'other',
];
const KEPT_REASONS: readonly KeptReason[] = [
  'damage',
  'fuel',
  'excess_mileage',
  'late_return',
  'cleaning',
  'other',
];
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

function useInvalidateRentals() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/rentals/reservations'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/rentals/vehicles'] }),
    ]);
}

function PublishToggle({ vehicle }: { vehicle: Vehicle }) {
  const { toast } = useToast();
  const invalidate = useInvalidateRentals();
  const update = $api.useMutation('patch', '/v1/admin/rentals/vehicles/{id}', {
    onSuccess: async () => {
      toast({ title: t('rentals.statusSaved'), variant: 'success' });
      await invalidate();
    },
    onError: (error) => toast({ title: problemMessage(error), variant: 'error' }),
  });
  const published = vehicle.status === 'published';
  const car = `${vehicle.make} ${vehicle.model} ${vehicle.plate}`;
  return (
    <Button
      variant="ghost"
      loading={update.isPending}
      aria-label={published ? t('rentals.withdrawFor', { car }) : t('rentals.publishFor', { car })}
      onClick={() =>
        update.mutate({
          params: { path: { id: vehicle.id } },
          body: { status: published ? 'archived' : 'published' },
        })
      }
    >
      {published ? t('rentals.withdraw') : t('rentals.publish')}
    </Button>
  );
}

function Fleet() {
  const query = $api.useQuery('get', '/v1/admin/rentals/vehicles');
  return (
    <Section title={t('rentals.fleet')} actions={<NewVehicle />}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('rentals.fleet')}
            rows={data.vehicles}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'car',
                header: t('rentals.car'),
                cell: (row) => `${row.make} ${row.model} (${row.year})`,
              },
              { key: 'plate', header: t('rentals.plate'), cell: (row) => row.plate },
              { key: 'branch', header: t('rentals.branch'), cell: (row) => row.branch.name },
              { key: 'daily', header: t('rentals.daily'), cell: (row) => format.money(row.daily) },
              {
                key: 'deposit',
                header: t('rentals.deposit'),
                cell: (row) => format.money(row.deposit),
              },
              {
                key: 'upcoming',
                header: t('rentals.upcoming'),
                cell: (row) => row.upcomingRentals,
              },
              {
                key: 'status',
                header: t('common.status'),
                cell: (row) => (
                  <StatusBadge tone={row.status === 'published' ? 'success' : 'neutral'}>
                    {label('ground.statuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <PublishToggle vehicle={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function NewVehicle() {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({
    slug: '',
    make: '',
    model: '',
    year: '2022',
    category: 'economy',
    transmission: 'automatic',
    seats: '5',
    plate: '',
    cityName: 'Lagos',
    branchName: '',
    branchAddress: '',
    lat: '',
    lng: '',
    timeZone: 'Africa/Lagos',
    currency: 'NGN',
    daily: '',
    deposit: '',
    policy: '3, 100\n1, 50',
  });
  const [invalid, setInvalid] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateRentals();
  const create = $api.useMutation('post', '/v1/admin/rentals/vehicles', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('common.saved'), variant: 'success' });
      await invalidate();
    },
  });
  const set = (key: keyof typeof fields) => (value: string) =>
    setFields({ ...fields, [key]: value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const daily = minorFromInput(fields.daily, fields.currency);
    const deposit = minorFromInput(fields.deposit, fields.currency) ?? 0;
    const policy = parsePolicy(fields.policy);
    if (!daily || !Number.isFinite(daily) || !Number.isFinite(deposit) || !policy) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    create.mutate({
      body: {
        slug: fields.slug,
        make: fields.make,
        model: fields.model,
        year: Number(fields.year),
        category: fields.category as Vehicle['category'],
        transmission: fields.transmission as Vehicle['transmission'],
        seats: Number(fields.seats),
        plate: fields.plate,
        cityName: fields.cityName,
        branchName: fields.branchName,
        branchAddress: fields.branchAddress,
        lat: Number(fields.lat),
        lng: Number(fields.lng),
        timeZone: fields.timeZone,
        currency: fields.currency as 'NGN',
        dailyMinor: daily,
        depositMinor: deposit,
        cancellationPolicy: policy,
      },
    });
  };
  const text = (key: keyof typeof fields, labelText: string, inputMode?: 'decimal' | 'numeric') => (
    <TextField
      label={labelText}
      inputMode={inputMode}
      value={fields[key]}
      onChange={(event) => set(key)(event.target.value)}
    />
  );
  return (
    <FormDialog
      triggerLabel={t('rentals.newCar')}
      triggerVariant="secondary"
      title={t('rentals.newCar')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          {text('slug', t('ground.slug'))}
          {text('plate', t('rentals.plate'))}
          {text('make', t('rentals.make'))}
          {text('model', t('rentals.model'))}
          {text('year', t('rentals.year'), 'numeric')}
          {text('seats', t('ground.seats'), 'numeric')}
          <SelectField
            label={t('rentals.category')}
            name="category"
            value={fields.category}
            onChange={(event) => set('category')(event.target.value)}
            options={['economy', 'compact', 'suv', 'luxury', 'van'].map((value) => ({
              value,
              label: label('rentals.categories', value),
            }))}
          />
          <SelectField
            label={t('rentals.transmission')}
            name="transmission"
            value={fields.transmission}
            onChange={(event) => set('transmission')(event.target.value)}
            options={['automatic', 'manual'].map((value) => ({
              value,
              label: label('rentals.transmissions', value),
            }))}
          />
          {text('cityName', t('ground.city'))}
          {text('branchName', t('rentals.branch'))}
          {text('branchAddress', t('ground.address'))}
          {text('timeZone', t('ground.timeZone'))}
          {text('lat', t('ground.lat'), 'decimal')}
          {text('lng', t('ground.lng'), 'decimal')}
          {text('currency', t('common.currency'))}
          {text('daily', t('rentals.daily'), 'decimal')}
          {text('deposit', t('rentals.deposit'), 'decimal')}
        </FormGrid>
        <TextAreaField
          label={t('ground.policy')}
          hint={t('ground.policyHint')}
          value={fields.policy}
          onChange={(event) => set('policy')(event.target.value)}
        />
        {invalid ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {t('common.validation')}
          </p>
        ) : null}
        <ProblemAlert error={create.error} />
        <Button type="submit" loading={create.isPending}>
          {t('common.create')}
        </Button>
      </form>
    </FormDialog>
  );
}

function ReviewLicence({ reservation }: { reservation: Reservation }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [reason, setReason] = useState<RejectReason>('unreadable');
  const { toast } = useToast();
  const invalidate = useInvalidateRentals();
  const review = $api.useMutation(
    'post',
    '/v1/admin/rentals/reservations/{reservationId}/licence/review',
    {
      onSuccess: async () => {
        setOpen(false);
        toast({ title: t('rentals.licenceReviewed'), variant: 'success' });
        await invalidate();
      },
    },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    review.mutate({
      params: { path: { reservationId: reservation.id } },
      body: { decision, reason: decision === 'reject' ? reason : null },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('rentals.reviewLicence')}
      triggerAriaLabel={t('rentals.reviewFor', { reference: reservation.bookingReference })}
      title={t('rentals.reviewLicence')}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('rentals.decision')}
          name="decision"
          value={decision}
          onChange={(event) => setDecision(event.target.value as 'approve' | 'reject')}
          options={(['approve', 'reject'] as const).map((value) => ({
            value,
            label: label('rentals.decisions', value),
          }))}
        />
        {decision === 'reject' ? (
          <SelectField
            label={t('rentals.rejectReason')}
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as RejectReason)}
            options={REJECT_REASONS.map((value) => ({
              value,
              label: label('rentals.rejectReasons', value),
            }))}
          />
        ) : null}
        <ProblemAlert error={review.error} />
        <Button type="submit" loading={review.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function RecordHandover({ reservation }: { reservation: Reservation }) {
  const kind: 'check_out' | 'check_in' =
    reservation.status === 'reserved' ? 'check_out' : 'check_in';
  const [open, setOpen] = useState(false);
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState('8');
  const [damage, setDamage] = useState('');
  const [chauffeur, setChauffeur] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { toast } = useToast();
  const invalidate = useInvalidateRentals();
  const record = $api.useMutation(
    'post',
    '/v1/admin/rentals/reservations/{reservationId}/handovers',
    {
      onSuccess: async () => {
        setOpen(false);
        toast({ title: t('rentals.handoverSaved'), variant: 'success' });
        await invalidate();
      },
    },
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setUploadError(null);
    setUploading(true);
    const photoIds: string[] = [];
    try {
      // Photos first: each is scanned and sealed, then the handover attaches them.
      for (const file of files) {
        const { data, error } = await adminApi.POST(
          '/v1/admin/rentals/reservations/{reservationId}/photos',
          {
            params: { path: { reservationId: reservation.id } },
            body: file as unknown as string,
            bodySerializer: (body: unknown) => body as BodyInit,
            headers: { 'Content-Type': file.type },
          },
        );
        if (!data) {
          setUploadError(problemMessage(error));
          return;
        }
        photoIds.push(data.id);
      }
    } finally {
      setUploading(false);
    }
    record.mutate({
      params: { path: { reservationId: reservation.id } },
      body: {
        kind,
        odometerKm: Number(odometer),
        fuelEighths: Number(fuel),
        damageNotes: damage.trim() || null,
        photoIds,
        chauffeurDriverId:
          kind === 'check_out' && reservation.chauffeur ? chauffeur.trim() || null : null,
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('rentals.handover')}
      triggerAriaLabel={t('rentals.handoverFor', { reference: reservation.bookingReference })}
      title={`${label('rentals.handoverKinds', kind)} · ${reservation.bookingReference}`}
      open={open}
      onOpenChange={setOpen}
      testId={`handover-${reservation.bookingReference}`}
    >
      <form method="post" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('rentals.odometer')}
            inputMode="numeric"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
          />
          <SelectField
            label={t('rentals.fuel')}
            name="fuel"
            value={fuel}
            onChange={(event) => setFuel(event.target.value)}
            options={Array.from({ length: 9 }, (_, n) => ({ value: String(n), label: `${n}/8` }))}
          />
        </FormGrid>
        {kind === 'check_out' && reservation.chauffeur ? (
          <TextField
            label={t('rentals.chauffeurDriver')}
            value={chauffeur}
            onChange={(e) => setChauffeur(e.target.value)}
          />
        ) : null}
        <TextAreaField
          label={t('rentals.damage')}
          value={damage}
          maxLength={1000}
          onChange={(e) => setDamage(e.target.value)}
        />
        <label className="flex flex-col gap-1 font-body text-body-sm text-foreground">
          {t('rentals.photos')}
          <input
            type="file"
            multiple
            accept={PHOTO_TYPES.join(',')}
            data-testid="handover-photos"
            onChange={(event) =>
              setFiles(
                [...(event.target.files ?? [])].filter((file) => PHOTO_TYPES.includes(file.type)),
              )
            }
          />
        </label>
        {uploadError ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {uploadError}
          </p>
        ) : null}
        <ProblemAlert error={record.error} />
        <Button type="submit" loading={uploading || record.isPending} disabled={files.length === 0}>
          {t('rentals.handover')}
        </Button>
      </form>
    </FormDialog>
  );
}

function ReleaseDeposit({ reservation }: { reservation: Reservation }) {
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState('0');
  const [reason, setReason] = useState<KeptReason>('damage');
  const [invalid, setInvalid] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateRentals();
  const release = $api.useMutation(
    'post',
    '/v1/admin/rentals/reservations/{reservationId}/deposit',
    {
      onSuccess: async () => {
        setOpen(false);
        toast({ title: t('rentals.depositReleased'), variant: 'success' });
        await invalidate();
      },
    },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const keptMinor = minorFromInput(kept, reservation.deposit.currency) ?? 0;
    if (!Number.isFinite(keptMinor)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    release.mutate({
      params: { path: { reservationId: reservation.id } },
      body: { keptMinor, reason: keptMinor > 0 ? reason : null },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('rentals.releaseDeposit')}
      triggerAriaLabel={t('rentals.releaseFor', { reference: reservation.bookingReference })}
      title={`${t('rentals.releaseDeposit')} · ${format.money(reservation.deposit)}`}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('rentals.kept')}
          inputMode="decimal"
          value={kept}
          onChange={(e) => setKept(e.target.value)}
        />
        <SelectField
          label={t('rentals.keptReason')}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as KeptReason)}
          options={KEPT_REASONS.map((value) => ({
            value,
            label: label('rentals.keptReasons', value),
          }))}
        />
        {invalid ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {t('common.validation')}
          </p>
        ) : null}
        <ProblemAlert error={release.error} />
        <Button type="submit" loading={release.isPending}>
          {t('rentals.releaseDeposit')}
        </Button>
      </form>
    </FormDialog>
  );
}

function Reservations() {
  const { toast } = useToast();
  const [status, setStatus] = useState<RentalStatus | ''>('');
  const [licence, setLicence] = useState<LicenceStatus | ''>('');
  const query = $api.useQuery('get', '/v1/admin/rentals/reservations', {
    params: { query: { ...(status ? { status } : {}), ...(licence ? { licence } : {}) } },
  });
  const viewLicence = async (reservation: Reservation) => {
    const ok = await downloadFile(
      `/v1/admin/rentals/reservations/${reservation.id}/licence`,
      `licence-${reservation.bookingReference}`,
    );
    if (!ok) toast({ title: t('common.error'), variant: 'error' });
  };
  return (
    <Section title={t('rentals.reservations')}>
      <div className="grid max-w-dialog grid-cols-1 gap-4 md:grid-cols-2">
        <SelectField
          label={t('rentals.reservationStatus')}
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as RentalStatus | '')}
          options={[
            { value: '', label: t('common.all') },
            ...RENTAL_STATUSES.map((value) => ({
              value,
              label: label('rentals.reservationStatuses', value),
            })),
          ]}
        />
        <SelectField
          label={t('rentals.licenceStatus')}
          name="licence"
          value={licence}
          onChange={(event) => setLicence(event.target.value as LicenceStatus | '')}
          options={[
            { value: '', label: t('common.all') },
            ...LICENCE_STATUSES.map((value) => ({
              value,
              label: label('rentals.licenceStatuses', value),
            })),
          ]}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('rentals.reservations')}
            rows={data.reservations}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'booking',
                header: t('rentals.booking'),
                cell: (row) => (
                  <Link
                    href={`/bookings/${row.bookingId}` as Route}
                    className="font-bold text-primary underline focus-visible:focus-ring"
                  >
                    {row.bookingReference}
                  </Link>
                ),
              },
              {
                key: 'car',
                header: t('rentals.car'),
                cell: (row) => `${row.vehicle.make} ${row.vehicle.model} · ${row.vehicle.plate}`,
              },
              { key: 'renter', header: t('rentals.renter'), cell: (row) => row.renterName },
              {
                key: 'period',
                header: t('rentals.period'),
                cell: (row) =>
                  `${format.dateTime(row.pickupAt)} – ${format.dateTime(row.returnAt)}`,
              },
              {
                key: 'mode',
                header: t('rentals.chauffeur'),
                cell: (row) => (row.chauffeur ? t('rentals.chauffeur') : t('rentals.selfDrive')),
              },
              {
                key: 'licence',
                header: t('rentals.licenceStatus'),
                cell: (row) =>
                  row.licence ? (
                    <StatusBadge
                      tone={
                        row.licence.status === 'approved'
                          ? 'success'
                          : row.licence.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {label('rentals.licenceStatuses', row.licence.status)} ·{' '}
                      {row.licence.numberEndsWith}
                    </StatusBadge>
                  ) : row.licenceRequired ? (
                    label('rentals.licenceStatuses', 'pending_upload')
                  ) : (
                    t('common.none')
                  ),
              },
              {
                key: 'handovers',
                header: t('rentals.handovers'),
                cell: (row) => (
                  <ul className="flex flex-col gap-1">
                    {row.handovers.map((handover) => (
                      <li key={handover.id}>
                        {t('rentals.handoverLine', {
                          kind: label('rentals.handoverKinds', handover.kind),
                          km: handover.odometerKm,
                          fuel: handover.fuelEighths,
                        })}
                      </li>
                    ))}
                  </ul>
                ),
              },
              {
                key: 'status',
                header: t('rentals.reservationStatus'),
                cell: (row) => (
                  <span className="flex flex-col gap-1">
                    {label('rentals.reservationStatuses', row.status)}
                    {row.depositReleasedAt ? (
                      <span className="text-caption text-muted">
                        {t('rentals.depositDone', { date: format.dateTime(row.depositReleasedAt) })}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => (
                  <div className="flex flex-wrap gap-2">
                    {row.licence &&
                    row.licence.status !== 'pending_upload' &&
                    row.licence.status !== 'pending_scan' ? (
                      <Button variant="ghost" onClick={() => void viewLicence(row)}>
                        {t('rentals.viewLicence')}
                      </Button>
                    ) : null}
                    {row.licence?.status === 'pending_review' ? (
                      <ReviewLicence reservation={row} />
                    ) : null}
                    {row.status === 'reserved' || row.status === 'checked_out' ? (
                      <RecordHandover reservation={row} />
                    ) : null}
                    {row.status === 'returned' &&
                    !row.depositReleasedAt &&
                    row.deposit.amountMinor > 0 ? (
                      <ReleaseDeposit reservation={row} />
                    ) : null}
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

/** The rental desk (`ground:manage`, ADR-051). */
export function RentalsPage() {
  return (
    <RequirePermission permission="ground:manage">
      <PageHeader title={t('rentals.title')} intro={t('rentals.intro')} />
      <Reservations />
      <Fleet />
    </RequirePermission>
  );
}
