'use client';

import {
  AGENT_AUTONOMY_LEVELS,
  AGENT_PAUSE_REASONS,
  ALWAYS_ON_AGENTS,
  agentAudience,
  type AgentAutonomy,
  type AgentName,
  type AgentPauseReason,
} from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { usdFromMicro } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
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

type Overview = Schemas['AdminAgentOverview'];
type Setting = Schemas['AgentAutonomySetting'];

const PATH = '/v1/admin/ai/overview';

const useRefresh = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['get', PATH] });
};

function PauseDialog() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<AgentPauseReason>('incident');
  const { toast } = useToast();
  const refresh = useRefresh();
  const pause = $api.useMutation('post', '/v1/admin/ai/pause', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('ai.pausedToast'), variant: 'success' });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    pause.mutate({ body: { reason } });
  };
  return (
    <FormDialog
      triggerLabel={t('ai.pause')}
      triggerVariant="primary"
      title={t('ai.pause')}
      description={t('ai.stateIntro')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) pause.reset();
      }}
      testId="pause-assistant"
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('ai.pauseReason')}
          name="reason"
          value={reason}
          options={AGENT_PAUSE_REASONS.map((value) => ({
            value,
            label: label('ai.pauseReasons', value),
          }))}
          onChange={(event) => setReason(event.target.value as AgentPauseReason)}
        />
        <ProblemAlert error={pause.error} />
        <Button type="submit" loading={pause.isPending}>
          {t('ai.pauseSubmit')}
        </Button>
      </form>
    </FormDialog>
  );
}

function ReleaseAction() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const resume = $api.useMutation('post', '/v1/admin/ai/resume', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('ai.releasedToast'), variant: 'success' });
      await refresh();
    },
  });
  return (
    <ConfirmAction
      triggerLabel={t('ai.release')}
      question={t('ai.releaseQuestion')}
      onConfirm={() => resume.mutate({})}
      pending={resume.isPending}
      error={resume.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resume.reset();
      }}
    />
  );
}

function State({ overview, manage }: { overview: Overview; manage: boolean }) {
  const { pause } = overview;
  return (
    <Section
      title={t('ai.state')}
      intro={t('ai.stateIntro')}
      actions={
        manage && overview.enabled ? pause.paused ? <ReleaseAction /> : <PauseDialog /> : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2" data-testid="assistant-state">
        <StatusBadge tone={overview.enabled ? 'success' : 'neutral'}>
          {overview.enabled ? t('ai.on') : t('ai.off')}
        </StatusBadge>
        {overview.enabled ? (
          <StatusBadge tone={pause.paused ? 'warning' : 'info'}>
            {pause.paused ? t('ai.paused') : t('ai.running')}
          </StatusBadge>
        ) : null}
        <StatusBadge tone={overview.serviceConfigured ? 'info' : 'warning'}>
          {overview.serviceConfigured ? t('ai.serviceReady') : t('ai.serviceMissing')}
        </StatusBadge>
      </div>
      {overview.enabled ? null : (
        <p className="font-body text-body-sm text-muted">{t('ai.offNote')}</p>
      )}
      {pause.paused && pause.since && pause.reason ? (
        <p className="font-body text-body-sm text-foreground">
          {t('ai.pausedSince', {
            time: format.dateTime(pause.since),
            reason: label('ai.pauseReasons', pause.reason),
          })}
        </p>
      ) : null}
      {pause.known ? null : (
        <p role="alert" className="font-body text-body-sm text-danger">
          {t('ai.pauseUnknown')}
        </p>
      )}
      <DetailList
        items={[
          {
            term: t('ai.spendToday'),
            value: t('ai.spendOf', {
              spent: usdFromMicro(overview.spend.todayMicroUsd),
              cap: usdFromMicro(overview.spend.dailyCapMicroUsd),
            }),
          },
          { term: t('ai.runsToday'), value: format.number(overview.runs.today) },
          { term: t('ai.runsWaiting'), value: format.number(overview.runs.waiting) },
          { term: t('ai.runsFailed'), value: format.number(overview.runs.failedToday) },
          {
            term: t('ai.priceIntel'),
            value: overview.priceIntelEnabled ? t('ai.on') : t('ai.off'),
          },
        ]}
      />
    </Section>
  );
}

/** One level, for an agent or a tool. The API asks for an authenticator code (ADR-107). */
function LevelDialog({ setting, name }: { setting: Setting; name: string }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<AgentAutonomy>(setting.level);
  const { toast } = useToast();
  const refresh = useRefresh();
  const save = $api.useMutation('put', '/v1/admin/ai/autonomy', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('ai.levelSaved'), variant: 'success' });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ body: { subject: setting.subject, name: setting.name, level } });
  };
  return (
    <FormDialog
      triggerLabel={t('ai.changeLevel')}
      triggerAriaLabel={t('ai.changeLevelLabel', { name })}
      title={t('ai.changeLevelTitle', { name })}
      description={t('ai.changeLevelNote')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLevel(setting.level);
          save.reset();
        }
      }}
      testId={`level-${setting.subject}-${setting.name}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('ai.level')}
          name="level"
          value={level}
          options={AGENT_AUTONOMY_LEVELS.map((value) => ({
            value,
            label: label('ai.levels', value),
          }))}
          onChange={(event) => setLevel(event.target.value as AgentAutonomy)}
        />
        <ProblemAlert error={save.error} />
        <Button type="submit" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

const LevelCell = ({ setting }: { setting: Setting }) => (
  <span className="flex flex-wrap items-center gap-2">
    <StatusBadge tone={setting.level === 'manual' ? 'warning' : 'info'}>
      {label('ai.levels', setting.level)}
    </StatusBadge>
    <span className="text-muted">{setting.set ? t('ai.levelSet') : t('ai.levelDefault')}</span>
  </span>
);

/**
 * Switches one agent off or on. Its questions go to the general agent while it is off; the
 * two general agents cannot be switched off (pause the assistant instead). The API asks for an
 * authenticator code.
 */
function SwitchAction({ agent, enabled }: { agent: AgentName; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const change = $api.useMutation('put', '/v1/admin/ai/agents/{agent}', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('ai.switched'), variant: 'success' });
      await refresh();
    },
  });
  const name = label('ai.agents', agent);
  const action = enabled ? t('ai.switchOff') : t('ai.switchOn');
  return (
    <ConfirmAction
      triggerLabel={action}
      triggerAriaLabel={t('ai.switchLabel', { action, name })}
      question={enabled ? t('ai.switchOffQuestion', { name }) : t('ai.switchOnQuestion', { name })}
      onConfirm={() => change.mutate({ params: { path: { agent } }, body: { enabled: !enabled } })}
      pending={change.isPending}
      error={change.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) change.reset();
      }}
    />
  );
}

function Autonomy({ overview, manage }: { overview: Overview; manage: boolean }) {
  const agents = overview.autonomy.filter((setting) => setting.subject === 'agent');
  const off = new Set<string>(overview.disabledAgents);
  const alwaysOn = (name: string) => (ALWAYS_ON_AGENTS as readonly string[]).includes(name);
  return (
    <Section title={t('ai.autonomy')} intro={t('ai.autonomyIntro')}>
      <DataTable
        caption={t('ai.autonomyCaption')}
        rows={agents}
        rowKey={(row) => row.name}
        columns={[
          { key: 'agent', header: t('ai.agent'), cell: (row) => label('ai.agents', row.name) },
          {
            key: 'audience',
            header: t('ai.audience'),
            cell: (row) => label('ai.audiences', agentAudience(row.name as AgentName)),
          },
          {
            key: 'answers',
            header: t('ai.answers'),
            cell: (row) =>
              alwaysOn(row.name) ? (
                <StatusBadge tone="neutral">{t('ai.alwaysOn')}</StatusBadge>
              ) : (
                <StatusBadge tone={off.has(row.name) ? 'warning' : 'success'}>
                  {off.has(row.name) ? t('ai.agentOff') : t('ai.agentOn')}
                </StatusBadge>
              ),
          },
          { key: 'level', header: t('ai.level'), cell: (row) => <LevelCell setting={row} /> },
          ...(manage
            ? [
                {
                  key: 'actions',
                  header: t('common.actions'),
                  cell: (row: Setting) => (
                    <span className="flex flex-wrap gap-2">
                      <LevelDialog setting={row} name={label('ai.agents', row.name)} />
                      {alwaysOn(row.name) ? null : (
                        <SwitchAction agent={row.name as AgentName} enabled={!off.has(row.name)} />
                      )}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Section>
  );
}

function Tools({ overview, manage }: { overview: Overview; manage: boolean }) {
  const levels = new Map(
    overview.autonomy
      .filter((setting) => setting.subject === 'tool')
      .map((setting) => [setting.name, setting]),
  );
  return (
    <Section title={t('ai.tools')} intro={t('ai.toolsIntro')}>
      <DataTable
        caption={t('ai.toolsCaption')}
        rows={overview.tools}
        rowKey={(row) => row.name}
        columns={[
          {
            key: 'tool',
            header: t('ai.tool'),
            cell: (row) => (
              <span className="flex flex-col gap-1">
                <code className="font-bold text-heading">{row.name}</code>
                <span className="text-muted">{row.description}</span>
              </span>
            ),
          },
          {
            key: 'tier',
            header: t('ai.tier'),
            cell: (row) => (
              <StatusBadge tone={row.tier === 'read' ? 'neutral' : 'info'}>
                {label('ai.tiers', row.tier)}
              </StatusBadge>
            ),
          },
          { key: 'scope', header: t('ai.scope'), cell: (row) => label('ai.scopes', row.scope) },
          {
            key: 'agents',
            header: t('ai.usedBy'),
            cell: (row) => row.agents.map((agent) => label('ai.agents', agent)).join(', '),
          },
          {
            key: 'level',
            header: t('ai.level'),
            cell: (row) => {
              const setting = levels.get(row.name);
              return setting ? <LevelCell setting={setting} /> : t('common.none');
            },
          },
          ...(manage
            ? [
                {
                  key: 'actions',
                  header: t('common.actions'),
                  cell: (row: Overview['tools'][number]) => {
                    const setting = levels.get(row.name);
                    return setting ? <LevelDialog setting={setting} name={row.name} /> : null;
                  },
                },
              ]
            : []),
        ]}
      />
    </Section>
  );
}

const MORE = [
  { href: '/ai-activity', label: 'ai.openActivity' },
  { href: '/ai-insights', label: 'ai.openInsights' },
  { href: '/knowledge', label: 'ai.openKnowledge' },
] as const;

/** Where the rest of the assistant's pages are; the audit link only for staff who may read it. */
function More({ audit }: { audit: boolean }) {
  const link = 'inline-flex min-h-6 items-center font-body text-body-sm text-primary underline';
  return (
    <Section title={t('ai.more')} intro={t('ai.moreIntro')}>
      <ul className="flex flex-wrap gap-4">
        {MORE.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className={link}>
              {t(item.label)}
            </Link>
          </li>
        ))}
        {audit ? (
          <li>
            <Link href="/audit?area=assistant" className={link}>
              {t('ai.openAudit')}
            </Link>
          </li>
        ) : null}
      </ul>
    </Section>
  );
}

/**
 * The AI control centre (ADR-107): whether the assistant answers, what it spent, how far each
 * agent and tool may go, and the pause switch. Reading needs `ai:read`; pausing, releasing and
 * changing a level need `ai:manage`, and the last two an authenticator code.
 */
export function AiControlPage() {
  const { can } = useStaffSession();
  const manage = can('ai:manage');
  // The pause can be pressed by anyone with the right at any moment: keep the page current.
  const query = $api.useQuery('get', PATH, {}, { refetchInterval: 30_000 });
  return (
    <RequirePermission permission="ai:read">
      <div className="flex flex-col gap-6">
        <PageHeader title={t('ai.title')} intro={t('ai.intro')} />
        <QueryState query={query}>
          {(overview) => (
            <div className="flex flex-col gap-6">
              <State overview={overview} manage={manage} />
              <Autonomy overview={overview} manage={manage} />
              <Tools overview={overview} manage={manage} />
              <More audit={can('audit:read')} />
            </div>
          )}
        </QueryState>
      </div>
    </RequirePermission>
  );
}
