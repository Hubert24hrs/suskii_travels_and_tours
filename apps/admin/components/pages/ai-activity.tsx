'use client';

import { AGENT_AUDIENCES, AGENT_NAMES, type AgentAudience, type AgentName } from '@suskii/shared';
import { Button } from '@suskii/ui-web';
import { useState } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import { usdFineFromMicro } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import {
  DataTable,
  DetailList,
  FormDialog,
  PageHeader,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  type Column,
} from '../ui';

type Run = Schemas['AdminAgentRun'];
type RunStatus = Run['status'];
type Conversation = Schemas['AdminAgentConversationSummary'];

const RUNS = '/v1/admin/ai/monitor/runs';
const CONVERSATIONS = '/v1/admin/ai/monitor/conversations';
const RUN_STATUSES: readonly RunStatus[] = [
  'running',
  'waiting',
  'succeeded',
  'failed',
  'cancelled',
  'refused',
];

const runTone = (status: RunStatus) =>
  status === 'succeeded'
    ? 'success'
    : status === 'failed'
      ? 'danger'
      : status === 'refused' || status === 'cancelled'
        ? 'warning'
        : 'info';

/** An agent's name where the catalogue has one; the stored value for one that was retired. */
const agentName = (agent: string) => label('ai.agents', agent);

const seconds = (ms: number | null) =>
  ms === null ? t('common.none') : t('aiActivity.seconds', { seconds: (ms / 1000).toFixed(1) });

/** One run with the tools it called: names, kinds, outcomes and codes, never a value. */
function TraceDialog({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const query = $api.useQuery(
    'get',
    `${RUNS}/{runId}`,
    { params: { path: { runId: run.id } } },
    { enabled: open },
  );
  return (
    <FormDialog
      triggerLabel={t('aiActivity.trace')}
      triggerAriaLabel={t('aiActivity.traceLabel', { time: format.dateTime(run.startedAt) })}
      title={t('aiActivity.traceTitle')}
      description={t('aiActivity.traceNote')}
      open={open}
      onOpenChange={setOpen}
      testId={`trace-${run.id}`}
    >
      <QueryState query={query}>
        {(trace) => (
          <div className="flex flex-col gap-4">
            <DetailList
              items={[
                {
                  term: t('aiActivity.agentsInvolved'),
                  value: trace.agents.map(agentName).join(', ') || agentName(trace.agent),
                },
                { term: t('aiActivity.model'), value: trace.model ?? t('common.none') },
                { term: t('aiActivity.prompt'), value: trace.promptVersion ?? t('common.none') },
                { term: t('aiActivity.steps'), value: format.number(trace.steps) },
                { term: t('aiActivity.outcome'), value: trace.outcome ?? t('common.none') },
              ]}
            />
            <DataTable
              caption={t('aiActivity.traceCaption')}
              rows={trace.toolCalls}
              rowKey={(row) => row.id}
              empty={t('aiActivity.noToolCalls')}
              columns={[
                {
                  key: 'tool',
                  header: t('aiActivity.tool'),
                  cell: (row) => (
                    <span className="flex flex-col gap-1">
                      <code className="font-bold text-heading">{row.tool}</code>
                      <span className="text-muted">{agentName(row.agent)}</span>
                    </span>
                  ),
                },
                {
                  key: 'tier',
                  header: t('aiActivity.tier'),
                  cell: (row) => label('aiActivity.tiers', row.tier),
                },
                {
                  key: 'result',
                  header: t('aiActivity.result'),
                  cell: (row) => (
                    <span className="flex flex-col gap-1">
                      <StatusBadge tone={row.status === 'ok' ? 'success' : 'warning'}>
                        {label('aiActivity.callStatuses', row.status)}
                      </StatusBadge>
                      {row.reason ? <code>{row.reason}</code> : null}
                    </span>
                  ),
                },
                {
                  key: 'arguments',
                  header: t('aiActivity.argumentNames'),
                  cell: (row) =>
                    row.argumentKeys.length > 0 ? (
                      <code className="break-all">{row.argumentKeys.join(', ')}</code>
                    ) : (
                      t('common.none')
                    ),
                },
                {
                  key: 'took',
                  header: t('aiActivity.took'),
                  cell: (row) => seconds(row.durationMs),
                },
              ]}
            />
          </div>
        )}
      </QueryState>
    </FormDialog>
  );
}

const runColumns: readonly Column<Run>[] = [
  {
    key: 'started',
    header: t('aiActivity.started'),
    cell: (row) => format.dateTime(row.startedAt),
  },
  {
    key: 'agent',
    header: t('aiActivity.agent'),
    cell: (row) => (
      <span className="flex flex-col gap-1">
        <span>{agentName(row.agent)}</span>
        <span className="text-muted">{label('aiActivity.channels', row.channel)}</span>
      </span>
    ),
  },
  {
    key: 'status',
    header: t('aiActivity.status'),
    cell: (row) => (
      <span className="flex flex-col gap-1">
        <StatusBadge tone={runTone(row.status)}>
          {label('aiActivity.statuses', row.status)}
        </StatusBadge>
        {row.outcome ? <code>{row.outcome}</code> : null}
      </span>
    ),
  },
  {
    key: 'tokens',
    header: t('aiActivity.tokens'),
    cell: (row) =>
      t('aiActivity.tokensInOut', {
        input: format.number(row.inputTokens),
        output: format.number(row.outputTokens),
      }),
  },
  { key: 'cost', header: t('aiActivity.cost'), cell: (row) => usdFineFromMicro(row.costMicroUsd) },
  {
    key: 'tools',
    header: t('aiActivity.toolCalls'),
    cell: (row) => format.number(row.toolCallCount),
  },
  { key: 'took', header: t('aiActivity.took'), cell: (row) => seconds(row.durationMs) },
  { key: 'actions', header: t('common.actions'), cell: (row) => <TraceDialog run={row} /> },
];

interface RunFilters {
  status?: RunStatus;
  agent?: AgentName;
  audience?: AgentAudience;
}

function Runs() {
  const [filters, setFilters] = useState<RunFilters>({});
  const pages = useCursorPages(['get', RUNS, filters], async (cursor) =>
    unwrap(
      await adminApi.GET(RUNS, {
        params: { query: { ...filters, limit: 30, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  const any = { value: '', label: t('common.any') };
  // A filter left on "Any" is left out of the query, not sent empty.
  const pick = <K extends keyof RunFilters>(key: K, value: string) =>
    setFilters((current) => {
      const next = { ...current };
      if (value) next[key] = value as RunFilters[K];
      else delete next[key];
      return next;
    });
  return (
    <Section title={t('aiActivity.runs')} intro={t('aiActivity.runsIntro')}>
      <div className="grid gap-3 md:grid-cols-3">
        <SelectField
          label={t('aiActivity.filterStatus')}
          name="status"
          value={filters.status ?? ''}
          options={[
            any,
            ...RUN_STATUSES.map((value) => ({
              value,
              label: label('aiActivity.statuses', value),
            })),
          ]}
          onChange={(event) => pick('status', event.target.value)}
        />
        <SelectField
          label={t('aiActivity.filterAgent')}
          name="agent"
          value={filters.agent ?? ''}
          options={[any, ...AGENT_NAMES.map((value) => ({ value, label: agentName(value) }))]}
          onChange={(event) => pick('agent', event.target.value)}
        />
        <SelectField
          label={t('aiActivity.filterAudience')}
          name="audience"
          value={filters.audience ?? ''}
          options={[
            any,
            ...AGENT_AUDIENCES.map((value) => ({ value, label: label('ai.audiences', value) })),
          ]}
          onChange={(event) => pick('audience', event.target.value)}
        />
      </div>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) => (
          <>
            <DataTable
              caption={t('aiActivity.runsCaption')}
              rows={items}
              rowKey={(row) => row.id}
              columns={runColumns}
              empty={t('aiActivity.noRuns')}
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
          </>
        )}
      </QueryState>
    </Section>
  );
}

/**
 * A traveller's conversation as the model saw it: contact details and document numbers
 * removed by the API. Opening it is recorded in the audit log with the reader's name.
 */
function ConversationDialog({ conversation }: { conversation: Conversation }) {
  const [open, setOpen] = useState(false);
  const query = $api.useQuery(
    'get',
    `${CONVERSATIONS}/{conversationId}`,
    { params: { path: { conversationId: conversation.id } } },
    // Each opening is one audited read: never refetched behind the reader's back.
    { enabled: open, staleTime: Infinity, refetchOnWindowFocus: false },
  );
  return (
    <FormDialog
      triggerLabel={t('aiActivity.open')}
      triggerAriaLabel={t('aiActivity.openLabel', { reference: conversation.reference })}
      title={t('aiActivity.conversationTitle', { reference: conversation.reference })}
      description={t('aiActivity.maskedNote')}
      open={open}
      onOpenChange={setOpen}
      testId={`conversation-${conversation.reference}`}
    >
      <QueryState query={query}>
        {(detail) =>
          detail.messages.length === 0 ? (
            <p className="font-body text-body-sm text-muted">{t('aiActivity.noMessages')}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {detail.messages.map((message) => (
                <li
                  key={message.id}
                  className="flex flex-col gap-1 rounded-md border border-border p-3"
                  data-testid={`monitor-message-${message.role}`}
                >
                  <span className="font-body text-caption text-muted">
                    {message.role === 'user'
                      ? t('aiActivity.traveller')
                      : message.agent
                        ? agentName(message.agent)
                        : t('aiActivity.assistantName')}
                    {', '}
                    {format.dateTime(message.createdAt)}
                  </span>
                  {message.text ? (
                    <p className="font-body text-body-sm whitespace-pre-wrap text-foreground">
                      {message.text}
                    </p>
                  ) : null}
                  {message.notice ? (
                    <p className="font-body text-body-sm text-muted">
                      {t('aiActivity.noticeSent', {
                        notice: label('assistant.notices', message.notice),
                      })}
                    </p>
                  ) : null}
                  <span className="flex flex-wrap gap-2">
                    {message.cards > 0 ? (
                      <StatusBadge tone="neutral">
                        {t('aiActivity.cardsShown', { count: format.number(message.cards) })}
                      </StatusBadge>
                    ) : null}
                    {message.feedback ? (
                      <StatusBadge tone={message.feedback === 'up' ? 'success' : 'warning'}>
                        {message.feedback === 'up'
                          ? t('aiActivity.feedbackUp')
                          : t('aiActivity.feedbackDown')}
                      </StatusBadge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )
        }
      </QueryState>
    </FormDialog>
  );
}

const conversationColumns: readonly Column<Conversation>[] = [
  {
    key: 'reference',
    header: t('aiActivity.reference'),
    cell: (row) => (
      <span className="flex flex-col gap-1">
        <code className="font-bold text-heading">{row.reference}</code>
        <span className="text-muted">{label('aiActivity.channels', row.channel)}</span>
      </span>
    ),
  },
  {
    key: 'account',
    header: t('aiActivity.account'),
    cell: (row) =>
      row.userId ? <code className="break-all">{row.userId}</code> : t('aiActivity.guest'),
  },
  {
    key: 'status',
    header: t('aiActivity.status'),
    cell: (row) => (
      <span className="flex flex-wrap gap-2">
        <StatusBadge tone={row.status === 'open' ? 'info' : 'neutral'}>
          {label('aiActivity.conversationStatuses', row.status)}
        </StatusBadge>
        {row.handedOver ? (
          <StatusBadge tone="warning">{t('aiActivity.handedOver')}</StatusBadge>
        ) : null}
      </span>
    ),
  },
  {
    key: 'messages',
    header: t('aiActivity.messages'),
    cell: (row) => format.number(row.messageCount),
  },
  {
    key: 'last',
    header: t('aiActivity.lastMessage'),
    cell: (row) => format.dateTime(row.lastMessageAt),
  },
  {
    key: 'actions',
    header: t('common.actions'),
    cell: (row) => <ConversationDialog conversation={row} />,
  },
];

function Conversations() {
  const pages = useCursorPages(['get', CONVERSATIONS], async (cursor) =>
    unwrap(
      await adminApi.GET(CONVERSATIONS, {
        params: { query: { limit: 30, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  return (
    <Section title={t('aiActivity.conversations')} intro={t('aiActivity.conversationsIntro')}>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) => (
          <>
            <DataTable
              caption={t('aiActivity.conversationsCaption')}
              rows={items}
              rowKey={(row) => row.id}
              columns={conversationColumns}
              empty={t('aiActivity.noConversations')}
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
          </>
        )}
      </QueryState>
    </Section>
  );
}

/**
 * What the assistant did (ADR-105, ADR-107): its runs with the tools each called, and
 * travellers' conversations with contact details removed. Reading needs `ai:read`; nothing
 * here changes anything, and opening a conversation is audited by the API.
 */
export function AiActivityPage() {
  return (
    <RequirePermission permission="ai:read">
      <div className="flex flex-col gap-6">
        <PageHeader title={t('aiActivity.title')} intro={t('aiActivity.intro')} />
        <Runs />
        <Conversations />
      </div>
    </RequirePermission>
  );
}
