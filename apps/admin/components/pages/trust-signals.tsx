'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { fieldIssues, nullable } from '../../lib/form';
import { format, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  DataTable,
  FormDialog,
  PageHeader,
  ProblemAlert,
  QueryState,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../ui';

type Signal = Schemas['AdminTrustSignal'];

function useDone(close: () => void) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return async () => {
    close();
    toast({ title: t('common.saved'), variant: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/trust-signals'] });
  };
}

function EditDialog({ signal }: { signal: Signal }) {
  const blank = {
    label: signal.label,
    value: signal.value ?? '',
    sortOrder: String(signal.sortOrder),
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const update = $api.useMutation('patch', '/v1/admin/trust-signals/{key}', {
    onSuccess: useDone(() => setOpen(false)),
  });
  const errors = fieldIssues(update.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      params: { path: { key: signal.key } },
      body: { label: form.label, value: nullable(form.value), sortOrder: Number(form.sortOrder) },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('trust.edit')}
      title={t('trust.edit')}
      description={t('trust.intro')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank);
          update.reset();
        }
      }}
      testId={`edit-signal-${signal.key}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('trust.label')}
          name="label"
          value={form.label}
          required
          maxLength={80}
          error={errors.label}
          onChange={(event) => setForm({ ...form, label: event.target.value })}
        />
        <TextField
          label={t('trust.value')}
          name="value"
          value={form.value}
          maxLength={40}
          error={errors.value}
          onChange={(event) => setForm({ ...form, value: event.target.value })}
        />
        <TextField
          label={t('trust.sortOrder')}
          name="sortOrder"
          type="number"
          min={0}
          max={10000}
          value={form.sortOrder}
          onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
        />
        <ProblemAlert error={update.error} />
        <Button type="submit" loading={update.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function VerifyDialog({ signal }: { signal: Signal }) {
  const [open, setOpen] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState(signal.evidenceUrl ?? '');
  const verify = $api.useMutation('post', '/v1/admin/trust-signals/{key}/verify', {
    onSuccess: useDone(() => setOpen(false)),
  });
  const errors = fieldIssues(verify.error);
  return (
    <FormDialog
      triggerLabel={t('trust.verify')}
      triggerVariant="primary"
      title={t('trust.verify')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) verify.reset();
      }}
      testId={`verify-signal-${signal.key}`}
    >
      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          verify.mutate({
            params: { path: { key: signal.key } },
            body: { evidenceUrl: evidenceUrl.trim() },
          });
        }}
        className="flex flex-col gap-4"
      >
        <TextField
          label={t('trust.evidenceUrl')}
          hint={t('trust.evidenceHint')}
          name="evidenceUrl"
          type="url"
          value={evidenceUrl}
          required
          error={errors.evidenceUrl}
          onChange={(event) => setEvidenceUrl(event.target.value)}
          data-testid="evidence-url"
        />
        <ProblemAlert error={verify.error} />
        <Button type="submit" loading={verify.isPending}>
          {t('trust.verify')}
        </Button>
      </form>
    </FormDialog>
  );
}

function UnverifyDialog({ signal }: { signal: Signal }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const unverify = $api.useMutation('post', '/v1/admin/trust-signals/{key}/unverify', {
    onSuccess: useDone(() => setOpen(false)),
  });
  return (
    <FormDialog
      triggerLabel={t('trust.unverify')}
      title={t('trust.unverify')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) unverify.reset();
      }}
    >
      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          unverify.mutate({ params: { path: { key: signal.key } }, body: { reason } });
        }}
        className="flex flex-col gap-4"
      >
        <TextAreaField
          label={t('trust.unverifyReason')}
          name="reason"
          value={reason}
          required
          minLength={3}
          maxLength={200}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
        />
        <ProblemAlert error={unverify.error} />
        <Button type="submit" loading={unverify.isPending}>
          {t('trust.unverify')}
        </Button>
      </form>
    </FormDialog>
  );
}

export function TrustSignalsPage() {
  const { can } = useStaffSession();
  const query = $api.useQuery('get', '/v1/admin/trust-signals');
  const verifier = can('trust-signals:verify');
  return (
    <RequirePermission permission="cms:manage">
      <PageHeader title={t('trust.title')} intro={t('trust.intro')} />
      {verifier ? null : (
        <p className="font-body text-body-sm text-muted">{t('trust.verifyOnly')}</p>
      )}
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('trust.title')}
            rows={data.signals}
            rowKey={(row) => row.key}
            columns={[
              { key: 'label', header: t('trust.label'), cell: (row) => row.label },
              {
                key: 'value',
                header: t('trust.value'),
                cell: (row) => row.value ?? t('common.none'),
              },
              { key: 'order', header: t('trust.sortOrder'), cell: (row) => row.sortOrder },
              {
                key: 'verified',
                header: t('common.status'),
                cell: (row) =>
                  row.verified ? (
                    <div className="flex flex-col gap-1">
                      <StatusBadge tone="success">{t('trust.verified')}</StatusBadge>
                      {row.verifiedAt ? (
                        <span className="font-body text-caption text-muted">
                          {t('trust.verifiedBy', { time: format.dateTime(row.verifiedAt) })}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <StatusBadge tone="neutral">{t('trust.notVerified')}</StatusBadge>
                  ),
              },
              {
                key: 'evidence',
                header: t('trust.evidence'),
                cell: (row) =>
                  row.evidenceUrl ? (
                    <a
                      href={row.evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-primary underline focus-visible:focus-ring"
                    >
                      {new URL(row.evidenceUrl).hostname}
                    </a>
                  ) : (
                    t('common.none')
                  ),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => (
                  <div className="flex flex-wrap gap-2">
                    <EditDialog signal={row} />
                    {verifier ? (
                      row.verified ? (
                        <UnverifyDialog signal={row} />
                      ) : (
                        <VerifyDialog signal={row} />
                      )
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </QueryState>
    </RequirePermission>
  );
}
