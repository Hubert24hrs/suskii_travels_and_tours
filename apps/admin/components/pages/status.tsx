'use client';

import {
  STATUS_COMPONENTS,
  STATUS_INCIDENT_IMPACTS,
  STATUS_INCIDENT_STAGES,
  type StatusComponent,
  type StatusIncidentImpact,
  type StatusIncidentStage,
} from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import { fieldIssues } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import {
  CheckboxField,
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

type Incident = Schemas['StatusIncident'];
type Filter = 'all' | 'open' | 'resolved';

const PATH = '/v1/admin/status/incidents';
const OPEN_STAGES = STATUS_INCIDENT_STAGES.filter((stage) => stage !== 'resolved');

interface IncidentForm {
  title: string;
  impact: StatusIncidentImpact;
  components: StatusComponent[];
  status: StatusIncidentStage;
  message: string;
}

/** The affected components as checkboxes, in the order the status page lists them. */
function ComponentsField({
  value,
  onChange,
  error,
}: {
  value: readonly StatusComponent[];
  onChange: (next: StatusComponent[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-body text-body-sm font-medium text-foreground">
        {t('status.components')}
      </legend>
      {STATUS_COMPONENTS.map((component) => (
        <CheckboxField
          key={component}
          label={label('status.componentNames', component)}
          name="components"
          value={component}
          checked={value.includes(component)}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? STATUS_COMPONENTS.filter((c) => c === component || value.includes(c))
                : value.filter((c) => c !== component),
            )
          }
        />
      ))}
      {error ? <span className="font-body text-caption text-danger">{error}</span> : null}
    </fieldset>
  );
}

const useRefresh = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['get', PATH] });
};

function OpenIncidentDialog() {
  const blank: IncidentForm = {
    title: '',
    impact: 'minor',
    components: [],
    status: 'investigating',
    message: '',
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<IncidentForm>(blank);
  const { toast } = useToast();
  const refresh = useRefresh();
  const create = $api.useMutation('post', PATH, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('status.opened'), variant: 'success' });
      await refresh();
    },
  });
  const errors = fieldIssues(create.error);
  const set = <K extends keyof IncidentForm>(key: K, value: IncidentForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      body: {
        title: form.title.trim(),
        impact: form.impact,
        components: form.components,
        status: form.status === 'resolved' ? 'investigating' : form.status,
        message: form.message.trim(),
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('status.open')}
      triggerVariant="primary"
      title={t('status.open')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank);
          create.reset();
        }
      }}
      testId="open-incident"
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('status.titleField')}
          hint={t('status.titleHint')}
          name="title"
          value={form.title}
          maxLength={120}
          required
          error={errors.title}
          onChange={(event) => set('title', event.target.value)}
        />
        <FormGrid>
          <SelectField
            label={t('status.impact')}
            name="impact"
            value={form.impact}
            options={STATUS_INCIDENT_IMPACTS.map((value) => ({
              value,
              label: label('status.impacts', value),
            }))}
            onChange={(event) => set('impact', event.target.value as StatusIncidentImpact)}
          />
          <SelectField
            label={t('status.stage')}
            name="status"
            value={form.status}
            options={OPEN_STAGES.map((value) => ({ value, label: label('status.stages', value) }))}
            onChange={(event) => set('status', event.target.value as StatusIncidentStage)}
          />
        </FormGrid>
        <ComponentsField
          value={form.components}
          onChange={(next) => set('components', next)}
          error={errors.components}
        />
        <TextAreaField
          label={t('status.message')}
          hint={t('status.messageHint')}
          name="message"
          value={form.message}
          maxLength={2000}
          required
          error={errors.message}
          onChange={(event) => set('message', event.target.value)}
        />
        <ProblemAlert error={create.error} />
        <Button type="submit" loading={create.isPending}>
          {t('status.submitOpen')}
        </Button>
      </form>
    </FormDialog>
  );
}

function UpdateIncidentDialog({ incident }: { incident: Incident }) {
  const initial = (): IncidentForm => ({
    title: incident.title,
    impact: incident.impact,
    components: [...incident.components],
    status: incident.status,
    message: '',
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<IncidentForm>(initial);
  const { toast } = useToast();
  const refresh = useRefresh();
  const update = $api.useMutation('post', `${PATH}/{id}/updates`, {
    onSuccess: async (data) => {
      setOpen(false);
      toast({
        title: data.resolvedAt ? t('status.resolvedToast') : t('status.posted'),
        variant: 'success',
      });
      await refresh();
    },
  });
  const errors = fieldIssues(update.error);
  const set = <K extends keyof IncidentForm>(key: K, value: IncidentForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      params: { path: { id: incident.id } },
      body: {
        status: form.status,
        message: form.message.trim(),
        ...(form.impact === incident.impact ? {} : { impact: form.impact }),
        ...(form.components.join() === incident.components.join()
          ? {}
          : { components: form.components }),
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('status.postUpdate')}
      triggerVariant="secondary"
      triggerAriaLabel={`${t('status.postUpdate')}: ${incident.title}`}
      title={incident.title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initial());
          update.reset();
        }
      }}
      testId={`update-incident-${incident.id}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <SelectField
            label={t('status.stage')}
            name="status"
            value={form.status}
            options={STATUS_INCIDENT_STAGES.map((value) => ({
              value,
              label: label('status.stages', value),
            }))}
            onChange={(event) => set('status', event.target.value as StatusIncidentStage)}
          />
          <SelectField
            label={t('status.impact')}
            name="impact"
            value={form.impact}
            options={STATUS_INCIDENT_IMPACTS.map((value) => ({
              value,
              label: label('status.impacts', value),
            }))}
            onChange={(event) => set('impact', event.target.value as StatusIncidentImpact)}
          />
        </FormGrid>
        <ComponentsField
          value={form.components}
          onChange={(next) => set('components', next)}
          error={errors.components}
        />
        <TextAreaField
          label={t('status.message')}
          hint={t('status.messageHint')}
          name="message"
          value={form.message}
          maxLength={2000}
          required
          error={errors.message}
          onChange={(event) => set('message', event.target.value)}
        />
        <ProblemAlert error={update.error} />
        <Button type="submit" loading={update.isPending}>
          {t('status.postUpdate')}
        </Button>
      </form>
    </FormDialog>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  const resolved = incident.resolvedAt !== null;
  return (
    <Section
      title={incident.title}
      intro={incident.components.map((c) => label('status.componentNames', c)).join(', ')}
      actions={resolved ? undefined : <UpdateIncidentDialog incident={incident} />}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={incident.impact === 'major' ? 'danger' : 'warning'}>
          {label('status.impacts', incident.impact)}
        </StatusBadge>
        <StatusBadge tone={resolved ? 'success' : 'info'}>
          {label('status.stages', incident.status)}
        </StatusBadge>
        <span className="font-body text-body-sm text-muted">
          {t('status.started', { time: format.dateTime(incident.startedAt) })}
          {' · '}
          {incident.resolvedAt
            ? t('status.resolvedAt', { time: format.dateTime(incident.resolvedAt) })
            : t('status.ongoing')}
        </span>
      </div>
      <h3 className="font-body text-body-sm font-medium text-foreground">{t('status.timeline')}</h3>
      <ol className="flex flex-col gap-3">
        {incident.updates.map((update) => (
          <li key={`${update.createdAt}-${update.status}`} className="flex flex-col gap-1">
            <p className="font-body text-caption text-muted">
              {label('status.stages', update.status)} · {format.dateTime(update.createdAt)}
            </p>
            <p className="font-body text-body-sm text-foreground">{update.message}</p>
          </li>
        ))}
      </ol>
      {resolved ? (
        <p className="font-body text-caption text-muted">{t('status.resolvedNote')}</p>
      ) : null}
    </Section>
  );
}

/** Status page incidents (ADR-087): open one, post updates, resolve it. */
export function StatusIncidentsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const pages = useCursorPages(['get', PATH, filter], async (cursor) =>
    unwrap(
      await adminApi.GET(PATH, {
        params: {
          query: {
            limit: 25,
            ...(filter === 'all' ? {} : { state: filter }),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
  const incidents = pages.data?.pages.flatMap((page) => page.items);
  return (
    <RequirePermission permission="status:manage">
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('status.title')}
          intro={t('status.intro')}
          actions={<OpenIncidentDialog />}
        />
        <div className="max-w-popover">
          <SelectField
            label={t('status.filter')}
            name="state"
            value={filter}
            options={(['all', 'open', 'resolved'] as const).map((value) => ({
              value,
              label: label('status.filters', value),
            }))}
            onChange={(event) => setFilter(event.target.value as Filter)}
          />
        </div>
        <QueryState query={{ ...pages, data: incidents }}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="font-body text-body-sm text-muted">{t('status.empty')}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {rows.map((incident) => (
                  <IncidentCard key={incident.id} incident={incident} />
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
      </div>
    </RequirePermission>
  );
}
