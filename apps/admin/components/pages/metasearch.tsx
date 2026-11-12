'use client';

import { Button, Dialog, DialogContent, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { fieldIssues, percentFromBps } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
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
  StatusBadge,
  TextField,
} from '../ui';

type Partner = Schemas['AdminMetasearchPartner'];
type Row = Schemas['AdminMetasearchReport']['partners'][number];
interface Revealed {
  name: string;
  key: string;
}

const PATH = '/v1/admin/metasearch/partners';

interface PartnerForm {
  name: string;
  code: string;
  requestsPerMinute: string;
  requestsPerDay: string;
  maxResults: string;
  active: boolean;
}

const initialForm = (partner: Partner | null): PartnerForm => ({
  name: partner?.name ?? '',
  code: partner?.code ?? '',
  requestsPerMinute: String(partner?.requestsPerMinute ?? 60),
  requestsPerDay: String(partner?.requestsPerDay ?? 20_000),
  maxResults: String(partner?.maxResults ?? 50),
  active: partner?.active ?? true,
});

/** Shows a new key once, with a copy button; closing it forgets the key. */
function KeyDialog({ revealed, onClose }: { revealed: Revealed | null; onClose: () => void }) {
  const { toast } = useToast();
  return (
    <Dialog open={revealed !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {revealed ? (
        <DialogContent
          title={t('metasearch.keyTitle', { name: revealed.name })}
          description={t('metasearch.keyOnce')}
          closeLabel={t('common.close')}
        >
          <div className="flex flex-col gap-4">
            <TextField
              label={t('metasearch.keyLabel')}
              name="key"
              value={revealed.key}
              readOnly
              data-testid="metasearch-key"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(revealed.key)
                  .then(() => toast({ title: t('metasearch.copied'), variant: 'success' }));
              }}
            >
              {t('metasearch.copy')}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function PartnerFormDialog({
  partner,
  onKey,
}: {
  partner: Partner | null;
  onKey: (revealed: Revealed) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PartnerForm>(() => initialForm(partner));
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['get', PATH] });
  const create = $api.useMutation('post', PATH, {
    onSuccess: async (data) => {
      setOpen(false);
      onKey({ name: data.partner.name, key: data.key });
      await refresh();
    },
  });
  const update = $api.useMutation('patch', `${PATH}/{partnerId}`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('common.saved'), variant: 'success' });
      await refresh();
    },
  });
  const mutation = partner ? update : create;
  const errors = fieldIssues(mutation.error);
  const set = <K extends keyof PartnerForm>(key: K, value: PartnerForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const limits = {
      requestsPerMinute: Number(form.requestsPerMinute),
      requestsPerDay: Number(form.requestsPerDay),
      maxResults: Number(form.maxResults),
    };
    if (partner)
      update.mutate({
        params: { path: { partnerId: partner.id } },
        body: { name: form.name.trim(), active: form.active, ...limits },
      });
    else create.mutate({ body: { name: form.name.trim(), code: form.code.trim(), ...limits } });
  };

  const title = partner ? t('metasearch.editPartner') : t('metasearch.newPartner');
  return (
    <FormDialog
      triggerLabel={partner ? t('common.edit') : title}
      triggerVariant={partner ? 'ghost' : 'primary'}
      triggerAriaLabel={partner ? `${t('common.edit')} ${partner.name}` : undefined}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initialForm(partner));
          mutation.reset();
        }
      }}
      testId={partner ? `edit-partner-${partner.code}` : 'new-partner'}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label={t('metasearch.name')}
            name="name"
            value={form.name}
            required
            error={errors.name}
            onChange={(event) => set('name', event.target.value)}
          />
          {partner ? null : (
            <TextField
              label={t('metasearch.code')}
              hint={t('metasearch.codeHint')}
              name="code"
              value={form.code}
              required
              error={errors.code}
              onChange={(event) => set('code', event.target.value)}
            />
          )}
          <TextField
            label={t('metasearch.perMinute')}
            name="requestsPerMinute"
            inputMode="numeric"
            value={form.requestsPerMinute}
            required
            error={errors.requestsPerMinute}
            onChange={(event) => set('requestsPerMinute', event.target.value)}
          />
          <TextField
            label={t('metasearch.perDay')}
            name="requestsPerDay"
            inputMode="numeric"
            value={form.requestsPerDay}
            required
            error={errors.requestsPerDay}
            onChange={(event) => set('requestsPerDay', event.target.value)}
          />
          <TextField
            label={t('metasearch.maxResults')}
            name="maxResults"
            inputMode="numeric"
            value={form.maxResults}
            required
            error={errors.maxResults}
            onChange={(event) => set('maxResults', event.target.value)}
          />
        </FormGrid>
        {partner ? (
          <CheckboxField
            label={t('common.active')}
            name="active"
            checked={form.active}
            onChange={(event) => set('active', event.target.checked)}
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

function RotateKey({ partner, onKey }: { partner: Partner; onKey: (revealed: Revealed) => void }) {
  const [open, setOpen] = useState(false);
  const rotate = $api.useMutation('post', `${PATH}/{partnerId}/key`, {
    onSuccess: (data) => {
      setOpen(false);
      onKey({ name: data.partner.name, key: data.key });
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('metasearch.rotate')}
      triggerAriaLabel={t('metasearch.rotateFor', { name: partner.name })}
      question={t('metasearch.confirmRotate')}
      onConfirm={() => rotate.mutate({ params: { path: { partnerId: partner.id } } })}
      pending={rotate.isPending}
      error={rotate.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) rotate.reset();
      }}
    />
  );
}

const share = (bps: number | null): string =>
  bps === null ? t('metasearch.noData') : `${percentFromBps(bps)}%`;

/** Metasearch partners, their keys and 30 days of landings (ADR-081). */
export function MetasearchPage() {
  const query = $api.useQuery('get', PATH, {});
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  // The report is for `reports:read`; adding partners and keys needs `pricing:manage`.
  const manage = useStaffSession().can('pricing:manage');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('metasearch.title')}
        intro={t('metasearch.intro')}
        actions={manage ? <PartnerFormDialog partner={null} onKey={setRevealed} /> : undefined}
      />
      <QueryState query={query}>
        {(data) => (
          <DataTable<Row>
            caption={t('metasearch.title')}
            rows={data.partners}
            rowKey={(row) => row.partner.id}
            empty={t('metasearch.empty')}
            columns={[
              {
                key: 'name',
                header: t('metasearch.name'),
                cell: (row) => `${row.partner.name} (${row.partner.code})`,
              },
              {
                key: 'key',
                header: t('metasearch.keyHint'),
                cell: (row) => <code>{row.partner.keyHint}…</code>,
              },
              {
                key: 'status',
                header: t('common.status'),
                cell: (row) =>
                  row.partner.active ? (
                    <StatusBadge tone="success">{t('common.active')}</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">{t('common.inactive')}</StatusBadge>
                  ),
              },
              {
                key: 'limits',
                header: `${t('metasearch.perMinute')} / ${t('metasearch.perDay')}`,
                cell: (row) =>
                  `${format.number(row.partner.requestsPerMinute)} / ${format.number(row.partner.requestsPerDay)}`,
              },
              {
                key: 'landings',
                header: t('metasearch.landings'),
                cell: (row) =>
                  row.landings === 0
                    ? t('metasearch.noData')
                    : (['same', 'lower', 'higher', 'unavailable', 'expired'] as const)
                        .filter((outcome) => row.outcomes[outcome] > 0)
                        .map(
                          (outcome) =>
                            `${label('metasearch.outcomes', outcome)} ${format.number(row.outcomes[outcome])}`,
                        )
                        .join(' · '),
              },
              {
                key: 'accuracy',
                header: t('metasearch.accuracy'),
                cell: (row) => share(row.priceAccuracyBps),
              },
              {
                key: 'linkSuccess',
                header: t('metasearch.linkSuccess'),
                cell: (row) => share(row.linkSuccessBps),
              },
              {
                key: 'bookings',
                header: t('metasearch.bookings'),
                cell: (row) =>
                  row.value.length === 0
                    ? format.number(row.bookings)
                    : `${format.number(row.bookings)} · ${row.value.map((value) => format.money(value)).join(', ')}`,
              },
              ...(manage
                ? [
                    {
                      key: 'actions',
                      header: t('common.actions'),
                      cell: (row: Row) => (
                        <div className="flex flex-wrap gap-2">
                          <PartnerFormDialog partner={row.partner} onKey={setRevealed} />
                          <RotateKey partner={row.partner} onKey={setRevealed} />
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </QueryState>
      <KeyDialog revealed={revealed} onClose={() => setRevealed(null)} />
    </div>
  );
}
