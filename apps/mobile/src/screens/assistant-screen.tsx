import { spacing } from '@suskii/design-tokens';
import { useFormatters } from '@suskii/i18n/react';
import { AGENT_MESSAGE_MAX, isAgentCardNote, isAgentMemoryKey } from '@suskii/shared';
import type { Schemas } from '@suskii/api-client';
import { Badge, Button, Card, iconColor, iconSize } from '@suskii/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  ChevronRight,
  Headset,
  History,
  Info,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { memoryValueText } from '../components/assistant/memory-text';
import { Loading, Notice } from '../components/states';
import { appConfig } from '../config';
import { problemSlug } from '../lib/api';
import {
  ASSISTANT_POLL_MS,
  assistantCardTarget,
  assistantSession,
  type AssistantCardTarget,
} from '../lib/assistant';
import { attestationHeader } from '../lib/attestation';
import { useApp, useT } from '../providers/app-provider';
import { useAuth } from '../providers/auth';

type Conversation = Schemas['AgentConversation'];
type Message = Schemas['AgentMessage'];
type CardData = Message['cards'][number];
type Confirmation = Schemas['AgentConfirmation'];

/** Arrows point the way the text reads (ADR-076). */
const MIRRORED = I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined;

/** The questions offered before the first message, in the catalog's words. */
const SUGGESTIONS = ['trip', 'flight', 'hotel', 'bookings'] as const;

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

/** Whether the keyboard is up, so the message box sits on it without the gesture bar's gap. */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setShown(true),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setShown(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

/** Ask Suskii's mark: the bot in a red disc, as on the button that opens it. */
function Avatar({ large = false }: { large?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={
        large
          ? 'size-16 items-center justify-center rounded-pill bg-primary'
          : 'size-8 items-center justify-center rounded-pill bg-primary'
      }
    >
      {large ? (
        <Sparkles color={iconColor['on-primary']} size={iconSize.lg} />
      ) : (
        <Bot color={iconColor['on-primary']} size={iconSize.sm} />
      )}
    </View>
  );
}

/** A round button with an icon and a name a screen reader says. */
function IconButton({
  testID,
  label,
  onPress,
  children,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      className="size-12 items-center justify-center rounded-pill active:bg-primary-subtle"
    >
      {children}
    </Pressable>
  );
}

/**
 * The screen's own header: the way back, Ask Suskii's mark and name, and the conversation's
 * actions, always in reach (the native header is hidden so they can be tested and drawn alike).
 */
function Header({
  onNewChat,
  showHistory,
}: {
  onNewChat: (() => void) | null;
  showHistory: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="border-b border-border bg-surface" style={{ paddingTop: insets.top }}>
      <View className="min-h-16 flex-row items-center gap-2 px-2">
        <IconButton
          testID="assistant-close"
          label={t('assistant.close')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        >
          <ArrowLeft color={iconColor.heading} size={iconSize.lg} style={MIRRORED} />
        </IconButton>
        <Avatar />
        <View className="flex-1">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('assistant.title')}
          </Text>
          <Text className="font-body text-caption text-muted">{t('assistant.subtitle')}</Text>
        </View>
        {showHistory ? (
          <IconButton
            testID="assistant-history"
            label={t('assistant.history')}
            onPress={() => router.push('/assistant/history')}
          >
            <History color={iconColor.heading} size={iconSize.md} />
          </IconButton>
        ) : null}
        {onNewChat ? (
          <IconButton
            testID="assistant-start-again"
            label={t('assistant.startAgain')}
            onPress={onNewChat}
          >
            <SquarePen color={iconColor.heading} size={iconSize.md} />
          </IconButton>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A result drawn beside an answer (ADR-109). Its link is a path of the website: every page the
 * app has a screen for opens there (a prepared booking its checkout, Home its tabs), and only a
 * page the app lacks opens on the website. A card never leads anywhere else.
 */
function ResultCard({
  card,
  onChoose,
}: {
  card: CardData;
  /** Sends the traveller's choice of this option (ADR-123); only on the newest answer. */
  onChoose?: ((text: string) => void) | undefined;
}) {
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const target = card.href ? assistantCardTarget(card.href, appConfig.webBaseUrl) : null;
  const chooseable = card.choose !== undefined && onChoose !== undefined;
  const open = (to: AssistantCardTarget) => {
    if ('screen' in to) router.push(to.screen);
    else void openBrowserAsync(to.web);
  };
  const body = (
    <>
      {card.kind === 'source' ? (
        <Text className="font-body text-caption text-muted">{t('assistant.cards.source')}</Text>
      ) : null}
      <Text className="font-body-medium text-body text-heading">{card.title}</Text>
      {card.lines.map((line) => (
        <Text key={line} className="font-body text-body-sm text-foreground">
          {line}
        </Text>
      ))}
      {card.price ? (
        <Text className="font-heading text-h4 text-heading">{format.money(card.price)}</Text>
      ) : null}
      {card.indicative ? (
        <>
          <View className="self-start">
            <Badge variant="warning">{t('assistant.cards.indicative')}</Badge>
          </View>
          <Text className="font-body text-caption text-muted">
            {t('assistant.cards.indicativeNote')}
          </Text>
        </>
      ) : null}
      {target && !chooseable ? (
        <View className="flex-row items-center gap-1 self-end pt-1">
          <Text className="font-body-bold text-body-sm text-primary">
            {t('assistant.cards.view')}
          </Text>
          <ChevronRight color={iconColor.primary} size={iconSize.sm} style={MIRRORED} />
        </View>
      ) : null}
    </>
  );
  // An option of the newest answer is chosen here, in the chat: the trip goes on from it.
  if (chooseable && card.choose !== undefined) {
    const option = card.choose;
    return (
      <View
        testID={`assistant-option-${String(option)}`}
        className="gap-1 rounded-lg border border-border bg-surface p-4"
      >
        {body}
        <View className="flex-row items-center justify-end gap-3 pt-2">
          {target ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${card.title}, ${t('assistant.cards.view')}`}
              hitSlop={8}
              onPress={() => open(target)}
              className="min-h-12 justify-center px-2"
            >
              <Text className="font-body-bold text-body-sm text-primary">
                {t('assistant.cards.view')}
              </Text>
            </Pressable>
          ) : null}
          <Button
            testID={`assistant-choose-${String(option)}`}
            accessibilityLabel={t('assistant.cards.chooseLabel', { title: card.title })}
            onPress={() =>
              onChoose?.(t('assistant.cards.chosen', { option: String(option), title: card.title }))
            }
          >
            {t('assistant.cards.choose')}
          </Button>
        </View>
      </View>
    );
  }
  if (!target) {
    return <View className="gap-1 rounded-lg border border-border bg-surface p-4">{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${card.title}, ${t('assistant.cards.view')}`}
      onPress={() => open(target)}
      className="gap-1 rounded-lg border border-border bg-surface p-4 active:bg-primary-subtle"
    >
      {body}
    </Pressable>
  );
}

/**
 * What an answer is read with (ADR-107): the API sends a code with the facts that need it, and
 * the words are the catalog's, in the traveller's language, whatever the assistant wrote. A
 * code this build does not know is left out.
 */
function Notes({ cards }: { cards: readonly CardData[] }) {
  const { t } = useT();
  const codes = cards.flatMap((card) =>
    card.kind === 'note' && isAgentCardNote(card.title) ? [card.title] : [],
  );
  if (codes.length === 0) return null;
  return (
    <View
      testID="assistant-notes"
      className="flex-row gap-3 rounded-lg border border-border bg-primary-subtle p-4"
    >
      <Info color={iconColor.heading} size={iconSize.sm} />
      <View className="flex-1 gap-1">
        <Text className="font-body-bold text-caption text-foreground">
          {t('assistant.notes.label')}
        </Text>
        {codes.map((code) => (
          <Text
            key={code}
            testID={`assistant-note-${code}`}
            className="font-body text-body-sm text-foreground"
          >
            {t(`assistant.notes.${code}`)}
          </Text>
        ))}
      </View>
    </View>
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
  const remembered =
    confirmation.action === 'memory.remember' && isAgentMemoryKey(card.title) ? card.title : null;
  return (
    <Card className="gap-2 p-4" testID="assistant-confirmation">
      <Text className="font-body-medium text-caption text-muted">
        {t('assistant.confirm.heading')}
      </Text>
      <Text className="font-body-medium text-body text-heading">
        {t(actionLabel(confirmation.action))}
      </Text>
      {remembered ? (
        // A preference to remember (ADR-105): its name and its value, in the traveller's words.
        <Text className="font-body-medium text-body-sm text-foreground">
          {`${t(`assistant.memory.keys.${remembered}`)}: ${memoryValueText(t, remembered, card.lines[0] ?? '')}`}
        </Text>
      ) : (
        <>
          <Text className="font-body-medium text-body-sm text-foreground">{card.title}</Text>
          {card.lines.map((line) => (
            <Text key={line} className="font-body text-body-sm text-foreground">
              {line}
            </Text>
          ))}
        </>
      )}
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
          {remembered && status === 'confirmed'
            ? t('assistant.memory.remembered')
            : t(`assistant.confirm.statuses.${status}`)}
        </Text>
      )}
    </Card>
  );
}

/** Whether an answer helped: one press on a thumb, then thanks. */
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
  const thumb = (feedback: 'up' | 'down') => {
    const chosen = given === feedback;
    const Icon = feedback === 'up' ? ThumbsUp : ThumbsDown;
    return (
      <Pressable
        testID={`assistant-feedback-${feedback}`}
        accessibilityRole="button"
        accessibilityLabel={t(`assistant.feedback.${feedback}`)}
        accessibilityState={{ selected: chosen, disabled: given !== null }}
        disabled={given !== null}
        hitSlop={8}
        onPress={() => void send(feedback)}
        className={
          chosen
            ? 'size-8 items-center justify-center rounded-pill bg-primary-subtle'
            : 'size-8 items-center justify-center rounded-pill active:bg-primary-subtle'
        }
      >
        <Icon color={chosen ? iconColor.primary : iconColor.muted} size={iconSize.sm} />
      </Pressable>
    );
  };
  return (
    <View className="flex-row items-center gap-1">
      {given === null || given === 'up' ? thumb('up') : null}
      {given === null || given === 'down' ? thumb('down') : null}
      {given ? (
        <Text className="ms-1 font-body text-caption text-muted">
          {t('assistant.feedback.thanks')}
        </Text>
      ) : null}
    </View>
  );
}

/** One dot of the typing indicator; still when the device asks for reduced motion. */
function Dot({ delay }: { delay: number }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!reduceMotion) {
      opacity.value = withDelay(delay, withRepeat(withTiming(0.25, { duration: 420 }), -1, true));
    }
  }, [delay, opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View className="size-2 rounded-pill bg-muted" style={style} />;
}

/** The assistant is answering: three dots in a bubble, and the words for a screen reader. */
function Typing() {
  const { t } = useT();
  return (
    <View
      testID="assistant-thinking"
      accessibilityLiveRegion="polite"
      className="flex-row items-end gap-2"
    >
      <Avatar />
      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3">
        <Dot delay={0} />
        <Dot delay={140} />
        <Dot delay={280} />
        <Text className="ms-1 font-body text-body-sm text-muted">{t('assistant.thinking')}</Text>
      </View>
    </View>
  );
}

/** A message of the conversation: the traveller's on the reading end, Ask Suskii's facing it. */
function Bubble({
  message,
  conversationId,
  onDecided,
  onChoose,
}: {
  message: Message;
  conversationId: string;
  onDecided: () => void;
  /** Given to the newest answer only, while nothing is being answered. */
  onChoose?: ((text: string) => void) | undefined;
}) {
  const { t } = useT();
  const router = useRouter();
  if (message.role === 'user') {
    return (
      <View
        testID="assistant-message-user"
        className="ms-12 self-end rounded-xl bg-primary px-4 py-3"
      >
        <Text className="font-body text-body text-on-primary">{message.text}</Text>
      </View>
    );
  }
  const words = message.notice ? t(`assistant.notices.${message.notice}`) : message.text;
  return (
    <View testID="assistant-message-assistant" className="me-6 flex-row items-start gap-2">
      <Avatar />
      <View className="flex-1 gap-2">
        {words ? (
          <View
            className={
              message.notice
                ? 'flex-row gap-2 self-start rounded-xl border border-border bg-primary-subtle px-4 py-3'
                : 'self-start rounded-xl border border-border bg-surface px-4 py-3'
            }
          >
            {message.notice ? <Info color={iconColor.muted} size={iconSize.sm} /> : null}
            <Text
              className={
                message.notice
                  ? 'shrink font-body text-body-sm text-foreground'
                  : 'font-body text-body text-foreground'
              }
            >
              {words}
            </Text>
          </View>
        ) : null}
        {message.kind === 'handover' ? (
          <View className="gap-2 self-start rounded-xl border border-border bg-surface px-4 py-3">
            <Text className="font-body text-body-sm text-foreground">
              {t('assistant.handover')}
            </Text>
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => router.push('/support')}
              className="flex-row items-center gap-1"
            >
              <Text className="font-body-bold text-body-sm text-primary">
                {t('assistant.openSupport')}
              </Text>
              <ChevronRight color={iconColor.primary} size={iconSize.sm} style={MIRRORED} />
            </Pressable>
          </View>
        ) : null}
        <Notes cards={message.cards} />
        {message.cards.map((card, index) =>
          card.kind === 'note' ? null : (
            // Cards have no id of their own and never reorder within a message.
            <ResultCard key={`${message.id}-${String(index)}`} card={card} onChoose={onChoose} />
          ),
        )}
        {message.confirmationId ? (
          <ConfirmationCard confirmationId={message.confirmationId} onDecided={onDecided} />
        ) : null}
        {message.kind === 'text' ? (
          <Feedback message={message} conversationId={conversationId} />
        ) : null}
      </View>
    </View>
  );
}

/** Before the first message: what Ask Suskii does, and questions to start with. */
function Welcome({ onAsk, signedIn }: { onAsk: (words: string) => void; signedIn: boolean }) {
  const { t } = useT();
  return (
    <View className="gap-6">
      <View className="items-center gap-3 pt-4">
        <Avatar large />
        <Text
          accessibilityRole="header"
          className="text-center font-heading-extrabold text-h3 text-heading"
        >
          {t('assistant.notices.greeting')}
        </Text>
        <Text className="text-center font-body text-body text-foreground">
          {t('assistant.intro')}
        </Text>
        <Text className="text-center font-body text-body-sm text-muted">
          {t('assistant.disclosure')}
        </Text>
      </View>
      <View className="gap-2">
        <Text className="font-body-medium text-body-sm text-muted">
          {t('assistant.suggestions.heading')}
        </Text>
        {SUGGESTIONS.map((key) => (
          <Pressable
            key={key}
            testID={`assistant-suggestion-${key}`}
            accessibilityRole="button"
            onPress={() => onAsk(t(`assistant.suggestions.${key}`))}
            className="min-h-12 flex-row items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 active:bg-primary-subtle"
          >
            <Text className="flex-1 font-body text-body-sm text-foreground">
              {t(`assistant.suggestions.${key}`)}
            </Text>
            <ArrowUp color={iconColor.primary} size={iconSize.sm} />
          </Pressable>
        ))}
      </View>
      {signedIn ? null : (
        <Text className="text-center font-body text-caption text-muted">
          {t('assistant.signInForHistory')}
        </Text>
      )}
    </View>
  );
}

/** A small pill with an icon: the ways out of the chat that stay in reach above the box. */
function Chip({
  testID,
  label,
  icon,
  onPress,
}: {
  testID: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-10 flex-row items-center gap-2 rounded-pill border border-border bg-background px-4 active:bg-primary-subtle"
    >
      {icon}
      <Text className="font-body-medium text-body-sm text-foreground">{label}</Text>
    </Pressable>
  );
}

/**
 * The traveller's chat with the assistant (ADR-101, ADR-107). It is offered only while the
 * API says the assistant is available; an answer the app cannot read shows that it cannot
 * answer, never a spinner. Nothing is sent, and no conversation is started, before the first
 * message; a guest's first message proves the app is genuine. While the assistant answers the
 * conversation is read again every moment. A person is always one press away.
 *
 * The message box sits on the keyboard (a padding as tall as the keyboard covers this screen,
 * which Android draws edge to edge), grows to a few lines and then scrolls inside itself, and
 * the conversation keeps its newest message in view.
 */
export function AssistantScreen() {
  const { conversation: asked } = useLocalSearchParams<{ conversation?: string }>();
  const { api, locale } = useApp();
  const { user } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const scroll = useRef<ScrollView>(null);
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

  const toEnd = () => scroll.current?.scrollToEnd({ animated: true });
  // The keyboard takes the lower part of the screen: the newest message moves up with it.
  useEffect(() => {
    if (keyboardShown) scroll.current?.scrollToEnd({ animated: true });
  }, [keyboardShown]);

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

  const send = async (typed?: string) => {
    const words = (typed ?? text).trim();
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
                  ? // The day's spend cap. The `limit` notice is a run that used its steps.
                    t('assistant.errors.budget')
                  : slug === 'agent-unavailable'
                    ? t('assistant.notices.unavailable')
                    : t('assistant.errors.send'),
        );
        return;
      }
      if (typed === undefined) setText('');
      // A read of the conversation that started before the message was stored must not land
      // on top of this: it would drop the message and, with no run in it, stop the polling
      // before the answer arrives.
      await queryClient.cancelQueries({ queryKey: ['agent', 'conversation', current.id] });
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

  /**
   * A new conversation: every answer to "which one is open" is cleared, whichever way the
   * screen was opened (History opens one by its id), and so is what this device remembers. The
   * old conversation stays the account's, in History.
   */
  const startAgain = async () => {
    setText('');
    setError(null);
    queryClient.setQueriesData({ queryKey: ['agent', 'open'] }, null);
    await assistantSession.remember(null);
    if (requested) router.replace('/assistant');
  };

  const body = (() => {
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
    return null;
  })();

  const current = conversation.data ?? null;
  const messages = current?.messages ?? [];
  const answering = Boolean(current?.activeRunId);
  const closed = current?.status === 'closed';
  const canSend = !closed && !answering && !busy && text.trim() !== '';
  // Options are chosen from the newest answer only: an older list's "option 2" could name
  // another hotel than the one the traveller sees (ADR-123).
  const newest = messages.at(-1);
  const choosing =
    !closed && !answering && !busy && newest?.role === 'assistant' ? newest.id : null;

  return (
    <View testID="assistant-screen" className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false, title: t('assistant.title') }} />
      <Header
        showHistory={Boolean(user)}
        onNewChat={current && !body ? () => void startAgain() : null}
      />
      {body ?? (
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            ref={scroll}
            className="flex-1"
            contentContainerClassName="gap-4 px-4 pb-6 pt-4"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={toEnd}
          >
            {messages.length === 0 ? (
              <Welcome onAsk={(words) => void send(words)} signedIn={Boolean(user)} />
            ) : (
              <>
                <Text className="text-center font-body text-caption text-muted">
                  {t('assistant.disclosure')}
                </Text>
                {messages.map((message) => (
                  <Bubble
                    key={message.id}
                    message={message}
                    conversationId={current?.id ?? ''}
                    onDecided={() => void queryClient.invalidateQueries({ queryKey: key })}
                    onChoose={message.id === choosing ? (words) => void send(words) : undefined}
                  />
                ))}
              </>
            )}
            {answering ? <Typing /> : null}
          </ScrollView>

          <View
            className="gap-2 border-t border-border bg-surface px-3 pt-2"
            style={{
              paddingBottom: keyboardShown ? spacing['2'] : Math.max(insets.bottom, spacing['2']),
            }}
          >
            {error ? (
              <View
                accessibilityRole="alert"
                className="flex-row items-start gap-2 rounded-lg bg-primary-subtle p-3"
              >
                <Info color={iconColor.danger} size={iconSize.sm} />
                <Text className="flex-1 font-body text-body-sm text-danger">{error}</Text>
              </View>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="gap-2"
            >
              <Chip
                testID="assistant-person"
                label={t('assistant.talkToPerson')}
                icon={<Headset color={iconColor.heading} size={iconSize.sm} />}
                onPress={() => router.push('/support')}
              />
              {user ? (
                // What the assistant remembers is the traveller's to see and erase (ADR-105).
                <Chip
                  testID="assistant-preferences"
                  label={t('assistant.memory.link')}
                  icon={<SlidersHorizontal color={iconColor.heading} size={iconSize.sm} />}
                  onPress={() => router.push('/assistant/preferences')}
                />
              ) : null}
            </ScrollView>
            {closed ? (
              <View className="gap-2">
                <Text className="font-body text-body-sm text-foreground">
                  {t('assistant.errors.full')}
                </Text>
                <Button testID="assistant-start-new" onPress={() => void startAgain()}>
                  {t('assistant.startAgain')}
                </Button>
              </View>
            ) : (
              <View className="flex-row items-end gap-2">
                <TextInput
                  testID="assistant-input"
                  accessibilityLabel={t('assistant.messageLabel')}
                  multiline
                  value={text}
                  maxLength={AGENT_MESSAGE_MAX}
                  placeholder={t('assistant.placeholder')}
                  placeholderTextColor={iconColor.muted}
                  onChangeText={setText}
                  onFocus={toEnd}
                  className="max-h-composer min-h-12 flex-1 rounded-xl border border-border-strong bg-background px-4 py-3 font-body text-body text-foreground"
                />
                <Pressable
                  testID="assistant-send"
                  accessibilityRole="button"
                  accessibilityLabel={t('assistant.send')}
                  accessibilityState={{ disabled: !canSend, busy }}
                  disabled={!canSend}
                  onPress={() => void send()}
                  className={
                    canSend
                      ? 'size-12 items-center justify-center rounded-pill bg-primary active:bg-primary-pressed'
                      : 'size-12 items-center justify-center rounded-pill bg-border'
                  }
                >
                  {busy ? (
                    <ActivityIndicator color={iconColor['on-primary']} />
                  ) : (
                    <ArrowUp
                      color={canSend ? iconColor['on-primary'] : iconColor.muted}
                      size={iconSize.md}
                    />
                  )}
                </Pressable>
              </View>
            )}
            <Text className="px-1 font-body text-caption text-muted">{t('assistant.privacy')}</Text>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
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
