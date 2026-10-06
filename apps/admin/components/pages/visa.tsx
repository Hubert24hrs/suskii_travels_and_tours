'use client';

import { VISA_APPLICATION_STATUSES, VISA_PURPOSES, VISA_REQUIREMENTS } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { $api, problemMessage, type Schemas } from '../../lib/api';
import { publicEnv } from '../../lib/env';
import { fieldIssues, nullable } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import {
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

type Status = (typeof VISA_APPLICATION_STATUSES)[number];
type Application = Schemas['OfficerVisaApplication'];
type Rule = Schemas['VisaRule'];

function tone(status: Status): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (status === 'approved') return 'success';
  if (status === 'refused' || status === 'withdrawn') return 'danger';
  if (status === 'submitted' || status === 'in_review' || status === 'action_required')
    return 'warning';
  return 'info';
}

const statusBadge = (status: Status) => (
  <StatusBadge tone={tone(status)}>{label('visa.statuses', status)}</StatusBadge>
);

function Applications() {
  const params = useSearchParams();
  const initial = params.get('status');
  const [status, setStatus] = useState<Status | ''>(
    initial && (VISA_APPLICATION_STATUSES as readonly string[]).includes(initial)
      ? (initial as Status)
      : 'submitted',
  );
  const query = $api.useQuery('get', '/v1/admin/visa-applications', {
    params: { query: { ...(status ? { status } : {}), limit: 100 } },
  });
  return (
    <Section title={t('visa.applications')}>
      <div className="max-w-popover">
        <SelectField
          label={t('visa.status')}
          name="status"
          value={status}
          options={[
            { value: '', label: t('common.all') },
            ...VISA_APPLICATION_STATUSES.map((value) => ({
              value,
              label: label('visa.statuses', value),
            })),
          ]}
          onChange={(event) => setStatus(event.target.value as Status | '')}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('visa.title')}
            rows={data.applications}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'applicant',
                header: t('visa.applicant'),
                cell: (row) => (
                  <Link
                    href={`/visa/${row.id}` as Route}
                    aria-label={t('visa.open', { name: row.applicantName })}
                    className="font-bold text-primary underline focus-visible:focus-ring"
                  >
                    {row.applicantName}
                  </Link>
                ),
              },
              { key: 'booking', header: t('refunds.booking'), cell: (row) => row.bookingReference },
              {
                key: 'destination',
                header: t('visa.destination'),
                cell: (row) =>
                  `${format.country(row.destination)} · ${label('catalog.purposesList', row.purpose)}`,
              },
              {
                key: 'travel',
                header: t('visa.verifiedAt'),
                cell: (row) => format.date(row.travelDate, 'medium'),
              },
              { key: 'status', header: t('visa.status'), cell: (row) => statusBadge(row.status) },
              {
                key: 'submitted',
                header: t('visa.submitted'),
                cell: (row) =>
                  row.submittedAt ? format.dateTime(row.submittedAt) : t('common.none'),
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function RuleDialog({ rule }: { rule: Rule | null }) {
  const blank = {
    nationality: rule?.nationality ?? '',
    destination: rule?.destination ?? '',
    purpose: rule?.purpose ?? 'tourism',
    requirement: rule?.requirement ?? 'visa_required',
    maxStayDays: rule?.maxStayDays === null || !rule ? '' : String(rule.maxStayDays),
    notes: rule?.notes ?? '',
    verifiedAt: rule?.verifiedAt ?? '',
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const save = $api.useMutation('put', '/v1/admin/visa-rules', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('common.saved'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/visa-rules'] });
    },
  });
  const issues = fieldIssues(save.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      body: {
        nationality: form.nationality.trim().toUpperCase(),
        destination: form.destination.trim().toUpperCase(),
        purpose: form.purpose,
        requirement: form.requirement,
        maxStayDays: form.maxStayDays ? Number(form.maxStayDays) : null,
        notes: nullable(form.notes),
        verifiedAt: form.verifiedAt || null,
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={rule ? t('common.edit') : t('visa.newRule')}
      triggerVariant={rule ? 'ghost' : 'primary'}
      title={rule ? t('visa.editRule') : t('visa.newRule')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank);
          save.reset();
        }
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('visa.nationality')}
            name="nationality"
            maxLength={2}
            value={form.nationality}
            required
            readOnly={Boolean(rule)}
            error={issues.nationality}
            onChange={(event) => setForm({ ...form, nationality: event.target.value })}
          />
          <TextField
            label={t('visa.destination')}
            name="destination"
            maxLength={2}
            value={form.destination}
            required
            readOnly={Boolean(rule)}
            error={issues.destination}
            onChange={(event) => setForm({ ...form, destination: event.target.value })}
          />
          <SelectField
            label={t('visa.purpose')}
            name="purpose"
            value={form.purpose}
            disabled={Boolean(rule)}
            options={VISA_PURPOSES.map((value) => ({
              value,
              label: label('catalog.purposesList', value),
            }))}
            onChange={(event) =>
              setForm({ ...form, purpose: event.target.value as Rule['purpose'] })
            }
          />
          <SelectField
            label={t('visa.requirement')}
            name="requirement"
            value={form.requirement}
            options={VISA_REQUIREMENTS.map((value) => ({
              value,
              label: label('visa.requirements', value),
            }))}
            onChange={(event) =>
              setForm({ ...form, requirement: event.target.value as Rule['requirement'] })
            }
          />
          <TextField
            label={t('form.optional', { label: 'Max stay (days)' })}
            name="maxStayDays"
            type="number"
            min={1}
            value={form.maxStayDays}
            onChange={(event) => setForm({ ...form, maxStayDays: event.target.value })}
          />
          <TextField
            label={t('visa.verifiedAt')}
            name="verifiedAt"
            type="date"
            value={form.verifiedAt}
            onChange={(event) => setForm({ ...form, verifiedAt: event.target.value })}
          />
        </FormGrid>
        <TextAreaField
          label={t('visa.notes')}
          name="notes"
          value={form.notes}
          rows={3}
          maxLength={1000}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
        <ProblemAlert error={save.error} />
        <Button type="submit" loading={save.isPending}>
          {t('visa.saveRule')}
        </Button>
      </form>
    </FormDialog>
  );
}

function DeleteRule({ rule }: { rule: Rule }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const remove = $api.useMutation('delete', '/v1/admin/visa-rules/{ruleId}', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('visa.ruleDeleted'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/visa-rules'] });
    },
  });
  const name = t('visa.deleteRule', {
    nationality: format.country(rule.nationality),
    destination: format.country(rule.destination),
  });
  return (
    <ConfirmAction
      triggerLabel={t('common.delete')}
      triggerAriaLabel={name}
      title={name}
      question={t('visa.confirmDeleteRule')}
      onConfirm={() => remove.mutate({ params: { path: { ruleId: rule.id } } })}
      pending={remove.isPending}
      error={remove.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) remove.reset();
      }}
    />
  );
}

function Rules() {
  const query = $api.useQuery('get', '/v1/admin/visa-rules', { params: { query: {} } });
  return (
    <Section
      title={t('visa.rules')}
      intro={t('visa.rulesIntro')}
      actions={<RuleDialog rule={null} />}
    >
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('visa.rules')}
            rows={data.rules}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'nationality',
                header: t('visa.nationality'),
                cell: (row) => format.country(row.nationality),
              },
              {
                key: 'destination',
                header: t('visa.destination'),
                cell: (row) => format.country(row.destination),
              },
              {
                key: 'purpose',
                header: t('visa.purpose'),
                cell: (row) => label('catalog.purposesList', row.purpose),
              },
              {
                key: 'requirement',
                header: t('visa.requirement'),
                cell: (row) => label('visa.requirements', row.requirement),
              },
              {
                key: 'verified',
                header: t('visa.verifiedAt'),
                cell: (row) =>
                  row.verifiedAt ? format.date(row.verifiedAt, 'medium') : t('common.none'),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => (
                  <div className="flex flex-wrap gap-2">
                    <RuleDialog rule={row} />
                    <DeleteRule rule={row} />
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

export function VisaPage() {
  return (
    <RequirePermission permission="visa:process">
      <PageHeader title={t('visa.title')} intro={t('visa.intro')} />
      <Applications />
      <Rules />
    </RequirePermission>
  );
}

// ---------------------------------------------------------------------------
// One application
// ---------------------------------------------------------------------------

function useInvalidateApplication() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['get', '/v1/admin/visa-applications/{applicationId}'],
      }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/visa-applications'] }),
    ]);
}

function TransitionForm({ application }: { application: Application }) {
  const [to, setTo] = useState<Status | ''>(application.allowedTransitions[0] ?? '');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const { toast } = useToast();
  const invalidate = useInvalidateApplication();
  const move = $api.useMutation('post', '/v1/admin/visa-applications/{applicationId}/transitions', {
    onSuccess: async () => {
      toast({ title: t('visa.detail.moved'), variant: 'success' });
      setMessage('');
      setNote('');
      await invalidate();
    },
  });
  if (application.allowedTransitions.length === 0) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!to) return;
    move.mutate({
      params: { path: { applicationId: application.id } },
      body: { to, message: nullable(message), note: nullable(note) },
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <SelectField
        label={t('visa.detail.transition')}
        name="to"
        value={to}
        options={application.allowedTransitions.map((value) => ({
          value,
          label: label('visa.statuses', value),
        }))}
        onChange={(event) => setTo(event.target.value as Status)}
      />
      <TextAreaField
        label={t('visa.detail.message')}
        name="message"
        value={message}
        rows={2}
        maxLength={2000}
        onChange={(event) => setMessage(event.target.value)}
      />
      <TextAreaField
        label={t('visa.detail.internalNote')}
        name="note"
        value={note}
        rows={2}
        maxLength={2000}
        onChange={(event) => setNote(event.target.value)}
      />
      <ProblemAlert error={move.error} />
      <div>
        <Button type="submit" loading={move.isPending}>
          {t('visa.detail.submitTransition')}
        </Button>
      </div>
    </form>
  );
}

function CommentForm({ application }: { application: Application }) {
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const { toast } = useToast();
  const invalidate = useInvalidateApplication();
  const comment = $api.useMutation('post', '/v1/admin/visa-applications/{applicationId}/comments', {
    onSuccess: async () => {
      toast({ title: t('visa.detail.sent'), variant: 'success' });
      setMessage('');
      setNote('');
      await invalidate();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        comment.mutate({
          params: { path: { applicationId: application.id } },
          body: { message: nullable(message), note: nullable(note) },
        });
      }}
      className="flex flex-col gap-3"
      aria-label={t('visa.detail.comment')}
    >
      <TextAreaField
        label={t('visa.detail.message')}
        name="commentMessage"
        value={message}
        rows={2}
        maxLength={2000}
        onChange={(event) => setMessage(event.target.value)}
      />
      <TextAreaField
        label={t('visa.detail.internalNote')}
        name="commentNote"
        value={note}
        rows={2}
        maxLength={2000}
        onChange={(event) => setNote(event.target.value)}
      />
      <ProblemAlert error={comment.error} />
      <div>
        <Button
          type="submit"
          variant="ghost"
          loading={comment.isPending}
          disabled={!message.trim() && !note.trim()}
        >
          {t('visa.detail.sendComment')}
        </Button>
      </div>
    </form>
  );
}

function RejectDocument({
  documentId,
  documentLabel,
}: {
  documentId: string;
  documentLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const invalidate = useInvalidateApplication();
  const reject = $api.useMutation('post', '/v1/admin/visa-documents/{documentId}/reject', {
    onSuccess: async () => {
      setOpen(false);
      await invalidate();
    },
  });
  const text = t('visa.detail.rejectDocument', { label: documentLabel });
  return (
    <FormDialog triggerLabel={text} title={text} open={open} onOpenChange={setOpen}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          reject.mutate({ params: { path: { documentId } }, body: { message } });
        }}
        className="flex flex-col gap-4"
      >
        <TextAreaField
          label={t('visa.detail.rejectMessage')}
          name="rejectMessage"
          value={message}
          required
          rows={3}
          maxLength={2000}
          onChange={(event) => setMessage(event.target.value)}
        />
        <ProblemAlert error={reject.error} />
        <Button type="submit" loading={reject.isPending}>
          {text}
        </Button>
      </form>
    </FormDialog>
  );
}

function OpenDocument({
  documentId,
  documentLabel,
}: {
  documentId: string;
  documentLabel: string;
}) {
  const { toast } = useToast();
  const link = $api.useMutation('post', '/v1/admin/visa-documents/{documentId}/link', {
    onSuccess: (data) => {
      // Signed and short-lived; it opens the decrypted file from the API in a new tab.
      window.open(`${publicEnv.apiBaseUrl}${data.url}`, '_blank', 'noopener,noreferrer');
      toast({ title: t('visa.detail.linkOpened'), variant: 'info' });
    },
    onError: (error) => toast({ title: problemMessage(error), variant: 'error' }),
  });
  return (
    <Button
      variant="ghost"
      loading={link.isPending}
      onClick={() => link.mutate({ params: { path: { documentId } } })}
    >
      {t('visa.detail.view', { label: documentLabel })}
    </Button>
  );
}

function ApplicationBody({ application }: { application: Application }) {
  return (
    <>
      <PageHeader title={t('visa.detail.title', { name: application.applicantName })} />
      <Section title={t('visa.detail.booking', { reference: application.bookingReference })}>
        <DetailList
          items={[
            { term: t('visa.status'), value: statusBadge(application.status) },
            { term: t('visa.destination'), value: format.country(application.destination) },
            { term: t('visa.purpose'), value: label('catalog.purposesList', application.purpose) },
            { term: t('visa.nationality'), value: format.country(application.nationality) },
            {
              term: t('visa.detail.passport'),
              value: application.passport
                ? t('visa.detail.passportSummary', {
                    country: format.country(application.passport.issuingCountry),
                    last: application.passport.hint,
                    expiry: format.date(application.passport.expiryDate, 'medium'),
                  })
                : t('common.none'),
            },
            {
              term: t('visa.submitted'),
              value: application.submittedAt
                ? format.dateTime(application.submittedAt)
                : t('common.none'),
            },
          ]}
        />
      </Section>
      <Section title={t('visa.detail.checklist')}>
        <ul className="flex flex-col gap-3">
          {application.checklist.map((item) => (
            <li
              key={item.key}
              className="flex flex-col gap-2 border-b border-border pb-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-1">
                <span className="font-body text-body-sm font-bold text-foreground">
                  {item.label}
                </span>
                <span className="font-body text-caption text-muted">
                  {item.document
                    ? `${label('visa.detail.documentStatuses', item.document.status)} · ${item.document.fileName}`
                    : t('visa.detail.missing')}
                </span>
              </div>
              {item.document?.status === 'clean' ? (
                <div className="flex flex-wrap gap-2">
                  <OpenDocument documentId={item.document.id} documentLabel={item.label} />
                  <RejectDocument documentId={item.document.id} documentLabel={item.label} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t('visa.detail.transition')}>
        <TransitionForm application={application} />
      </Section>
      <Section title={t('visa.detail.comment')}>
        <CommentForm application={application} />
      </Section>
      <Section title={t('visa.detail.timeline')}>
        <DataTable
          caption={t('visa.detail.timeline')}
          rows={application.events}
          rowKey={(row) => `${row.occurredAt}-${row.kind}`}
          columns={[
            {
              key: 'when',
              header: t('bookings.detail.when'),
              cell: (row) => format.dateTime(row.occurredAt),
            },
            {
              key: 'status',
              header: t('visa.status'),
              cell: (row) => (row.toStatus ? label('visa.statuses', row.toStatus) : row.kind),
            },
            {
              key: 'message',
              header: t('visa.detail.message'),
              cell: (row) => row.message ?? t('common.none'),
            },
            {
              key: 'note',
              header: t('visa.detail.internalNote'),
              cell: (row) => row.note ?? t('common.none'),
            },
            {
              key: 'actor',
              header: t('bookings.detail.actor'),
              cell: (row) => label('actors', row.actorType),
            },
          ]}
        />
      </Section>
    </>
  );
}

export function VisaApplicationPage({ applicationId }: { applicationId: string }) {
  const query = $api.useQuery('get', '/v1/admin/visa-applications/{applicationId}', {
    params: { path: { applicationId } },
  });
  return (
    <RequirePermission permission="visa:process">
      <div>
        <Link
          href="/visa"
          className="font-body text-body-sm text-primary underline focus-visible:focus-ring"
        >
          {t('common.back')}
        </Link>
      </div>
      <QueryState query={query}>
        {(application) => <ApplicationBody application={application} />}
      </QueryState>
    </RequirePermission>
  );
}
