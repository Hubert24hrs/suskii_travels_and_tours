'use client';

import { SUPPORT_CHANNELS, SUPPORT_PRIORITIES, SUPPORT_STATUSES } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  CheckboxField,
  DataTable,
  DetailList,
  PageHeader,
  ProblemAlert,
  QueryState,
  SelectField,
  StatusBadge,
  TextAreaField,
} from '../ui';

type Row = Schemas['AdminSupportConversationRow'];
type Conversation = Schemas['AdminSupportConversation'];
type Queue = 'active' | 'open' | 'waiting' | 'resolved';
type Assignee = 'any' | 'me' | 'unassigned';
type Priority = Row['priority'];
type Channel = Row['channel'];
type Delivery = NonNullable<Conversation['messages'][number]['delivery']>;

const LIST = '/v1/admin/support/conversations';
const DETAIL = '/v1/admin/support/conversations/{id}';
/** The inbox and an open conversation refresh this often, so new messages appear by themselves. */
const REFRESH_MS = 10_000;
const linkClass = 'font-body text-body-sm text-primary underline focus-visible:focus-ring';

const QUEUES = ['active', 'open', 'waiting', 'resolved'] as const satisfies readonly Queue[];
const ASSIGNEES = ['any', 'me', 'unassigned'] as const satisfies readonly Assignee[];

const priorityTone = (priority: Priority) =>
  priority === 'urgent' ? 'danger' : priority === 'prime' ? 'warning' : 'neutral';
const deliveryTone = (status: Delivery['status']) =>
  status === 'failed' ? 'danger' : status === 'pending' ? 'warning' : 'success';
const noticeClass =
  'rounded-lg border border-border bg-surface p-4 font-body text-body-sm text-foreground';
const slaTone = (state: Row['sla']['state']) =>
  state === 'breached' ? 'danger' : state === 'due_soon' ? 'warning' : 'success';
const statusTone = (status: Row['status']) =>
  status === 'open' ? 'info' : status === 'waiting' ? 'success' : 'neutral';

/** The due time that matters now: the reply owed, else the resolution. */
function Sla({ row }: { row: Row }) {
  if (row.status === 'resolved') return <span className="text-muted">{t('common.none')}</span>;
  const due = row.sla.responseDueAt
    ? t('support.replyDue', { time: format.dateTime(row.sla.responseDueAt) })
    : row.sla.resolutionDueAt
      ? t('support.resolutionDue', { time: format.dateTime(row.sla.resolutionDueAt) })
      : null;
  return (
    <span className="flex flex-col gap-1">
      <StatusBadge tone={slaTone(row.sla.state)}>{label('support.sla', row.sla.state)}</StatusBadge>
      {due ? <span className="text-muted">{due}</span> : null}
    </span>
  );
}

/** Support conversations (ADR-083): queues sorted by the nearest due time. */
export function SupportInboxPage() {
  const [queue, setQueue] = useState<Queue>('active');
  const [priority, setPriority] = useState<Priority | 'any'>('any');
  const [assignee, setAssignee] = useState<Assignee>('any');
  const [channel, setChannel] = useState<Channel | 'any'>('any');
  const pages = useCursorPages(['get', LIST, queue, priority, assignee, channel], async (cursor) =>
    unwrap(
      await adminApi.GET(LIST, {
        params: {
          query: {
            queue,
            assignee,
            limit: 50,
            ...(priority === 'any' ? {} : { priority }),
            ...(channel === 'any' ? {} : { channel }),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items);
  return (
    <RequirePermission permission="support:manage">
      <PageHeader title={t('support.title')} intro={t('support.intro')} />
      <div className="grid gap-4 md:grid-cols-4">
        <SelectField
          label={t('support.queue')}
          name="queue"
          value={queue}
          onChange={(event) => setQueue(event.target.value as Queue)}
          options={QUEUES.map((value) => ({ value, label: label('support.queues', value) }))}
        />
        <SelectField
          label={t('support.priority')}
          name="priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority | 'any')}
          options={[
            { value: 'any', label: t('support.anyPriority') },
            ...SUPPORT_PRIORITIES.map((value) => ({
              value,
              label: label('support.priorities', value),
            })),
          ]}
        />
        <SelectField
          label={t('support.assignee')}
          name="assignee"
          value={assignee}
          onChange={(event) => setAssignee(event.target.value as Assignee)}
          options={ASSIGNEES.map((value) => ({ value, label: label('support.assignees', value) }))}
        />
        <SelectField
          label={t('support.channel')}
          name="channel"
          value={channel}
          onChange={(event) => setChannel(event.target.value as Channel | 'any')}
          options={[
            { value: 'any', label: t('support.anyChannel') },
            ...SUPPORT_CHANNELS.map((value) => ({
              value,
              label: label('support.channels', value),
            })),
          ]}
        />
      </div>
      <QueryState query={{ ...pages, data: rows }}>
        {(items) =>
          items.length === 0 ? (
            <p className="font-body text-body text-muted">{t('support.empty')}</p>
          ) : (
            <>
              <DataTable
                caption={t('support.title')}
                rows={items}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'reference',
                    header: t('support.reference'),
                    cell: (row) => (
                      <Link
                        href={`/support/${row.id}` as Route}
                        className={linkClass}
                        aria-label={t('support.openFor', { reference: row.reference })}
                      >
                        {row.reference}
                      </Link>
                    ),
                  },
                  {
                    key: 'customer',
                    header: t('support.customer'),
                    cell: (row) => (
                      <span className="flex flex-col">
                        <span>{row.customer.label}</span>
                        <span className="text-muted">
                          {label('support.channels', row.channel)}
                          {row.customer.guest && row.channel !== 'whatsapp'
                            ? ` · ${t('support.guest')}`
                            : ''}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'category',
                    header: t('support.category'),
                    cell: (row) => label('support.categories', row.category),
                  },
                  {
                    key: 'priority',
                    header: t('support.priority'),
                    cell: (row) => (
                      <StatusBadge tone={priorityTone(row.priority)}>
                        {label('support.priorities', row.priority)}
                      </StatusBadge>
                    ),
                  },
                  { key: 'due', header: t('support.due'), cell: (row) => <Sla row={row} /> },
                  {
                    key: 'status',
                    header: t('common.status'),
                    cell: (row) => (
                      <span className="flex flex-col gap-1">
                        <StatusBadge tone={statusTone(row.status)}>
                          {label('support.statuses', row.status)}
                        </StatusBadge>
                        {row.awaitingReply ? (
                          <span className="text-muted">{t('support.awaitingReply')}</span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    key: 'assignee',
                    header: t('support.assignee'),
                    cell: (row) => row.assignee?.name ?? t('support.unassigned'),
                  },
                  {
                    key: 'last',
                    header: t('support.lastMessage'),
                    cell: (row) =>
                      format.dateTime(row.lastStaffMessageAt ?? row.lastCustomerMessageAt),
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
            </>
          )
        }
      </QueryState>
    </RequirePermission>
  );
}

function useRefreshSupport() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['get', DETAIL] });
    await queryClient.invalidateQueries({ queryKey: ['get', LIST] });
  };
}

/** Status, priority and assignee, each applied as soon as it changes (audited). */
function Controls({ conversation }: { conversation: Conversation }) {
  const { toast } = useToast();
  const refresh = useRefreshSupport();
  const agents = $api.useQuery('get', '/v1/admin/support/agents');
  const update = $api.useMutation('patch', DETAIL, {
    onSuccess: async () => {
      toast({ title: t('support.updated'), variant: 'success' });
      await refresh();
    },
  });
  const change = (body: Schemas['AdminSupportUpdateRequestInput']) =>
    update.mutate({ params: { path: { id: conversation.id } }, body });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          label={t('support.status')}
          name="status"
          value={conversation.status}
          disabled={update.isPending}
          onChange={(event) => change({ status: event.target.value as Row['status'] })}
          options={SUPPORT_STATUSES.map((value) => ({
            value,
            label: label('support.statuses', value),
          }))}
        />
        <SelectField
          label={t('support.priority')}
          name="priority"
          value={conversation.priority}
          disabled={update.isPending}
          onChange={(event) => change({ priority: event.target.value as Priority })}
          options={SUPPORT_PRIORITIES.map((value) => ({
            value,
            label: label('support.priorities', value),
          }))}
        />
        <SelectField
          label={t('support.assignee')}
          name="assigneeId"
          value={conversation.assignee?.id ?? ''}
          disabled={update.isPending || !agents.data}
          onChange={(event) => change({ assigneeId: event.target.value || null })}
          options={[
            { value: '', label: t('support.unassigned') },
            ...(agents.data?.agents ?? []).map((agent) => ({ value: agent.id, label: agent.name })),
          ]}
        />
      </div>
      <ProblemAlert error={update.error} />
    </div>
  );
}

function ReplyForm({ conversation }: { conversation: Conversation }) {
  const { toast } = useToast();
  const refresh = useRefreshSupport();
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const reply = $api.useMutation('post', '/v1/admin/support/conversations/{id}/messages', {
    onSuccess: async (_, variables) => {
      setMessage('');
      setInternal(false);
      toast({
        title: variables.body.internal ? t('support.noted') : t('support.replied'),
        variant: 'success',
      });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    reply.mutate({ params: { path: { id: conversation.id } }, body: { message, internal } });
  };
  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-3">
      <TextAreaField
        label={t('support.message')}
        name="message"
        value={message}
        required
        maxLength={2_000}
        rows={4}
        onChange={(event) => setMessage(event.target.value)}
      />
      <CheckboxField
        label={t('support.internalToggle')}
        name="internal"
        checked={internal}
        onChange={(event) => setInternal(event.target.checked)}
      />
      <ProblemAlert error={reply.error} />
      <div>
        <Button type="submit" loading={reply.isPending}>
          {t('support.send')}
        </Button>
      </div>
    </form>
  );
}

/** Whether staff can write freely on WhatsApp now, or why a reply will not go (ADR-084). */
function WhatsAppState({ whatsapp }: { whatsapp: NonNullable<Conversation['whatsapp']> }) {
  const text = !whatsapp.reachable
    ? t('support.whatsapp.unreachable')
    : whatsapp.windowClosesAt
      ? t('support.whatsapp.windowOpen', { time: format.dateTime(whatsapp.windowClosesAt) })
      : whatsapp.optedOut
        ? t('support.whatsapp.optedOut')
        : t('support.whatsapp.windowClosed');
  return (
    <p role="status" className={noticeClass} data-testid="support-whatsapp-state">
      {text}
    </p>
  );
}

function DeliveryState({ delivery }: { delivery: Delivery }) {
  return (
    <p className="flex flex-wrap items-center gap-2 pt-2 font-body text-body-sm text-muted">
      <StatusBadge tone={deliveryTone(delivery.status)}>
        {label('support.delivery', delivery.status)}
      </StatusBadge>
      {delivery.status === 'pending' && delivery.noticeSentAt ? (
        <span>
          {t('support.waitingForWindow', { time: format.dateTime(delivery.noticeSentAt) })}
        </span>
      ) : null}
      {delivery.error ? <span>{t('support.deliveryError', { code: delivery.error })}</span> : null}
    </p>
  );
}

/** One conversation: details, controls, the whole thread with internal notes, and a reply box. */
export function SupportConversationPage({ conversationId }: { conversationId: string }) {
  const { can } = useStaffSession();
  const query = $api.useQuery(
    'get',
    DETAIL,
    { params: { path: { id: conversationId } } },
    { refetchInterval: REFRESH_MS },
  );
  return (
    <RequirePermission permission="support:manage">
      <QueryState query={query}>
        {(conversation) => (
          <div className="flex flex-col gap-6">
            <PageHeader
              title={`${t('support.title')}: ${conversation.reference}`}
              intro={label('support.categories', conversation.category)}
            />
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={priorityTone(conversation.priority)}>
                {label('support.priorities', conversation.priority)}
              </StatusBadge>
              <Sla row={conversation} />
            </div>
            <DetailList
              items={[
                {
                  term: t('support.customer'),
                  value: conversation.customer.guest
                    ? `${conversation.customer.label} (${t('support.guest')})`
                    : conversation.customer.label,
                },
                {
                  term: t('support.booking'),
                  value: conversation.booking ? (
                    can('bookings:read') ? (
                      <Link
                        href={`/bookings/${conversation.booking.id}` as Route}
                        className={linkClass}
                      >
                        {conversation.booking.reference}
                      </Link>
                    ) : (
                      <code>{conversation.booking.reference}</code>
                    )
                  ) : (
                    t('common.none')
                  ),
                },
                {
                  term: t('support.channel'),
                  value: label('support.channels', conversation.channel),
                },
                {
                  term: t('support.messages', { count: conversation.messageCount }),
                  value: format.dateTime(conversation.createdAt),
                },
              ]}
            />
            {conversation.whatsapp ? <WhatsAppState whatsapp={conversation.whatsapp} /> : null}
            <Controls conversation={conversation} />
            <ol className="flex flex-col gap-3" aria-label={t('support.title')}>
              {conversation.messages.map((message) => (
                <li
                  key={message.id}
                  className={
                    message.internal
                      ? 'rounded-lg border border-dashed border-border-strong bg-surface p-4'
                      : message.author === 'customer'
                        ? 'me-12 rounded-lg border border-border bg-surface p-4'
                        : 'ms-12 rounded-lg bg-primary-subtle p-4'
                  }
                  data-testid={message.internal ? 'support-note' : `support-${message.author}`}
                >
                  <p className="font-body text-body-sm font-bold text-foreground">
                    {message.internal
                      ? t('support.internal')
                      : label('support.from', message.author)}
                    {message.staff ? ` · ${message.staff.name}` : ''}{' '}
                    <span className="font-regular text-muted">
                      {format.dateTime(message.createdAt)}
                    </span>
                  </p>
                  <p className="font-body text-body whitespace-pre-wrap text-foreground">
                    {message.kind === 'unsupported'
                      ? t('support.unsupported', { type: message.text })
                      : message.text}
                  </p>
                  {message.delivery ? <DeliveryState delivery={message.delivery} /> : null}
                </li>
              ))}
            </ol>
            <ReplyForm conversation={conversation} />
            <Link href={'/support'} className={linkClass}>
              {t('support.back')}
            </Link>
          </div>
        )}
      </QueryState>
    </RequirePermission>
  );
}
