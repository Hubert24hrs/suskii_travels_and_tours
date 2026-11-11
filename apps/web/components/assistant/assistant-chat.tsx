'use client';

import { useFormatters } from '@suskii/i18n/react';
import { AGENT_MESSAGE_MAX, isAgentCardNote, isAgentMemoryKey } from '@suskii/shared/lite';
import { Badge, Button, Card } from '@suskii/ui-web';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import {
  agentHeaders,
  currentConversation,
  rememberConversation,
  saveAgentToken,
} from '../../lib/agent-chat';
import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { randomUuid } from '../../lib/random-uuid';
import { hasSession } from '../../lib/session';
import { useHydrated } from '../../lib/use-hydrated';
import { useTurnstile } from '../account/use-turnstile';
import { AppLink } from '../app-link';

import { memoryValueText } from './memory-text';
import { useAssistantT } from './use-assistant-t';

type Conversation = Schemas['AgentConversation'];
type Message = Schemas['AgentMessage'];
type CardData = Message['cards'][number];
type Confirmation = Schemas['AgentConfirmation'];

/** How often a conversation is read again while the assistant is answering. */
const POLL_MS = 1_500;
/** A run ends within the API's own limit; past this the chat stops asking and offers a retry. */
const POLL_LIMIT = 120;

const TEXTAREA =
  'min-h-20 w-full rounded-md border border-border-strong bg-surface px-4 py-3 font-body text-body text-foreground focus-visible:focus-ring';

/** What a confirmation does, in words: the API names the tool, the catalog says it. */
const ACTION_LABELS = {
  'bookings.cancel': 'assistant.confirm.actions.bookings_cancel',
  'changes.accept': 'assistant.confirm.actions.changes_accept',
  'changes.take_refund_offer': 'assistant.confirm.actions.changes_take_refund_offer',
  'alerts.watch': 'assistant.confirm.actions.alerts_watch',
  'alerts.stop': 'assistant.confirm.actions.alerts_stop',
  'memory.remember': 'assistant.confirm.actions.memory_remember',
} as const;
const actionLabel = (action: string) =>
  action in ACTION_LABELS
    ? ACTION_LABELS[action as keyof typeof ACTION_LABELS]
    : 'assistant.confirm.actions.fallback';

function ResultCard({ card }: { card: CardData }) {
  const { t } = useAssistantT();
  const format = useFormatters();
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3">
      {card.kind === 'source' ? (
        <span className="font-body text-caption text-muted">{t('assistant.cards.source')}</span>
      ) : null}
      <span className="font-body text-body-sm font-bold text-heading">{card.title}</span>
      {card.lines.map((line) => (
        <span key={line} className="font-body text-body-sm text-foreground">
          {line}
        </span>
      ))}
      {card.price ? (
        <span className="font-body text-body font-bold text-heading" suppressHydrationWarning>
          {format.money(card.price)}
        </span>
      ) : null}
      {card.indicative ? (
        <>
          <Badge variant="warning">{t('assistant.cards.indicative')}</Badge>
          <span className="font-body text-caption text-muted">
            {t('assistant.cards.indicativeNote')}
          </span>
        </>
      ) : null}
      {card.href ? (
        <AppLink
          href={card.href}
          className="inline-flex min-h-6 items-center font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring"
        >
          {t('assistant.cards.view')}
        </AppLink>
      ) : null}
    </li>
  );
}

/**
 * What an answer is read with (ADR-107): the API sends a code with the facts that need it, and
 * the words are the catalog's, in the traveller's language, whatever the assistant wrote. A
 * code this build does not know is left out.
 */
function Notes({ cards }: { cards: readonly CardData[] }) {
  const { t } = useAssistantT();
  const codes = cards.flatMap((card) =>
    card.kind === 'note' && isAgentCardNote(card.title) ? [card.title] : [],
  );
  if (codes.length === 0) return null;
  return (
    <div
      role="note"
      data-testid="assistant-notes"
      className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3"
    >
      <span className="font-body text-caption font-bold text-heading">
        {t('assistant.notes.label')}
      </span>
      {codes.map((code) => (
        <p
          key={code}
          data-testid={`assistant-note-${code}`}
          className="font-body text-body-sm text-foreground"
        >
          {t(`assistant.notes.${code}`)}
        </p>
      ))}
    </div>
  );
}

/**
 * What the assistant prepared, for the traveller to decide (ADR-107). The card is read from
 * the API, which built it from its own records; nothing changes until Confirm is pressed, and
 * the press goes to the API with the traveller's own session.
 */
function ConfirmationCard({
  confirmationId,
  onDecided,
}: {
  confirmationId: string;
  onDecided: () => void;
}) {
  const { t } = useAssistantT();
  const format = useFormatters();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    browserApi()
      .GET('/v1/agent/confirmations/{confirmationId}', { params: { path: { confirmationId } } })
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setConfirmation(data);
        // Only the signed-in owner of the conversation may read or decide one.
        else setLocked(true);
      })
      .catch(() => {
        if (!cancelled) setLocked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [confirmationId]);

  const decide = async (decision: 'confirm' | 'decline') => {
    setBusy(true);
    setFailed(false);
    try {
      const { data } = await browserApi().POST(
        decision === 'confirm'
          ? '/v1/agent/confirmations/{confirmationId}/confirm'
          : '/v1/agent/confirmations/{confirmationId}/decline',
        {
          params: {
            path: { confirmationId },
            header: { 'Idempotency-Key': randomUuid() },
          },
        },
      );
      if (!data) {
        setFailed(true);
        return;
      }
      setConfirmation(data.confirmation);
      onDecided();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (locked) {
    return (
      <p className="font-body text-body-sm text-muted" data-testid="assistant-confirmation">
        {t('assistant.confirm.signIn')}
      </p>
    );
  }
  if (!confirmation) return null;
  const { card, status } = confirmation;
  const remembered =
    confirmation.action === 'memory.remember' && isAgentMemoryKey(card.title) ? card.title : null;
  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="assistant-confirmation">
      <span className="font-body text-caption font-bold text-muted">
        {t('assistant.confirm.heading')}
      </span>
      <span className="font-body text-body font-bold text-heading">
        {t(actionLabel(confirmation.action))}
      </span>
      {remembered ? (
        // A preference to remember (ADR-105): its name and its value, in the traveller's words.
        <span className="font-body text-body-sm font-bold text-foreground">
          {t(`assistant.memory.keys.${remembered}`)}
          {': '}
          {memoryValueText(t, remembered, card.lines[0] ?? '')}
        </span>
      ) : (
        <>
          <span className="font-body text-body-sm font-bold text-foreground">{card.title}</span>
          {card.lines.map((line) => (
            <span key={line} className="font-body text-body-sm text-foreground">
              {line}
            </span>
          ))}
        </>
      )}
      {card.amounts.length > 0 ? (
        <dl className="flex flex-col gap-1">
          {card.amounts.map((entry) => (
            <div key={entry.code} className="flex flex-wrap justify-between gap-2">
              <dt className="font-body text-body-sm text-muted">
                {t(`assistant.confirm.amounts.${entry.code}`)}
              </dt>
              <dd className="font-body text-body-sm font-bold text-heading">
                {format.money(entry.amount)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {status === 'pending' ? (
        <>
          <p className="font-body text-caption text-muted">
            {t('assistant.confirm.note')}{' '}
            {t('assistant.confirm.until', { time: format.dateTime(confirmation.expiresAt) })}
          </p>
          {failed ? (
            <p role="alert" className="font-body text-body-sm text-danger">
              {t('assistant.confirm.statuses.failed')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              loading={busy}
              onClick={() => void decide('confirm')}
              data-testid="assistant-confirm"
            >
              {t('assistant.confirm.confirm')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void decide('decline')}
              data-testid="assistant-decline"
            >
              {t('assistant.confirm.decline')}
            </Button>
          </div>
        </>
      ) : (
        <p role="status" className="font-body text-body-sm text-foreground">
          {remembered && status === 'confirmed'
            ? t('assistant.memory.remembered')
            : t(`assistant.confirm.statuses.${status}`)}
        </p>
      )}
    </Card>
  );
}

function Feedback({ message, headers }: { message: Message; headers: Record<string, string> }) {
  const { t } = useAssistantT();
  const [given, setGiven] = useState(message.feedback);
  const send = (feedback: 'up' | 'down') => {
    setGiven(feedback);
    void browserApi()
      .PUT('/v1/agent/messages/{messageId}/feedback', {
        params: { path: { messageId: message.id } },
        headers,
        body: { feedback },
      })
      .catch(() => undefined);
  };
  if (given) {
    return (
      <span role="status" className="font-body text-caption text-muted">
        {t('assistant.feedback.thanks')}
      </span>
    );
  }
  const button =
    'inline-flex min-h-6 items-center font-body text-caption text-muted underline hover:text-primary focus-visible:focus-ring';
  return (
    <span className="flex flex-wrap gap-4">
      <button type="button" className={button} onClick={() => send('up')}>
        {t('assistant.feedback.up')}
      </button>
      <button type="button" className={button} onClick={() => send('down')}>
        {t('assistant.feedback.down')}
      </button>
    </span>
  );
}

const SCORES = [1, 2, 3, 4, 5] as const;

/**
 * How well the assistant helped, out of five (ADR-106): asked once the assistant has answered,
 * answered with one press, and changeable. The score goes to the people who improve it.
 */
function Rating({
  conversation,
  headers,
}: {
  conversation: Conversation;
  headers: Record<string, string>;
}) {
  const { t } = useAssistantT();
  const [score, setScore] = useState<number | null>(conversation.rating ?? null);
  const rate = (value: number) => {
    setScore(value);
    void browserApi()
      .PUT('/v1/agent/conversations/{conversationId}/rating', {
        params: { path: { conversationId: conversation.id } },
        headers,
        body: { score: value },
      })
      .catch(() => undefined);
  };
  return (
    <div className="flex flex-col gap-2" data-testid="assistant-rating">
      <span id="assistant-rating-label" className="font-body text-body-sm text-foreground">
        {t('assistant.rating.question')}
      </span>
      <div role="radiogroup" aria-labelledby="assistant-rating-label" className="flex gap-2">
        {SCORES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={score === value}
            aria-label={t('assistant.rating.score', { score: value })}
            data-testid={`assistant-rating-${String(value)}`}
            className={
              score === value
                ? 'inline-flex size-12 items-center justify-center rounded-md bg-primary font-body text-body font-bold text-on-primary focus-visible:focus-ring'
                : 'inline-flex size-12 items-center justify-center rounded-md border border-border-strong font-body text-body text-foreground hover:border-primary focus-visible:focus-ring'
            }
            onClick={() => rate(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {score ? (
        <span role="status" className="font-body text-caption text-muted">
          {t('assistant.rating.thanks')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The traveller's chat with the assistant (ADR-101, ADR-107). Nothing is sent, and no
 * conversation is started, before the first message. While the assistant answers, the
 * conversation is read again every moment; answers, notices (shown in the traveller's
 * language from their code), result cards and a confirmation card come from the API as it
 * stored them. A person is always one link away.
 */
export function AssistantChat({
  locale,
  turnstileSiteKey,
  conversationId: initial,
}: {
  locale: string;
  turnstileSiteKey: string;
  /** Open this conversation (the history page); otherwise the one this tab has, if any. */
  conversationId?: string;
}) {
  const { t } = useAssistantT();
  const signedIn = useHydrated() && hasSession();
  const inputId = useId();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const logEnd = useRef<HTMLDivElement | null>(null);
  const {
    containerRef: turnstileRef,
    ensure: ensureHuman,
    reset: resetTurnstile,
    currentToken,
  } = useTurnstile(turnstileSiteKey, 'agent', () => setError(t('assistant.errors.human')));

  const read = useCallback(async (id: string): Promise<Conversation | null> => {
    const { data } = await browserApi().GET('/v1/agent/conversations/{conversationId}', {
      params: { path: { conversationId: id } },
      headers: agentHeaders(id),
    });
    return data ?? null;
  }, []);

  /** Reads the conversation until no run is answering, showing each new message as it lands. */
  const follow = useCallback(
    async (id: string) => {
      setAnswering(true);
      try {
        for (let attempt = 0; attempt < POLL_LIMIT && !cancelled.current; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (cancelled.current) return;
          const next = await read(id).catch(() => null);
          if (!next) continue;
          setConversation(next);
          if (next.activeRunId === null) return;
        }
        if (!cancelled.current) setError(t('assistant.notices.timeout'));
      } finally {
        if (!cancelled.current) setAnswering(false);
      }
    },
    [read, t],
  );

  useEffect(() => {
    cancelled.current = false;
    const id = initial ?? currentConversation();
    if (id) {
      read(id)
        .then((found) => {
          if (cancelled.current) return;
          if (!found) {
            // Closed, deleted or another person's: this tab starts afresh.
            if (!initial) rememberConversation(null);
            else setError(t('assistant.errors.gone'));
            return;
          }
          setConversation(found);
          if (found.activeRunId) void follow(id);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled.current = true;
    };
  }, [initial, read, follow, t]);

  const messageCount = conversation?.messages.length ?? 0;
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [messageCount, answering]);

  const start = async (): Promise<Conversation | null> => {
    const turnstileToken = signedIn ? null : currentToken();
    if (!signedIn && !turnstileToken) {
      ensureHuman();
      setError(t('assistant.errors.human'));
      return null;
    }
    const { data, error: problem } = await browserApi().POST('/v1/agent/conversations', {
      body: { locale: locale as never, turnstileToken },
    });
    if (!data) {
      resetTurnstile();
      setError(
        problemSlug(problem) === 'bot-check-failed'
          ? t('assistant.errors.human')
          : t('assistant.errors.start'),
      );
      return null;
    }
    if (data.accessToken) saveAgentToken(data.conversation.id, data.accessToken);
    rememberConversation(data.conversation.id);
    setConversation(data.conversation);
    return data.conversation;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (!words || busy || answering) return;
    setBusy(true);
    setError(null);
    try {
      const open = conversation ?? (await start());
      if (!open) return;
      const { data, error: problem } = await browserApi().POST('/v1/agent/chat', {
        headers: agentHeaders(open.id),
        body: { conversationId: open.id, text: words },
      });
      if (!data) {
        const slug = problemSlug(problem);
        setError(
          slug === 'agent-busy'
            ? t('assistant.errors.busy')
            : slug === 'agent-conversation-full' || slug === 'agent-conversation-closed'
              ? t('assistant.errors.full')
              : slug === 'agent-paused'
                ? t('assistant.notices.paused')
                : slug === 'agent-budget'
                  ? t('assistant.notices.limit')
                  : slug === 'agent-unavailable'
                    ? t('assistant.notices.unavailable')
                    : t('assistant.errors.send'),
        );
        return;
      }
      setText('');
      setConversation((current) =>
        current ? { ...current, messages: [...current.messages, data.message] } : current,
      );
      void follow(open.id);
    } catch {
      setError(t('assistant.errors.send'));
    } finally {
      setBusy(false);
    }
  };

  const startAgain = () => {
    rememberConversation(null);
    setConversation(null);
    setError(null);
  };

  const messages = conversation?.messages ?? [];
  const headers = conversation ? agentHeaders(conversation.id) : {};
  const closed = conversation?.status === 'closed';
  return (
    <div className="flex flex-col gap-4" data-testid="assistant-chat">
      <p className="font-body text-body-sm text-muted">{t('assistant.disclosure')}</p>
      <div
        role="log"
        aria-label={t('assistant.title')}
        aria-live="polite"
        className="flex flex-col gap-3"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2 rounded-md bg-background p-3">
            <span className="font-body text-body-sm font-bold text-heading">
              {t('assistant.notices.greeting')}
            </span>
            <span className="font-body text-body-sm text-foreground">{t('assistant.intro')}</span>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((message) => (
              <li
                key={message.id}
                data-testid={`assistant-message-${message.role}`}
                className={
                  message.role === 'user'
                    ? 'flex flex-col gap-1 rounded-md border border-border p-3'
                    : 'flex flex-col gap-2 rounded-md bg-background p-3'
                }
              >
                <span className="font-body text-caption font-bold text-muted">
                  {message.role === 'user' ? t('assistant.you') : t('assistant.name')}
                </span>
                {message.notice ? (
                  <p className="font-body text-body-sm text-foreground">
                    {t(`assistant.notices.${message.notice}`)}
                  </p>
                ) : (
                  <p className="font-body text-body-sm whitespace-pre-wrap text-foreground">
                    {message.text}
                  </p>
                )}
                {message.kind === 'handover' ? (
                  <p className="font-body text-body-sm text-foreground">
                    {t('assistant.handover')}{' '}
                    <AppLink
                      href="/support"
                      className="inline-flex min-h-6 items-center font-bold text-primary underline focus-visible:focus-ring"
                    >
                      {t('assistant.openSupport')}
                    </AppLink>
                  </p>
                ) : null}
                <Notes cards={message.cards} />
                {message.cards.some((card) => card.kind !== 'note') ? (
                  <ul className="flex flex-col gap-2">
                    {message.cards.map((card, index) =>
                      card.kind === 'note' ? null : (
                        // Cards have no id of their own and never reorder within a message.
                        <ResultCard key={`${message.id}-${String(index)}`} card={card} />
                      ),
                    )}
                  </ul>
                ) : null}
                {message.confirmationId ? (
                  <ConfirmationCard
                    confirmationId={message.confirmationId}
                    onDecided={() => {
                      if (conversation) void follow(conversation.id);
                    }}
                  />
                ) : null}
                {message.role === 'assistant' && message.kind === 'text' ? (
                  <Feedback message={message} headers={headers} />
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {answering ? (
          <p role="status" className="font-body text-body-sm text-muted">
            {t('assistant.thinking')}
          </p>
        ) : null}
        <div ref={logEnd} />
      </div>
      {error ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {error}
        </p>
      ) : null}
      {closed ? null : (
        <form
          method="post"
          className="flex flex-col gap-2"
          onSubmit={(event) => void submit(event)}
        >
          <label htmlFor={inputId} className="font-body text-body-sm font-medium text-foreground">
            {t('assistant.messageLabel')}
          </label>
          <textarea
            id={inputId}
            name="message"
            value={text}
            maxLength={AGENT_MESSAGE_MAX}
            placeholder={t('assistant.placeholder')}
            className={TEXTAREA}
            data-testid="assistant-input"
            onFocus={() => {
              // A visitor without a session is checked once, before their first message.
              if (!signedIn && !conversation) ensureHuman();
            }}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <span className="font-body text-caption text-muted">{t('assistant.privacy')}</span>
          <div ref={turnstileRef} />
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" loading={busy} disabled={answering} data-testid="assistant-send">
              {t('assistant.send')}
            </Button>
            <AppLink
              href="/support"
              className="inline-flex min-h-6 items-center font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring"
            >
              {t('assistant.talkToPerson')}
            </AppLink>
          </div>
        </form>
      )}
      {conversation && !answering && messages.some((message) => message.role === 'assistant') ? (
        <Rating key={conversation.id} conversation={conversation} headers={headers} />
      ) : null}
      <div className="flex flex-wrap gap-4">
        {conversation ? (
          <button
            type="button"
            className="inline-flex min-h-6 items-center font-body text-body-sm text-muted underline hover:text-primary focus-visible:focus-ring"
            onClick={startAgain}
            data-testid="assistant-start-again"
          >
            {t('assistant.startAgain')}
          </button>
        ) : null}
        {signedIn ? (
          // What the assistant remembers is the traveller's to see and erase (ADR-105).
          <AppLink
            href="/assistant/preferences"
            className="inline-flex min-h-6 items-center font-body text-body-sm text-muted underline hover:text-primary focus-visible:focus-ring"
            data-testid="assistant-preferences"
          >
            {t('assistant.memory.link')}
          </AppLink>
        ) : null}
      </div>
    </div>
  );
}
