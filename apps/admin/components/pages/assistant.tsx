'use client';

import { AGENT_MESSAGE_MAX, DEFAULT_LOCALE } from '@suskii/shared';
import { Button } from '@suskii/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { unwrap } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import { PageHeader, ProblemAlert, Section, TextAreaField } from '../ui';

type Message = Schemas['AgentMessage'];

const CONVERSATION = '/v1/admin/ai/conversations/{conversationId}';
/** How often the conversation is read while an answer is on its way. */
const POLL_MS = 1500;

function Cards({ cards }: { cards: Message['cards'] }) {
  if (cards.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {cards.map((card, index) => (
        <li
          key={`${card.title}-${index}`}
          className="flex flex-col gap-1 rounded-md border border-border p-3"
        >
          <span className="font-body text-body-sm font-bold text-heading">{card.title}</span>
          {card.lines.map((line) => (
            <span key={line} className="font-body text-body-sm text-foreground">
              {line}
            </span>
          ))}
          {card.price ? (
            <span className="font-body text-body-sm text-foreground">
              {format.money(card.price)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function MessageItem({ message }: { message: Message }) {
  const mine = message.role === 'user';
  // What the assistant says without a model is a code: the words are the console's.
  const text = message.notice ? label('assistant.notices', message.notice) : message.text;
  return (
    <li className="flex flex-col gap-1" data-testid={`message-${message.role}`}>
      <p className="font-body text-caption text-muted">
        {mine
          ? t('assistant.you')
          : message.agent
            ? label('ai.agents', message.agent)
            : t('ai.title')}
        {' · '}
        {format.dateTime(message.createdAt)}
      </p>
      <p className="whitespace-pre-wrap font-body text-body-sm text-foreground">{text}</p>
      <Cards cards={message.cards} />
    </li>
  );
}

/**
 * The staff agents in the console (ADR-107). A staff member asks; the agents their own
 * permissions open answer from what that person may read. Nothing an agent prepares happens
 * here: it waits in Approvals for someone else.
 */
export function StaffAssistantPage() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const conversation = $api.useQuery(
    'get',
    CONVERSATION,
    { params: { path: { conversationId: conversationId ?? '' } } },
    {
      enabled: conversationId !== null,
      // The answer arrives in the background: read again while a run is answering.
      refetchInterval: (query) => (query.state.data?.activeRunId ? POLL_MS : false),
    },
  );
  const ask = useMutation({
    mutationFn: async (question: string) => {
      let id = conversationId;
      if (!id) {
        const started = unwrap(
          await adminApi.POST('/v1/admin/ai/conversations', { body: { locale: DEFAULT_LOCALE } }),
        );
        id = started.id;
        setConversationId(id);
      }
      return unwrap(
        await adminApi.POST('/v1/admin/ai/chat', { body: { conversationId: id, text: question } }),
      );
    },
    onSuccess: async () => {
      setText('');
      // The first read of a new conversation starts before the message is stored and can still
      // be on its way. A refetch would wait for that read instead of making a new one, and its
      // "nothing running" would stop the polling before the answer arrives. Drop it, then read
      // again: this read starts after the message and its run exist.
      await queryClient.cancelQueries({ queryKey: ['get', CONVERSATION] });
      await queryClient.invalidateQueries({ queryKey: ['get', CONVERSATION] });
    },
  });
  const messages = conversationId ? (conversation.data?.messages ?? []) : [];
  const working = ask.isPending || Boolean(conversationId && conversation.data?.activeRunId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim();
    if (question && !working) ask.mutate(question);
  };
  return (
    <RequirePermission permission="ai:read">
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('assistant.title')}
          intro={t('assistant.intro')}
          actions={
            conversationId ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setConversationId(null);
                  ask.reset();
                }}
              >
                {t('assistant.newConversation')}
              </Button>
            ) : undefined
          }
        />
        <Section title={t('assistant.conversation')} intro={t('assistant.approvalsHint')}>
          <Link
            href="/approvals"
            className="inline-flex min-h-6 items-center self-start font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring"
          >
            {t('assistant.openApprovals')}
          </Link>
          {messages.length === 0 ? (
            <p className="font-body text-body-sm text-muted">{t('assistant.empty')}</p>
          ) : (
            // A live log around a plain list: the list keeps its semantics, and what arrives is
            // announced.
            <div role="log" aria-label={t('assistant.conversation')}>
              <ol className="flex flex-col gap-4">
                {messages.map((message) => (
                  <MessageItem key={message.id} message={message} />
                ))}
              </ol>
            </div>
          )}
          {working ? (
            <p role="status" className="font-body text-body-sm text-muted">
              {t('assistant.working')}
            </p>
          ) : null}
          <form method="post" onSubmit={submit} className="flex flex-col gap-4">
            <TextAreaField
              label={t('assistant.message')}
              hint={t('assistant.messageHint')}
              name="text"
              value={text}
              maxLength={AGENT_MESSAGE_MAX}
              rows={3}
              required
              onChange={(event) => setText(event.target.value)}
            />
            <ProblemAlert error={ask.error} />
            <div>
              <Button type="submit" loading={ask.isPending} disabled={working}>
                {t('assistant.send')}
              </Button>
            </div>
          </form>
        </Section>
      </div>
    </RequirePermission>
  );
}
