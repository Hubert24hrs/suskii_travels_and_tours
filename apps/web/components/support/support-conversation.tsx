'use client';

import { useFormatters } from '@suskii/i18n/react';
import { SUPPORT_MESSAGE_MAX } from '@suskii/shared/lite';
import { Badge, Button, Card } from '@suskii/ui-web';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { adoptSupportLink, supportHeaders } from '../../lib/support-token';
import { AppLink } from '../app-link';

import { SUPPORT_TEXTAREA } from './support-start';
import { useSupportT } from './use-support-t';

type Conversation = Schemas['SupportConversation'];
type Message = Conversation['messages'][number];

/** How often an open, visible conversation asks for new messages (ADR-083). */
const POLL_MS = 4_000;

export const STATUS_VARIANT = { open: 'info', waiting: 'success', resolved: 'neutral' } as const;

/**
 * One support conversation (ADR-083): the thread, a reply box and "Mark as solved". While the
 * tab is visible it asks every few seconds for messages after the last one it has, and marks
 * staff replies as read.
 */
export function SupportConversation({ conversationId }: { conversationId: string }) {
  const { t } = useSupportT();
  const format = useFormatters();
  const replyId = useId();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [missing, setMissing] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef<string | null>(null);

  const remember = (next: Conversation) => {
    lastId.current = next.messages.at(-1)?.id ?? lastId.current;
    setConversation(next);
  };

  useEffect(() => {
    let cancelled = false;
    adoptSupportLink(conversationId);
    const api = browserApi();
    const options = {
      params: { path: { conversationId } },
      headers: supportHeaders(conversationId),
    };
    api
      .GET('/v1/support/conversations/{conversationId}', options)
      .then(async ({ data }) => {
        if (cancelled) return;
        if (!data) {
          setMissing(true);
          return;
        }
        lastId.current = data.messages.at(-1)?.id ?? null;
        setConversation(data);
        if (data.unread) {
          const read = await api.PUT('/v1/support/conversations/{conversationId}/read', options);
          if (!cancelled && read.data) setConversation(read.data);
        }
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || lastId.current === null) return;
      api
        .GET('/v1/support/conversations/{conversationId}', {
          ...options,
          params: { ...options.params, query: { after: lastId.current } },
        })
        .then(async ({ data }) => {
          if (cancelled || !data || data.messages.length === 0) return;
          lastId.current = data.messages.at(-1)?.id ?? lastId.current;
          setConversation((current) =>
            current ? { ...data, messages: [...current.messages, ...data.messages] } : data,
          );
          if (data.unread)
            await api.PUT('/v1/support/conversations/{conversationId}/read', options);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversationId]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await browserApi().POST(
        '/v1/support/conversations/{conversationId}/messages',
        {
          params: { path: { conversationId } },
          headers: supportHeaders(conversationId),
          body: { message: reply },
        },
      );
      if (data) {
        remember(data);
        setReply('');
        return;
      }
      setError(
        problemSlug(problem) === 'support-conversation-full'
          ? t('support.errors.full')
          : t('support.errors.generic'),
      );
    } catch {
      setError(t('support.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    const { data } = await browserApi().POST('/v1/support/conversations/{conversationId}/resolve', {
      params: { path: { conversationId } },
      headers: supportHeaders(conversationId),
    });
    if (data) remember(data);
  };

  if (missing) {
    return (
      <Card className="p-6" data-testid="support-missing">
        <p className="font-body text-body text-foreground">{t('support.conversation.notFound')}</p>
      </Card>
    );
  }
  if (!conversation) return <Card className="min-h-20 p-6" aria-busy="true" />;

  const author = (message: Message): string =>
    message.author === 'customer'
      ? t('support.conversation.you')
      : message.author === 'staff'
        ? t('support.conversation.staff')
        : message.author === 'assistant'
          ? t('support.conversation.assistant')
          : t('support.conversation.system');

  return (
    <section className="flex flex-col gap-4" data-testid="support-conversation">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {t('support.conversation.title', { reference: conversation.reference })}
        </h1>
        <Badge variant={STATUS_VARIANT[conversation.status]} data-testid="support-status">
          {t(`support.status.${conversation.status}`)}
        </Badge>
      </div>
      <ol className="flex flex-col gap-3" aria-live="polite">
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={
              message.author === 'customer'
                ? 'ms-12 rounded-lg bg-primary-subtle p-4'
                : 'me-12 rounded-lg border border-border bg-surface p-4'
            }
            data-testid={`support-message-${message.author}`}
          >
            <p className="font-body text-body-sm font-bold text-foreground">
              {author(message)}{' '}
              <span className="font-regular text-muted" suppressHydrationWarning>
                {format.dateTime(message.createdAt)}
              </span>
            </p>
            <p className="font-body text-body whitespace-pre-wrap text-foreground">
              {message.kind === 'handover' ? t('support.conversation.handover') : message.text}
            </p>
            {message.author === 'assistant' && message.kind !== 'handover' ? (
              <p className="pt-2 font-body text-body-sm text-muted">
                {t('support.conversation.assistantNote')}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {conversation.status === 'resolved' ? (
        <p className="font-body text-body-sm text-muted">{t('support.conversation.resolved')}</p>
      ) : null}
      <form method="post" className="flex flex-col gap-3" onSubmit={(event) => void send(event)}>
        <label htmlFor={replyId} className="font-body text-body-sm font-medium text-foreground">
          {t('support.conversation.reply')}
        </label>
        <textarea
          id={replyId}
          name="message"
          value={reply}
          required
          maxLength={SUPPORT_MESSAGE_MAX}
          onChange={(event) => setReply(event.target.value)}
          className={SUPPORT_TEXTAREA}
          data-testid="support-reply"
        />
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy} data-testid="support-send">
            {t('support.conversation.send')}
          </Button>
          {conversation.status === 'resolved' ? null : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void resolve()}
              data-testid="support-resolve"
            >
              {t('support.conversation.resolve')}
            </Button>
          )}
        </div>
      </form>
      <AppLink href="/support" className="font-body text-body-sm text-primary underline">
        {t('support.conversation.back')}
      </AppLink>
    </section>
  );
}
