'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  CheckboxField,
  ConfirmAction,
  DataTable,
  DetailList,
  FormDialog,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
} from '../ui';

type DriverStatus = Schemas['AdminDrivers']['drivers'][number]['status'];
type Driver = Schemas['AdminDriver'];
type Reason = NonNullable<Driver['statusReason']>;

const STATUSES: readonly DriverStatus[] = ['pending', 'approved', 'rejected', 'suspended'];
const REASONS: readonly Reason[] = [
  'documents_unclear',
  'documents_expired',
  'identity_mismatch',
  'licence_invalid',
  'vehicle_unsuitable',
  'rating_below_minimum',
  'safety_concern',
  'fraud',
  'other',
];

const tone = (status: DriverStatus) =>
  status === 'approved'
    ? 'success'
    : status === 'pending'
      ? 'warning'
      : status === 'suspended'
        ? 'danger'
        : 'neutral';

const checkTone = (check: string) =>
  check === 'verified' ? 'success' : check === 'pending' ? 'warning' : 'danger';

function useInvalidateDriver(driverId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/drivers'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/drivers/{driverId}'] }),
    ]).then(() => driverId);
}

/** Driver applications and their review state (`drivers:review`, ADR-050). */
export function DriversPage() {
  const [status, setStatus] = useState<DriverStatus>('pending');
  const query = $api.useQuery('get', '/v1/admin/drivers', { params: { query: { status } } });
  return (
    <RequirePermission permission="drivers:review">
      <PageHeader title={t('drivers.title')} intro={t('drivers.intro')} />
      <div className="max-w-popover">
        <SelectField
          label={t('drivers.status')}
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value as DriverStatus)}
          options={STATUSES.map((value) => ({ value, label: label('drivers.statuses', value) }))}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('drivers.title')}
            rows={data.drivers}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'name',
                header: t('drivers.name'),
                cell: (row) => (
                  <Link
                    href={`/drivers/${row.id}` as Route}
                    aria-label={t('drivers.openFor', { name: row.name })}
                    className="font-bold text-primary underline focus-visible:focus-ring"
                  >
                    {row.name}
                  </Link>
                ),
              },
              { key: 'city', header: t('drivers.city'), cell: (row) => row.cityName },
              {
                key: 'identity',
                header: t('drivers.identity'),
                cell: (row) => (
                  <StatusBadge tone={checkTone(row.identityCheck)}>
                    {label('drivers.checks', row.identityCheck)}
                  </StatusBadge>
                ),
              },
              {
                key: 'licence',
                header: t('drivers.licence'),
                cell: (row) => (
                  <StatusBadge tone={checkTone(row.licenceCheck)}>
                    {label('drivers.checks', row.licenceCheck)}
                  </StatusBadge>
                ),
              },
              {
                key: 'awaiting',
                header: t('drivers.awaiting'),
                cell: (row) =>
                  t('drivers.awaitingCount', {
                    documents: row.documentsAwaitingReview,
                    vehicles: row.vehiclesAwaitingReview,
                  }),
              },
              {
                key: 'status',
                header: t('drivers.status'),
                cell: (row) => (
                  <StatusBadge tone={tone(row.status)}>
                    {label('drivers.statuses', row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: 'applied',
                header: t('drivers.applied'),
                cell: (row) => format.dateTime(row.createdAt),
              },
            ]}
          />
        )}
      </QueryState>
    </RequirePermission>
  );
}

function ReviewItem({
  driverId,
  kind,
  itemId,
  itemLabel,
}: {
  driverId: string;
  kind: 'document' | 'vehicle';
  itemId: string;
  itemLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [reason, setReason] = useState<Reason>('documents_unclear');
  const { toast } = useToast();
  const invalidate = useInvalidateDriver(driverId);
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('drivers.reviewed'), variant: 'success' });
    await invalidate();
  };
  const document = $api.useMutation(
    'post',
    '/v1/admin/drivers/{driverId}/documents/{documentId}/review',
    { onSuccess },
  );
  const vehicle = $api.useMutation(
    'post',
    '/v1/admin/drivers/{driverId}/vehicles/{vehicleId}/review',
    { onSuccess },
  );
  const mutation = kind === 'document' ? document : vehicle;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = { decision, reason: decision === 'reject' ? reason : null };
    if (kind === 'document')
      document.mutate({ params: { path: { driverId, documentId: itemId } }, body });
    else vehicle.mutate({ params: { path: { driverId, vehicleId: itemId } }, body });
  };
  return (
    <FormDialog
      triggerLabel={t('drivers.approveItem')}
      triggerAriaLabel={`${t('drivers.approveItem')} / ${t('drivers.rejectItem')}: ${itemLabel}`}
      title={itemLabel}
      open={open}
      onOpenChange={setOpen}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('drivers.status')}
          name="decision"
          value={decision}
          onChange={(event) => setDecision(event.target.value as 'approve' | 'reject')}
          options={[
            { value: 'approve', label: t('drivers.approveItem') },
            { value: 'reject', label: t('drivers.rejectItem') },
          ]}
        />
        {decision === 'reject' ? (
          <SelectField
            label={t('drivers.reason')}
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as Reason)}
            options={REASONS.map((value) => ({ value, label: label('drivers.reasons', value) }))}
          />
        ) : null}
        <ProblemAlert error={mutation.error} />
        <Button type="submit" loading={mutation.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function ApproveDriver({ driver }: { driver: Driver }) {
  const [open, setOpen] = useState(false);
  const [manualIdentity, setManualIdentity] = useState(false);
  const [manualLicence, setManualLicence] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateDriver(driver.id);
  const approve = $api.useMutation('post', '/v1/admin/drivers/{driverId}/approve', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('drivers.approved'), variant: 'success' });
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    approve.mutate({
      params: { path: { driverId: driver.id } },
      body: { manualIdentityCheck: manualIdentity, manualLicenceCheck: manualLicence },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('drivers.approve')}
      triggerVariant="primary"
      title={t('drivers.approve')}
      description={t('drivers.approveQuestion')}
      open={open}
      onOpenChange={setOpen}
      testId="approve-driver"
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        {driver.identityCheck === 'pending' ? (
          <CheckboxField
            label={t('drivers.manualIdentity')}
            checked={manualIdentity}
            onChange={(event) => setManualIdentity(event.target.checked)}
          />
        ) : null}
        {driver.licenceCheck === 'pending' ? (
          <CheckboxField
            label={t('drivers.manualLicence')}
            checked={manualLicence}
            onChange={(event) => setManualLicence(event.target.checked)}
          />
        ) : null}
        <ProblemAlert error={approve.error} />
        <Button type="submit" loading={approve.isPending}>
          {t('drivers.approve')}
        </Button>
      </form>
    </FormDialog>
  );
}

function ReasonAction({ driver, action }: { driver: Driver; action: 'reject' | 'suspend' }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>('documents_unclear');
  const { toast } = useToast();
  const invalidate = useInvalidateDriver(driver.id);
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('drivers.done'), variant: 'success' });
    await invalidate();
  };
  const reject = $api.useMutation('post', '/v1/admin/drivers/{driverId}/reject', { onSuccess });
  const suspend = $api.useMutation('post', '/v1/admin/drivers/{driverId}/suspend', { onSuccess });
  const mutation = action === 'reject' ? reject : suspend;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const request = { params: { path: { driverId: driver.id } }, body: { reason } };
    if (action === 'reject') reject.mutate(request);
    else suspend.mutate(request);
  };
  const title = action === 'reject' ? t('drivers.reject') : t('drivers.suspend');
  return (
    <FormDialog triggerLabel={title} title={title} open={open} onOpenChange={setOpen}>
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('drivers.reason')}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as Reason)}
          options={REASONS.map((value) => ({ value, label: label('drivers.reasons', value) }))}
        />
        <ProblemAlert error={mutation.error} />
        <Button type="submit" loading={mutation.isPending}>
          {title}
        </Button>
      </form>
    </FormDialog>
  );
}

function ReinstateDriver({ driver }: { driver: Driver }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const invalidate = useInvalidateDriver(driver.id);
  const reinstate = $api.useMutation('post', '/v1/admin/drivers/{driverId}/reinstate', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('drivers.done'), variant: 'success' });
      await invalidate();
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('drivers.reinstate')}
      question={t('drivers.reinstateQuestion')}
      onConfirm={() => reinstate.mutate({ params: { path: { driverId: driver.id } } })}
      pending={reinstate.isPending}
      error={reinstate.error}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

function DriverBody({ driver }: { driver: Driver }) {
  const { can } = useStaffSession();
  const { toast } = useToast();
  const canReview = can('drivers:review');
  const download = async (documentId: string, kind: string) => {
    const ok = await downloadFile(
      `/v1/admin/drivers/${driver.id}/documents/${documentId}/content`,
      `${kind}-${documentId.slice(0, 8)}`,
    );
    if (!ok) toast({ title: t('common.error'), variant: 'error' });
  };
  return (
    <>
      <PageHeader
        title={`${driver.givenNames} ${driver.surname}`}
        intro={label('drivers.statuses', driver.status)}
        actions={
          canReview ? (
            <>
              {driver.status === 'pending' ? <ApproveDriver driver={driver} /> : null}
              {driver.status === 'pending' ? (
                <ReasonAction driver={driver} action="reject" />
              ) : null}
              {driver.status === 'approved' ? (
                <ReasonAction driver={driver} action="suspend" />
              ) : null}
              {driver.status === 'suspended' ? <ReinstateDriver driver={driver} /> : null}
            </>
          ) : null
        }
      />
      <Section title={t('drivers.details')}>
        <DetailList
          items={[
            { term: t('drivers.city'), value: driver.cityName },
            { term: t('drivers.dateOfBirth'), value: format.date(driver.dateOfBirth, 'medium') },
            {
              term: t('drivers.identity'),
              value: label('drivers.checks', driver.identityCheck),
            },
            {
              term: t('drivers.licence'),
              value: `${label('drivers.checks', driver.licenceCheck)} · ${t('drivers.licenceEnds', {
                hint: driver.licenceEndsWith,
                date: format.date(driver.licenceExpiresOn, 'medium'),
              })}`,
            },
            {
              term: t('drivers.rating'),
              value:
                driver.rating === null
                  ? t('drivers.noRating')
                  : `${driver.rating.toFixed(1)} (${driver.ratingCount})`,
            },
            {
              term: t('drivers.payout'),
              value: driver.payoutAccount
                ? t('drivers.payoutValue', {
                    name: driver.payoutAccount.accountName,
                    bank: driver.payoutAccount.bankCode,
                    hint: driver.payoutAccount.accountEndsWith,
                  })
                : t('drivers.noPayout'),
            },
            {
              term: t('drivers.missing'),
              value:
                driver.missing.length === 0
                  ? t('common.none')
                  : driver.missing.map((item) => label('drivers.missingItems', item)).join(', '),
            },
            {
              term: t('drivers.status'),
              value: driver.statusReason
                ? `${label('drivers.statuses', driver.status)} (${label('drivers.reasons', driver.statusReason)})`
                : label('drivers.statuses', driver.status),
            },
          ]}
        />
      </Section>
      <Section title={t('drivers.documents')}>
        <DataTable
          caption={t('drivers.documents')}
          rows={driver.documents}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'kind',
              header: t('drivers.documents'),
              cell: (row) => label('drivers.documentKinds', row.kind),
            },
            {
              key: 'status',
              header: t('drivers.status'),
              cell: (row) => (
                <StatusBadge
                  tone={
                    row.status === 'approved'
                      ? 'success'
                      : row.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {label('drivers.documentStatuses', row.status)}
                  {row.rejectionReason ? ` (${label('drivers.reasons', row.rejectionReason)})` : ''}
                </StatusBadge>
              ),
            },
            {
              key: 'uploaded',
              header: t('drivers.applied'),
              cell: (row) => format.dateTime(row.createdAt),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              cell: (row) => (
                <div className="flex flex-wrap gap-2">
                  {row.status !== 'pending' ? (
                    <Button
                      variant="ghost"
                      aria-label={t('drivers.downloadFor', {
                        kind: label('drivers.documentKinds', row.kind),
                      })}
                      onClick={() => void download(row.id, row.kind)}
                    >
                      {t('drivers.download')}
                    </Button>
                  ) : null}
                  {canReview && row.status === 'clean' ? (
                    <ReviewItem
                      driverId={driver.id}
                      kind="document"
                      itemId={row.id}
                      itemLabel={label('drivers.documentKinds', row.kind)}
                    />
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </Section>
      <Section title={t('drivers.vehicles')}>
        <DataTable
          caption={t('drivers.vehicles')}
          rows={driver.vehicles}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'vehicle',
              header: t('drivers.vehicles'),
              cell: (row) =>
                t('drivers.vehicle', {
                  colour: row.colour,
                  make: row.make,
                  model: row.model,
                  year: String(row.year),
                  plate: row.plate,
                }),
            },
            {
              key: 'status',
              header: t('drivers.status'),
              cell: (row) => label('drivers.vehicleStatuses', row.status),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              cell: (row) =>
                canReview && row.status === 'pending' ? (
                  <ReviewItem
                    driverId={driver.id}
                    kind="vehicle"
                    itemId={row.id}
                    itemLabel={`${row.make} ${row.model} ${row.plate}`}
                  />
                ) : null,
            },
          ]}
        />
      </Section>
    </>
  );
}

export function DriverDetailPage({ driverId }: { driverId: string }) {
  const query = $api.useQuery('get', '/v1/admin/drivers/{driverId}', {
    params: { path: { driverId } },
  });
  return (
    <RequirePermission permission="drivers:review">
      <div>
        <Link
          href="/drivers"
          className="font-body text-body-sm text-primary underline focus-visible:focus-ring"
        >
          {t('drivers.back')}
        </Link>
      </div>
      <QueryState query={query}>{(driver) => <DriverBody driver={driver} />}</QueryState>
    </RequirePermission>
  );
}
