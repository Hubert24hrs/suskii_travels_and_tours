import { useFormatters } from '@suskii/i18n/react';
import { AGENT_MESSAGE_MAX } from '@suskii/shared';
import type { Schemas } from '@suskii/api-client';
import { Badge, Button, Card } from '@suskii/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Loading, Notice } from '../components/states';
import { appConfig, webHost } from '../config';
import { problemSlug } from '../lib/api';
import { ASSISTANT_POLL_MS, assistantSession } from '../lib/assistant';
import { attestationHeader } from '../lib/attestation';
import { resolveIncomingUrl } from '../lib/deep-links';
import { useApp, useT } from '../providers/app-provider';
import { useAuth } from '../providers/auth';

type Conversation = Schemas['AgentConversation'];
type Message = Schemas['AgentMessage'];
type CardData = Message['cards'][number];
type Confirmation = Schemas['AgentConfirmation'];

const TEXT_AREA =
  'min-h-20 rounded-md border border-border-strong bg-surface px-4 py-3 font-body text-body text-foreground';
const LINK = 'font-body-medium text-body-sm text-primary underline';

/** What a confirmation does, in words: the API names the tool, the catalog says it. */
const ACTION_LABELS = {
  'bookings.cancel': 'assistant.confirm.actions.bookings_cancel',
  'changes.accept': 'assistant.confirm.actions.changes_accept',
  'changes.take_refund_offer': 'assistant.confirm.actions.changes_take_refund_offer',
  'alerts.watch': 'assistant.confirm.actions.alerts_watch',
  'alerts.stop': 'assistant.confirm.actions.alerts_stop',
} as const;
const actionLabel = (action: string) =>
  action in ACTION_LABELS
    ? ACTION_LABELS[action as keyof typeof ACTION_LABELS]
    : 'assistant.confirm.actions.fallback';

/**
 * A result drawn beside an answer. Its link is a path of the website: one the app has a
 * screen for opens there (the same allowlist as an incoming link), anything else opens the
 * website in the system browser. A card never leads anywhere else.
 */
function ResultCard({ card }: { card: CardData }) {
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const open = (href: string) => {
    const address = new URL(href, appConfig.webBaseUrl).toString();
    const inApp = resolveIncomingUrl(address, webHost());
    if (inApp.path !== '/') router.push(inApp.path);
    else void openBrowserAsync(address);
  };
  return (
    <Card className="gap-1 p-3">
      {card.kind === 'source' ? (
        <Text className="font-body text-caption text-muted">{t('assistant.cards.source')}</Text>
      ) : null}
      <Text className="font-body-medium text-body-sm text-heading">{card.title}</Text>
      {card.lines.map((line) => (
        <Text key={line} className="font-body text-body-sm text-foreground">
          {line}
        </Text>
      ))}
      {card.price ? (
        <Text className="font-body-medium text-body text-heading">{format.money(card.price)}</Text>
      ) : null}
      {card.indicative ? (
        <>
          <Badge variant="warning">{t('assistant.cards.indicative')}</Badge>
          <Text className="font-body text-caption text-muted">
            {t('assistant.cards.indicativeNote')}
          </Text>
        </>
      ) : null}
      {card.href ? (
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => {
            if (card.href) open(card.href);
          }}
        >
          <Text className={LINK}>{t('assistant.cards.view')}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

/**
 * What the assistant prepared, for the traveller to decide (ADR-107). The card is the API's
 * own: nothing changes until Confirm is pressed, and the press goes to the API with the
 * traveller's session and an idempotency key.
 */
function ConfirmationCard({
  confirmationId,
  onDecided,
}: {
  confirmationId: string;
  onDecided: () => void;
}) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = ['agent', 'confirmation', confirmationId];
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Confirmation | null> =>
      (
        await api.GET('/v1/agent/confirmations/{confirmationId}', {
          params: { path: { confirmationId } },
        })
      ).data ?? null,
  });

  const decide = async (decision: 'confirm' | 'decline') => {
    setBusy(true);
    setFailed(false);
    try {
      const { data } = await api.POST(
        decision === 'confirm'
          ? '/v1/agent/confirmations/{confirmationId}/confirm'
          : '/v1/agent/confirmations/{confirmationId}/decline',
        { params: { path: { confirmationId }, header: { 'Idempotency-Key': randomUUID() } } },
      );
      if (!data) {
        setFailed(true);
        return;
      }
      queryClient.setQueryData(key, data.confirmation);
      onDecided();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (query.isPending) return null;
  const confirmation = query.data;
  if (!confirmation) {
    // Only the signed-in owner of the conversation may read or decide one.
    return (
      <Text testID="assistant-confirmation" className="font-body text-body-sm text-muted">
        {t('assistant.confirm.signIn')}
      </Text>
    );
  }
  const { card, status } = confirmation;
  return (
    <Card className="gap-2 p-4" testID="assistant-confirmation">
      <Text className="font-body-medium text-caption text-muted">
        {t('assistant.confirm.heading')}
      </Text>
      <Text className="font-body-medium text-body text-heading">
        {t(actionLabel(confirmation.action))}
      </Text>
      <Text className="font-body-medium text-body-sm text-foreground">{card.title}</Text>
      {card.lines.map((line) => (
        <Text key={line} className="font-body text-body-sm text-foreground">
          {line}
        </Text>
      ))}
      {card.amounts.map((entry) => (
        <View key={entry.code} className="flex-row flex-wrap justify-between gap-2">
          <Text className="font-body text-body-sm text-muted">
            {t(`assistant.confirm.amounts.${entry.code}`)}
          </Text>
          <Text className="font-body-medium text-body-sm text-heading">
            {format.money(entry.amount)}
          </Text>
        </View>
      ))}
      {status === 'pending' ? (
        <>
          <Text className="font-body text-caption text-muted">
            {t('assistant.confirm.note')}{' '}
            {t('assistant.confirm.until', { time: format.dateTime(confirmation.expiresAt) })}
          </Text>
          {failed ? (
            <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
              {t('assistant.confirm.statuses.failed')}
            </Text>
          ) : null}
          <Button testID="assistant-confirm" loading={busy} onPress={() => void decide('confirm')}>
            {t('assistant.confirm.confirm')}
          </Button>
          <Button
            testID="assistant-decline"
            variant="ghost"
            disabled={busy}
            onPress={() => void decide('decline')}
          >
            {t('assistant.confirm.decline')}
          </Button>
        </>
      ) : (
        <Text className="font-body text-body-sm text-foreground">
          {t(`assistant.confirm.statuses.${status}`)}
        </Text>
      )}
    </Card>
  );
}

function Feedback({ message, conversationId }: { message: Message; conversationId: string }) {
  const { api } = useApp();
  const { t } = useT();
  const [given, setGiven] = useState(message.feedback);
  const send = async (feedback: 'up' | 'down') => {
    setGiven(feedback);
    try {
      await api.PUT('/v1/agent/messages/{messageId}/feedback', {
        params: {
          path: { messageId: message.id },
          header: await assistantSession.headers(conversationId),
        },
        body: { feedback },
      });
    } catch {
      // Whether it helped is not worth an error to the traveller.
    }
  };
  if (given) {
    return (
      <Text className="font-body text-caption text-muted">{t('assistant.feedback.thanks')}</Text>
    );
  }
  return (
    <View className="flex-row flex-wrap gap-4">
      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void send('up')}>
        <Text className="font-body text-caption text-muted underline">
          {t('assistant.feedback.up')}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void send('down')}>
        <Text className="font-body text-caption text-muted underline">
          {t('assistant.feedback.down')}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The traveller's chat with the assistant (ADR-101, ADR-107). It is offered only while the
 * API says the assistant is available; an answer the app cannot read shows that it cannot
 * answer, never a spinner. Nothing is sent, and no conversation is started, before the first
 * message; a guest's first message proves the app is genuine. While the assistant answers the
 * conversation is read again every moment. A person is always one press away.
 */
export function AssistantScreen() {
  const { conversation: asked } = useLocalSearchParams<{ conversation?: string }>();
  const { api, locale } = useApp();
  const { user } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requested = asked && /^[0-9a-f-]{36}$/i.test(asked) ? asked : null;

  const status = useQuery({
    queryKey: ['agent', 'status'],
    queryFn: async () => (await api.GET('/v1/agent/status')).data ?? null,
  });
  // The conversation asked for, else the one this device last had open.
  const open = useQuery({
    queryKey: ['agent', 'open', requested],
    queryFn: async () => requested ?? (await assistantSession.current()),
  });
  const conversationId = open.data ?? null;
  const key = ['agent', 'conversation', conversationId];
  const conversation = useQuery({
    queryKey: key,
    enabled: conversationId !== null,
    // Read again only while the assistant is answering.
    refetchInterval: (query) => (query.state.data?.activeRunId ? ASSISTANT_POLL_MS : false),
    queryFn: async (): Promise<Conversation | null> => {
      if (!conversationId) return null;
      const { data } = await api.GET('/v1/agent/conversations/{conversationId}', {
        params: {
          path: { conversationId },
          header: await assistantSession.headers(conversationId),
        },
      });
      // Closed, deleted or another person's: this device starts afresh.
      if (!data && !requested) await assistantSession.remember(null);
      return data ?? null;
    },
  });

  const start = async (): Promise<Conversation | null> => {
    const proof = user ? null : await attestationHeader(api);
    const { data, error: problem } = await api.POST('/v1/agent/conversations', {
      params: { header: proof ? { 'X-Suskii-Attestation': proof } : {} },
      body: { locale: locale as never, turnstileToken: null },
    });
    if (!data) {
      setError(
        problemSlug(problem) === 'bot-check-failed'
          ? t('assistant.errors.human')
          : t('assistant.errors.start'),
      );
      return null;
    }
    if (data.accessToken) await assistantSession.saveToken(data.conversation.id, data.accessToken);
    await assistantSession.remember(data.conversation.id);
    queryClient.setQueryData(['agent', 'conversation', data.conversation.id], data.conversation);
    queryClient.setQueryData(['agent', 'open', requested], data.conversation.id);
    return data.conversation;
  };

  const send = async () => {
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    setError(null);
    try {
      const current = conversation.data ?? (await start());
      if (!current) return;
      const { data, error: problem } = await api.POST('/v1/agent/chat', {
        params: { header: await assistantSession.headers(current.id) },
        body: { conversationId: current.id, text: words },
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
      // The traveller's message shows at once; the run it started is then followed.
      queryClient.setQueryData(
        ['agent', 'conversation', current.id],
        (previous: Conversation | null | undefined) => ({
          ...(previous ?? current),
          messages: [...(previous ?? current).messages, data.message],
          activeRunId: data.runId,
        }),
      );
    } catch {
      setError(t('assistant.errors.send'));
    } finally {
      setBusy(false);
    }
  };

  const startAgain = async () => {
    await assistantSession.remember(null);
    queryClient.setQueryData(['agent', 'open', requested], null);
    setError(null);
    if (requested) router.replace('/assistant');
  };

  if (status.isPending || open.isPending) return <Loading label={t('common.loading')} />;
  if (!status.data?.available) {
    return (
      <Notice
        testID="assistant-unavailable"
        body={
          status.data?.paused ? t('assistant.notices.paused') : t('assistant.notices.unavailable')
        }
      />
    );
  }
  if (requested && !conversation.isPending && !conversation.data) {
    return <Notice testID="assistant-missing" body={t('assistant.errors.gone')} />;
  }
  const current = conversation.data ?? null;
  const messages = current?.messages ?? [];
  const answering = Boolean(current?.activeRunId);
  return (
    <ScrollView
      contentContainerClassName="gap-4 p-4"
      keyboardShouldPersistTaps="handled"
      testID="assistant-screen"
    >
      <Stack.Screen options={{ title: t('assistant.title') }} />
      <Text className="font-body text-body-sm text-muted">{t('assistant.disclosure')}</Text>
      {messages.length === 0 ? (
        <Card className="gap-2 p-4">
          <Text className="font-body-medium text-body-sm text-heading">
            {t('assistant.notices.greeting')}
          </Text>
          <Text className="font-body text-body-sm text-foreground">{t('assistant.intro')}</Text>
        </Card>
      ) : (
        messages.map((message) => (
          <Card key={message.id} testID={`assistant-message-${message.role}`} className="gap-2 p-3">
            <Text className="font-body-medium text-caption text-muted">
              {message.role === 'user' ? t('assistant.you') : t('assistant.name')}
            </Text>
            <Text className="font-body text-body-sm text-foreground">
              {message.notice ? t(`assistant.notices.${message.notice}`) : message.text}
            </Text>
            {message.kind === 'handover' ? (
              <>
                <Text className="font-body text-body-sm text-foreground">
                  {t('assistant.handover')}
                </Text>
                <Pressable
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => router.push('/support')}
                >
                  <Text className={LINK}>{t('assistant.openSupport')}</Text>
                </Pressable>
              </>
            ) : null}
            {message.cards.map((card, index) => (
              // Cards have no id of their own and never reorder within a message.
              <ResultCard key={`${message.id}-${String(index)}`} card={card} />
            ))}
            {message.confirmationId ? (
              <ConfirmationCard
                confirmationId={message.confirmationId}
                onDecided={() => void queryClient.invalidateQueries({ queryKey: key })}
              />
            ) : null}
            {message.role === 'assistant' && message.kind === 'text' && current ? (
              <Feedback message={message} conversationId={current.id} />
            ) : null}
          </Card>
        ))
      )}
      {answering ? (
        <Text testID="assistant-thinking" className="font-body text-body-sm text-muted">
          {t('assistant.thinking')}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      {current?.status === 'closed' ? null : (
        <View className="gap-2">
          <Text className="font-body-medium text-body-sm text-foreground">
            {t('assistant.messageLabel')}
          </Text>
          <TextInput
            testID="assistant-input"
            accessibilityLabel={t('assistant.messageLabel')}
            multiline
            textAlignVertical="top"
            value={text}
            maxLength={AGENT_MESSAGE_MAX}
            placeholder={t('assistant.placeholder')}
            onChangeText={setText}
            className={TEXT_AREA}
          />
          <Text className="font-body text-caption text-muted">{t('assistant.privacy')}</Text>
          <Button
            testID="assistant-send"
            loading={busy}
            disabled={answering || text.trim() === ''}
            onPress={() => void send()}
          >
            {t('assistant.send')}
          </Button>
        </View>
      )}
      <Button testID="assistant-person" variant="secondary" onPress={() => router.push('/support')}>
        {t('assistant.talkToPerson')}
      </Button>
      {user ? (
        <Button
          testID="assistant-history"
          variant="ghost"
          onPress={() => router.push('/assistant/history')}
        >
          {t('assistant.history')}
        </Button>
      ) : (
        <Text className="font-body text-caption text-muted">{t('assistant.signInForHistory')}</Text>
      )}
      {current ? (
        <Button testID="assistant-start-again" variant="ghost" onPress={() => void startAgain()}>
          {t('assistant.startAgain')}
        </Button>
      ) : null}
    </ScrollView>
  );
}

/** A signed-in traveller's earlier conversations, read from the API (the device keeps none). */
export function AssistantHistoryScreen() {
  const { api } = useApp();
  const { user } = useAuth();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const list = useQuery({
    queryKey: ['agent', 'list', user?.id],
    enabled: Boolean(user),
    queryFn: async () => (await api.GET('/v1/agent/conversations')).data?.conversations ?? [],
  });

  if (!user)
    return <Notice testID="assistant-history-guest" body={t('assistant.signInForHistory')} />;
  if (list.isPending) return <Loading label={t('common.loading')} />;
  return (
    <ScrollView contentContainerClassName="gap-3 p-4" testID="assistant-history-screen">
      <Stack.Screen options={{ title: t('assistant.history') }} />
      {(list.data ?? []).length === 0 ? (
        <Text className="font-body text-body-sm text-muted">{t('assistant.noHistory')}</Text>
      ) : (
        (list.data ?? []).map((conversation) => (
          <Pressable
            key={conversation.id}
            testID={`assistant-conversation-${conversation.id}`}
            accessibilityRole="button"
            onPress={() => router.push(`/assistant?conversation=${conversation.id}` as Href)}
          >
            <Card className="gap-1 p-4">
              <Text className="font-body-medium text-body text-foreground">
                {t('assistant.conversation', { reference: conversation.reference })}
              </Text>
              <Text className="font-body text-body-sm text-muted">
                {format.dateTime(conversation.lastMessageAt)}
                {', '}
                {t('assistant.messagesCount', {
                  count: format.number(conversation.messageCount),
                })}
              </Text>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
