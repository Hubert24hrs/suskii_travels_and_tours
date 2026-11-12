'use client';

import {
  BREACH_DATA_CATEGORIES,
  PRIVACY_JURISDICTIONS,
  PRIVACY_REFUSAL_REASONS,
  PRIVACY_REQUEST_CHANNELS,
  PRIVACY_REQUEST_KINDS,
  type BreachDataCategory,
  type PrivacyJurisdiction,
  type PrivacyRefusalReason,
  type PrivacyRequestChannel,
  type PrivacyRequestKind,
} from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import { fieldIssues, isoFromLocalInput, localInputFromIso, nullable } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
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
  TextAreaField,
  TextField,
} from '../ui';

type PrivacyRequest = Schemas['PrivacyRequest'];
type Breach = Schemas['PrivacyBreach'];
type Notice = Schemas['PrivacyBreachNotice'];
type Filter = 'open' | 'closed';

const REQUESTS = '/v1/admin/privacy/requests';
const BREACHES = '/v1/admin/privacy/breaches';
const STAFF_CHANNELS = PRIVACY_REQUEST_CHANNELS.filter((channel) => channel !== 'self_service');

const useRefresh = (path: string) => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['get', path] });
};

/** Checkboxes for a list of enum values, kept in the order the list declares. */
function ChoiceList<T extends string>({
  legend,
  name,
  options,
  value,
  labelOf,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: readonly T[];
  labelOf: (option: T) => string;
  onChange: (next: T[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-body text-body-sm font-medium text-foreground">{legend}</legend>
      {options.map((option) => (
        <CheckboxField
          key={option}
          label={labelOf(option)}
          name={name}
          value={option}
          checked={value.includes(option)}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? options.filter((o) => o === option || value.includes(o))
                : value.filter((o) => o !== option),
            )
          }
        />
      ))}
      {error ? <span className="font-body text-caption text-danger">{error}</span> : null}
    </fieldset>
  );
}

const nowInput = () => localInputFromIso(new Date().toISOString());

interface RequestForm {
  kind: PrivacyRequestKind;
  jurisdiction: PrivacyJurisdiction;
  channel: Exclude<PrivacyRequestChannel, 'self_service'>;
  receivedAt: string;
  userId: string;
  subjectEmail: string;
}

function RecordRequestDialog() {
  const blank = (): RequestForm => ({
    kind: 'access',
    jurisdiction: 'NG',
    channel: 'email',
    receivedAt: nowInput(),
    userId: '',
    subjectEmail: '',
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RequestForm>(blank);
  const { toast } = useToast();
  const refresh = useRefresh(REQUESTS);
  const create = $api.useMutation('post', REQUESTS, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('privacy.recorded'), variant: 'success' });
      await refresh();
    },
  });
  const errors = fieldIssues(create.error);
  const set = <K extends keyof RequestForm>(key: K, value: RequestForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      body: {
        kind: form.kind,
        jurisdiction: form.jurisdiction,
        channel: form.channel,
        receivedAt: isoFromLocalInput(form.receivedAt) ?? '',
        userId: nullable(form.userId),
        subjectEmail: nullable(form.subjectEmail),
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('privacy.record')}
      triggerVariant="primary"
      title={t('privacy.record')}
      description={t('privacy.recordIntro')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank());
          create.reset();
        }
      }}
      testId="record-request"
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <SelectField
            label={t('privacy.kind')}
            name="kind"
            value={form.kind}
            options={PRIVACY_REQUEST_KINDS.map((value) => ({
              value,
              label: label('privacy.kinds', value),
            }))}
            onChange={(event) => set('kind', event.target.value as PrivacyRequestKind)}
          />
          <SelectField
            label={t('privacy.jurisdiction')}
            name="jurisdiction"
            value={form.jurisdiction}
            options={PRIVACY_JURISDICTIONS.map((value) => ({
              value,
              label: label('privacy.jurisdictions', value),
            }))}
            onChange={(event) => set('jurisdiction', event.target.value as PrivacyJurisdiction)}
          />
          <SelectField
            label={t('privacy.channel')}
            name="channel"
            value={form.channel}
            options={STAFF_CHANNELS.map((value) => ({
              value,
              label: label('privacy.channels', value),
            }))}
            onChange={(event) => set('channel', event.target.value as RequestForm['channel'])}
          />
          <TextField
            label={t('privacy.receivedAt')}
            name="receivedAt"
            type="datetime-local"
            value={form.receivedAt}
            required
            error={errors.receivedAt}
            onChange={(event) => set('receivedAt', event.target.value)}
          />
        </FormGrid>
        <TextField
          label={t('form.optional', { label: t('privacy.email') })}
          hint={t('privacy.emailHint')}
          name="subjectEmail"
          type="email"
          autoComplete="off"
          value={form.subjectEmail}
          error={errors.subjectEmail}
          onChange={(event) => set('subjectEmail', event.target.value)}
        />
        <TextField
          label={t('form.optional', { label: t('privacy.accountId') })}
          hint={t('privacy.accountIdHint')}
          name="userId"
          autoComplete="off"
          value={form.userId}
          error={errors.userId}
          onChange={(event) => set('userId', event.target.value)}
        />
        <ProblemAlert error={create.error} />
        <Button type="submit" loading={create.isPending}>
          {t('privacy.record')}
        </Button>
      </form>
    </FormDialog>
  );
}

function CompleteRequest({ request }: { request: PrivacyRequest }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh(REQUESTS);
  const close = $api.useMutation('post', `${REQUESTS}/{id}/close`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('privacy.completed'), variant: 'success' });
      await refresh();
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('privacy.complete')}
      triggerAriaLabel={t('privacy.completeLabel', { kind: label('privacy.kinds', request.kind) })}
      question={t('privacy.completeQuestion')}
      onConfirm={() =>
        close.mutate({ params: { path: { id: request.id } }, body: { outcome: 'completed' } })
      }
      pending={close.isPending}
      error={close.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) close.reset();
      }}
    />
  );
}

function RefuseRequest({ request }: { request: PrivacyRequest }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PrivacyRefusalReason>('identity_not_verified');
  const { toast } = useToast();
  const refresh = useRefresh(REQUESTS);
  const close = $api.useMutation('post', `${REQUESTS}/{id}/close`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('privacy.refused'), variant: 'success' });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    close.mutate({ params: { path: { id: request.id } }, body: { outcome: 'refused', reason } });
  };
  return (
    <FormDialog
      triggerLabel={t('privacy.refuse')}
      triggerAriaLabel={t('privacy.refuseLabel', { kind: label('privacy.kinds', request.kind) })}
      title={t('privacy.refuseTitle')}
      description={t('privacy.refuseIntro')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setReason('identity_not_verified');
          close.reset();
        }
      }}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('privacy.reason')}
          name="reason"
          value={reason}
          options={PRIVACY_REFUSAL_REASONS.map((value) => ({
            value,
            label: label('privacy.refusalReasons', value),
          }))}
          onChange={(event) => setReason(event.target.value as PrivacyRefusalReason)}
        />
        <ProblemAlert error={close.error} />
        <Button type="submit" loading={close.isPending}>
          {t('privacy.refuse')}
        </Button>
      </form>
    </FormDialog>
  );
}

function statusTone(status: PrivacyRequest['status']) {
  if (status === 'open') return 'info' as const;
  return status === 'completed' ? ('success' as const) : ('neutral' as const);
}

function RequestsSection() {
  const [filter, setFilter] = useState<Filter>('open');
  const pages = useCursorPages(['get', REQUESTS, filter], async (cursor) =>
    unwrap(
      await adminApi.GET(REQUESTS, {
        params: { query: { limit: 25, status: filter, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  return (
    <Section
      title={t('privacy.requests')}
      intro={t('privacy.requestsIntro')}
      actions={<RecordRequestDialog />}
    >
      <div className="max-w-popover">
        <SelectField
          label={t('privacy.filter')}
          name="status"
          value={filter}
          options={(['open', 'closed'] as const).map((value) => ({
            value,
            label: label('privacy.filters', value),
          }))}
          onChange={(event) => setFilter(event.target.value as Filter)}
        />
      </div>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) => (
          <div className="flex flex-col gap-4">
            <DataTable
              caption={t('privacy.requests')}
              empty={t('privacy.noRequests')}
              rows={items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'kind',
                  header: t('privacy.kind'),
                  cell: (row) => label('privacy.kinds', row.kind),
                },
                {
                  key: 'law',
                  header: t('privacy.jurisdiction'),
                  cell: (row) => label('privacy.jurisdictions', row.jurisdiction),
                },
                {
                  key: 'channel',
                  header: t('privacy.channel'),
                  cell: (row) => label('privacy.channels', row.channel),
                },
                {
                  key: 'person',
                  header: t('privacy.person'),
                  cell: (row) =>
                    row.subjectEmail ??
                    (row.userId ? t('privacy.account', { id: row.userId }) : t('common.none')),
                },
                {
                  key: 'received',
                  header: t('privacy.received'),
                  cell: (row) => format.dateTime(row.receivedAt),
                },
                {
                  key: 'due',
                  header: t('privacy.due'),
                  cell: (row) => (
                    <div className="flex flex-col gap-1">
                      <span>{format.dateTime(row.dueAt)}</span>
                      <span className="text-caption text-muted" title={row.source}>
                        {row.statutory ? t('privacy.statutory') : t('privacy.internal')}
                      </span>
                      {row.overdue ? (
                        <StatusBadge tone="danger">{t('privacy.overdue')}</StatusBadge>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: t('common.status'),
                  cell: (row) => (
                    <div className="flex flex-col gap-1">
                      <StatusBadge tone={statusTone(row.status)}>
                        {label('privacy.statuses', row.status)}
                      </StatusBadge>
                      {row.refusalReason ? (
                        <span className="text-caption text-muted">
                          {label('privacy.refusalReasons', row.refusalReason)}
                        </span>
                      ) : null}
                      {row.closedAt ? (
                        <span className="text-caption text-muted">
                          {t('privacy.closed', { time: format.dateTime(row.closedAt) })}
                        </span>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'actions',
                  header: t('common.actions'),
                  cell: (row) =>
                    row.status === 'open' ? (
                      <div className="flex flex-wrap gap-2">
                        <CompleteRequest request={row} />
                        <RefuseRequest request={row} />
                      </div>
                    ) : null,
                },
              ]}
            />
            {pages.hasNextPage ? (
              <Button
                variant="ghost"
                loading={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {t('common.loadMore')}
              </Button>
            ) : null}
          </div>
        )}
      </QueryState>
    </Section>
  );
}

interface BreachForm {
  title: string;
  details: string;
  awareAt: string;
  highRisk: boolean;
  categories: BreachDataCategory[];
  jurisdictions: PrivacyJurisdiction[];
  subjectsAffected: string;
}

function OpenBreachDialog() {
  const blank = (): BreachForm => ({
    title: '',
    details: '',
    awareAt: nowInput(),
    highRisk: false,
    categories: [],
    jurisdictions: [],
    subjectsAffected: '',
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BreachForm>(blank);
  const { toast } = useToast();
  const refresh = useRefresh(BREACHES);
  const create = $api.useMutation('post', BREACHES, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('privacy.opened'), variant: 'success' });
      await refresh();
    },
  });
  const errors = fieldIssues(create.error);
  const set = <K extends keyof BreachForm>(key: K, value: BreachForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const people = form.subjectsAffected.trim();
    create.mutate({
      body: {
        title: form.title.trim(),
        details: form.details.trim(),
        awareAt: isoFromLocalInput(form.awareAt) ?? '',
        highRisk: form.highRisk,
        categories: form.categories,
        jurisdictions: form.jurisdictions,
        subjectsAffected: people ? Number(people) : null,
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('privacy.openBreach')}
      triggerVariant="primary"
      title={t('privacy.openBreach')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank());
          create.reset();
        }
      }}
      testId="open-breach"
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('privacy.breachTitle')}
          hint={t('privacy.breachTitleHint')}
          name="title"
          value={form.title}
          maxLength={120}
          required
          error={errors.title}
          onChange={(event) => set('title', event.target.value)}
        />
        <TextAreaField
          label={t('privacy.details')}
          hint={t('privacy.detailsHint')}
          name="details"
          value={form.details}
          maxLength={4000}
          required
          error={errors.details}
          onChange={(event) => set('details', event.target.value)}
        />
        <FormGrid>
          <TextField
            label={t('privacy.awareAt')}
            name="awareAt"
            type="datetime-local"
            value={form.awareAt}
            required
            error={errors.awareAt}
            onChange={(event) => set('awareAt', event.target.value)}
          />
          <TextField
            label={t('form.optional', { label: t('privacy.subjectsAffected') })}
            hint={t('privacy.subjectsAffectedHint')}
            name="subjectsAffected"
            type="number"
            min={0}
            inputMode="numeric"
            value={form.subjectsAffected}
            error={errors.subjectsAffected}
            onChange={(event) => set('subjectsAffected', event.target.value)}
          />
        </FormGrid>
        <CheckboxField
          label={t('privacy.highRisk')}
          name="highRisk"
          checked={form.highRisk}
          onChange={(event) => set('highRisk', event.target.checked)}
        />
        <ChoiceList
          legend={t('privacy.categories')}
          name="categories"
          options={BREACH_DATA_CATEGORIES}
          value={form.categories}
          labelOf={(value) => label('privacy.categoryNames', value)}
          onChange={(next) => set('categories', next)}
          error={errors.categories}
        />
        <ChoiceList
          legend={t('privacy.jurisdictionsField')}
          name="jurisdictions"
          options={PRIVACY_JURISDICTIONS}
          value={form.jurisdictions}
          labelOf={(value) => label('privacy.jurisdictions', value)}
          onChange={(next) => set('jurisdictions', next)}
          error={errors.jurisdictions}
        />
        <ProblemAlert error={create.error} />
        <Button type="submit" loading={create.isPending}>
          {t('privacy.openBreach')}
        </Button>
      </form>
    </FormDialog>
  );
}

interface NoticeForm {
  notified: boolean;
  regulatorNotifiedAt: string;
  regulatorReference: string;
  subjectsNotifiedAt: string;
}

function RecordNoticeDialog({ breach, notice }: { breach: Breach; notice: Notice }) {
  const blank = (): NoticeForm => ({
    notified: true,
    regulatorNotifiedAt: nowInput(),
    regulatorReference: '',
    subjectsNotifiedAt: '',
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NoticeForm>(blank);
  const { toast } = useToast();
  const refresh = useRefresh(BREACHES);
  const record = $api.useMutation('post', `${BREACHES}/{id}/notices`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('privacy.noticeRecorded'), variant: 'success' });
      await refresh();
    },
  });
  const errors = fieldIssues(record.error);
  const set = <K extends keyof NoticeForm>(key: K, value: NoticeForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    record.mutate({
      params: { path: { id: breach.id } },
      body: form.notified
        ? {
            decision: 'notified',
            jurisdiction: notice.jurisdiction,
            regulatorNotifiedAt: isoFromLocalInput(form.regulatorNotifiedAt) ?? '',
            regulatorReference: nullable(form.regulatorReference),
            subjectsNotifiedAt: isoFromLocalInput(form.subjectsNotifiedAt),
          }
        : { decision: 'not_required', jurisdiction: notice.jurisdiction },
    });
  };
  const regulator = notice.regulator;
  return (
    <FormDialog
      triggerLabel={t('privacy.recordNotice')}
      triggerVariant="secondary"
      triggerAriaLabel={t('privacy.recordNoticeLabel', { regulator })}
      title={t('privacy.recordNoticeTitle', { regulator })}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank());
          record.reset();
        }
      }}
      testId={`record-notice-${notice.jurisdiction}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('privacy.decision')}
          name="decision"
          value={form.notified ? 'notified' : 'not_required'}
          options={(['notified', 'not_required'] as const).map((value) => ({
            value,
            label: label('privacy.decisions', value),
          }))}
          onChange={(event) => set('notified', event.target.value === 'notified')}
        />
        {form.notified ? (
          <>
            <FormGrid>
              <TextField
                label={t('privacy.regulatorNotifiedAt')}
                name="regulatorNotifiedAt"
                type="datetime-local"
                value={form.regulatorNotifiedAt}
                required
                error={errors.regulatorNotifiedAt}
                onChange={(event) => set('regulatorNotifiedAt', event.target.value)}
              />
              <TextField
                label={t('form.optional', { label: t('privacy.regulatorReference') })}
                name="regulatorReference"
                value={form.regulatorReference}
                maxLength={100}
                error={errors.regulatorReference}
                onChange={(event) => set('regulatorReference', event.target.value)}
              />
            </FormGrid>
            <TextField
              label={t('form.optional', { label: t('privacy.subjectsNotifiedAt') })}
              hint={t('privacy.subjectsNotifiedAtHint')}
              name="subjectsNotifiedAt"
              type="datetime-local"
              value={form.subjectsNotifiedAt}
              error={errors.subjectsNotifiedAt}
              onChange={(event) => set('subjectsNotifiedAt', event.target.value)}
            />
          </>
        ) : null}
        <ProblemAlert error={record.error} />
        <Button type="submit" loading={record.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

/** The encrypted details, fetched only when someone opens them. */
function BreachDetailsDialog({ breach }: { breach: Breach }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ['get', `${BREACHES}/{id}`, breach.id],
    queryFn: async () =>
      unwrap(await adminApi.GET(`${BREACHES}/{id}`, { params: { path: { id: breach.id } } })),
    enabled: open,
  });
  return (
    <FormDialog
      triggerLabel={t('privacy.viewDetails')}
      triggerAriaLabel={t('privacy.viewDetailsLabel', { title: breach.title })}
      title={breach.title}
      open={open}
      onOpenChange={setOpen}
    >
      <QueryState query={detail}>
        {(data) => (
          <p className="font-body text-body-sm whitespace-pre-line text-foreground">
            {data.details}
          </p>
        )}
      </QueryState>
    </FormDialog>
  );
}

function CloseBreach({ breach }: { breach: Breach }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh(BREACHES);
  const close = $api.useMutation('post', `${BREACHES}/{id}/close`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('privacy.breachClosed'), variant: 'success' });
      await refresh();
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('privacy.closeBreach')}
      triggerAriaLabel={t('privacy.closeBreachLabel', { title: breach.title })}
      question={t('privacy.closeBreachQuestion')}
      onConfirm={() => close.mutate({ params: { path: { id: breach.id } } })}
      pending={close.isPending}
      error={close.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) close.reset();
      }}
    />
  );
}

function noticeTone(notice: Notice) {
  if (notice.overdue) return 'danger' as const;
  if (notice.decision === 'pending') return 'warning' as const;
  return notice.decision === 'notified' ? ('success' as const) : ('neutral' as const);
}

function BreachCard({ breach }: { breach: Breach }) {
  const closed = breach.status === 'closed';
  return (
    <Section
      title={breach.title}
      intro={breach.categories.map((c) => label('privacy.categoryNames', c)).join(', ')}
      actions={
        <>
          <BreachDetailsDialog breach={breach} />
          {closed ? null : <CloseBreach breach={breach} />}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={closed ? 'success' : 'info'}>
          {label('privacy.breachStatuses', breach.status)}
        </StatusBadge>
        {breach.highRisk ? (
          <StatusBadge tone="danger">{t('privacy.highRiskBadge')}</StatusBadge>
        ) : null}
        <span className="font-body text-body-sm text-muted">
          {t('privacy.aware', { time: format.dateTime(breach.awareAt) })}
          {breach.subjectsAffected === null
            ? null
            : ` · ${t('privacy.people', { count: format.number(breach.subjectsAffected) })}`}
        </span>
      </div>
      <DataTable
        caption={t('privacy.notices')}
        rows={breach.notices}
        rowKey={(row) => row.jurisdiction}
        columns={[
          {
            key: 'regulator',
            header: t('privacy.regulator'),
            cell: (row) => (
              <div className="flex flex-col gap-1">
                <span>{row.regulator}</span>
                <span className="text-caption text-muted">
                  {label('privacy.jurisdictions', row.jurisdiction)}
                </span>
              </div>
            ),
          },
          {
            key: 'due',
            header: t('privacy.due'),
            cell: (row) => (
              <div className="flex flex-col gap-1">
                <span>{format.dateTime(row.regulatorDueAt)}</span>
                <span className="text-caption text-muted" title={row.source}>
                  {row.statutory ? t('privacy.statutory') : t('privacy.internal')}
                </span>
              </div>
            ),
          },
          {
            key: 'decision',
            header: t('privacy.decision'),
            cell: (row) => (
              <div className="flex flex-col gap-1">
                <StatusBadge tone={noticeTone(row)}>
                  {row.overdue ? t('privacy.overdue') : label('privacy.decisions', row.decision)}
                </StatusBadge>
                {row.regulatorNotifiedAt ? (
                  <span className="text-caption text-muted">
                    {t('privacy.notifiedAt', { time: format.dateTime(row.regulatorNotifiedAt) })}
                  </span>
                ) : null}
                {row.regulatorReference ? (
                  <span className="text-caption text-muted">
                    {t('privacy.reference', { reference: row.regulatorReference })}
                  </span>
                ) : null}
              </div>
            ),
          },
          {
            key: 'actions',
            header: t('common.actions'),
            cell: (row) => (closed ? null : <RecordNoticeDialog breach={breach} notice={row} />),
          },
        ]}
      />
    </Section>
  );
}

function BreachesSection() {
  const pages = useCursorPages(['get', BREACHES], async (cursor) =>
    unwrap(
      await adminApi.GET(BREACHES, {
        params: { query: { limit: 25, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  return (
    <section aria-labelledby="privacy-breaches" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="privacy-breaches" className="font-heading text-h3 font-bold text-heading">
            {t('privacy.breaches')}
          </h2>
          <p className="font-body text-body-sm text-muted">{t('privacy.breachesIntro')}</p>
        </div>
        <OpenBreachDialog />
      </div>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) =>
          items.length === 0 ? (
            <p className="font-body text-body-sm text-muted">{t('privacy.noBreaches')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {items.map((breach) => (
                <BreachCard key={breach.id} breach={breach} />
              ))}
              {pages.hasNextPage ? (
                <Button
                  variant="ghost"
                  loading={pages.isFetchingNextPage}
                  onClick={() => void pages.fetchNextPage()}
                >
                  {t('common.loadMore')}
                </Button>
              ) : null}
            </div>
          )
        }
      </QueryState>
    </section>
  );
}

/** The data rights request and breach registers (ADR-089), for the privacy officer. */
export function PrivacyPage() {
  return (
    <RequirePermission permission="privacy:manage">
      <div className="flex flex-col gap-6">
        <PageHeader title={t('privacy.title')} intro={t('privacy.intro')} />
        <RequestsSection />
        <BreachesSection />
      </div>
    </RequirePermission>
  );
}
