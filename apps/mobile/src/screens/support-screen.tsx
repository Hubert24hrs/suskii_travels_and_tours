import { useFormatters } from '@suskii/i18n/react';
import { SUPPORT_CATEGORIES, SUPPORT_MESSAGE_MAX, type SupportCategory } from '@suskii/shared';
import type { Schemas } from '@suskii/api-client';
import { Badge, Button, Card, Input } from '@suskii/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Loading, Notice } from '../components/states';
import { attestationHeader } from '../lib/attestation';
import { SUPPORT_POLL_MS, supportTokens } from '../lib/support';
import { tripStore } from '../lib/trips';
import { useApp, useT } from '../providers/app-provider';
import { useAuth } from '../providers/auth';

type Conversation = Schemas['SupportConversation'];

const STATUS_VARIANT = { open: 'info', waiting: 'success', resolved: 'neutral' } as const;
const TEXT_AREA =
  'min-h-28 rounded-md border border-border-strong bg-surface px-4 py-3 font-body text-body text-foreground';

function MessageBox({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testID: string;
}) {
  return (
    <View className="gap-1">
      <Text className="font-body-medium text-body-sm text-foreground">{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        multiline
        textAlignVertical="top"
        value={value}
        maxLength={SUPPORT_MESSAGE_MAX}
        onChangeText={onChange}
        className={TEXT_AREA}
      />
    </View>
  );
}

/** Starts a conversation (ADR-083); guests prove the app is genuine and give an email. */
function StartForm({ bookingId }: { bookingId: string | null }) {
  const { api } = useApp();
  const { user } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const [category, setCategory] = useState<SupportCategory>(
    bookingId ? 'booking_change' : 'pre_booking',
  );
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const proof = user ? null : await attestationHeader(api);
      const guestBooking = bookingId ? await tripStore.bookingHeaders(bookingId) : {};
      const { data, error: problem } = await api.POST('/v1/support/conversations', {
        params: {
          header: {
            ...(proof ? { 'X-Suskii-Attestation': proof } : {}),
            ...guestBooking,
          },
        },
        body: {
          category,
          message,
          bookingId,
          email: user || email.trim() === '' ? null : email.trim(),
          turnstileToken: null,
        },
      });
      if (data) {
        if (data.accessToken) await supportTokens.save(data.conversation.id, data.accessToken);
        router.push(`/support/${data.conversation.id}` as Href);
        return;
      }
      const slug = (problem as { type?: string } | undefined)?.type ?? '';
      setError(
        slug.endsWith('/support-limit')
          ? t('support.errors.limit')
          : slug.endsWith('/support-email-required')
            ? t('support.errors.email')
            : t('support.errors.generic'),
      );
    } catch {
      setError(t('support.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-4 p-4" testID="support-start">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('support.start.heading')}
      </Text>
      <Text className="font-body-medium text-body-sm text-foreground">
        {t('support.start.category')}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {SUPPORT_CATEGORIES.map((value) => (
          <Pressable
            key={value}
            testID={`support-category-${value}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: category === value }}
            onPress={() => setCategory(value)}
            className={
              category === value
                ? 'min-h-12 justify-center rounded-full bg-primary px-4'
                : 'min-h-12 justify-center rounded-full border border-border-strong px-4'
            }
          >
            <Text
              className={
                category === value
                  ? 'font-body-medium text-body-sm text-on-primary'
                  : 'font-body text-body-sm text-foreground'
              }
            >
              {t(`support.start.categories.${value}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <MessageBox
        label={t('support.start.message')}
        value={message}
        onChange={setMessage}
        testID="support-message"
      />
      <Text className="font-body text-body-sm text-muted">{t('support.start.messageHint')}</Text>
      {user ? null : (
        <Input
          testID="support-email"
          label={t('support.start.email')}
          hint={t('support.start.emailHint')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
      )}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Button
        testID="support-submit"
        loading={busy}
        disabled={message.trim() === ''}
        onPress={() => void submit()}
      >
        {t('support.start.submit')}
      </Button>
    </Card>
  );
}

/** Help and support (ADR-083): start a conversation, the account's conversations and FAQs. */
export function SupportScreen() {
  const { booking } = useLocalSearchParams<{ booking?: string }>();
  const bookingId = booking && /^[0-9a-f-]{36}$/i.test(booking) ? booking : null;
  const { api, locale } = useApp();
  const { user } = useAuth();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const list = useQuery({
    queryKey: ['support', 'list', user?.id],
    enabled: Boolean(user),
    queryFn: async () => (await api.GET('/v1/support/conversations')).data?.conversations ?? [],
  });
  const faqs = useQuery({
    queryKey: ['content', 'faqs', locale],
    queryFn: async () =>
      (await api.GET('/v1/content/home', { params: { query: { locale } } })).data?.faqs ?? [],
  });

  return (
    <ScrollView contentContainerClassName="gap-4 p-4" testID="support-screen">
      <Stack.Screen options={{ title: t('support.heading') }} />
      <Text className="font-body text-body text-foreground">{t('support.intro')}</Text>
      <StartForm bookingId={bookingId} />
      {user && list.data ? (
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('support.list.heading')}
          </Text>
          {list.data.length === 0 ? (
            <Text className="font-body text-body-sm text-muted">{t('support.list.empty')}</Text>
          ) : (
            list.data.map((conversation) => (
              <Pressable
                key={conversation.id}
                testID={`support-conversation-${conversation.id}`}
                accessibilityRole="button"
                onPress={() => router.push(`/support/${conversation.id}` as Href)}
              >
                <Card className="gap-2 p-4">
                  <Text className="font-body-medium text-body text-foreground">
                    {t('support.conversation.title', { reference: conversation.reference })}
                  </Text>
                  <View className="flex-row flex-wrap items-center gap-2">
                    {conversation.unread ? (
                      <Badge variant="warning">{t('support.unread')}</Badge>
                    ) : null}
                    <Badge variant={STATUS_VARIANT[conversation.status]}>
                      {t(`support.status.${conversation.status}`)}
                    </Badge>
                    <Text className="font-body text-body-sm text-muted">
                      {format.dateTime(conversation.lastMessageAt)}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
      {faqs.data && faqs.data.length > 0 ? (
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('support.faqHeading')}
          </Text>
          {faqs.data.map((faq) => (
            <Card key={faq.id} className="gap-1 p-4">
              <Text className="font-body-medium text-body text-foreground">{faq.question}</Text>
              <Text className="font-body text-body text-foreground">{faq.answer}</Text>
            </Card>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** One conversation (ADR-083), refreshed every few seconds while it is on screen. */
export function SupportConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = ['support', 'conversation', id];

  const query = useQuery({
    queryKey: key,
    refetchInterval: SUPPORT_POLL_MS,
    queryFn: async (): Promise<Conversation | null> => {
      const options = {
        params: { path: { conversationId: id }, header: await supportTokens.headers(id) },
      };
      const { data } = await api.GET('/v1/support/conversations/{conversationId}', options);
      if (data?.unread) {
        const read = await api.PUT('/v1/support/conversations/{conversationId}/read', options);
        return read.data ?? data;
      }
      return data ?? null;
    },
  });

  const write = async (action: 'reply' | 'resolve') => {
    setBusy(true);
    setError(null);
    try {
      const header = await supportTokens.headers(id);
      const { data, error: problem } =
        action === 'reply'
          ? await api.POST('/v1/support/conversations/{conversationId}/messages', {
              params: { path: { conversationId: id }, header },
              body: { message: reply },
            })
          : await api.POST('/v1/support/conversations/{conversationId}/resolve', {
              params: { path: { conversationId: id }, header },
            });
      if (data) {
        queryClient.setQueryData(key, data);
        if (action === 'reply') setReply('');
        return;
      }
      const slug = (problem as { type?: string } | undefined)?.type ?? '';
      setError(
        slug.endsWith('/support-conversation-full')
          ? t('support.errors.full')
          : t('support.errors.generic'),
      );
    } catch {
      setError(t('support.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (query.isPending) return <Loading label={t('common.loading')} />;
  const conversation = query.data;
  if (!conversation) {
    return <Notice testID="support-missing" body={t('support.conversation.notFound')} />;
  }
  const author = (value: Conversation['messages'][number]['author']): string =>
    value === 'customer'
      ? t('support.conversation.you')
      : value === 'staff'
        ? t('support.conversation.staff')
        : value === 'assistant'
          ? t('support.conversation.assistant')
          : t('support.conversation.system');

  return (
    <ScrollView contentContainerClassName="gap-4 p-4" testID="support-conversation">
      <Stack.Screen
        options={{
          title: t('support.conversation.title', { reference: conversation.reference }),
        }}
      />
      <View testID="support-status">
        <Badge variant={STATUS_VARIANT[conversation.status]}>
          {t(`support.status.${conversation.status}`)}
        </Badge>
      </View>
      {conversation.messages.map((message) => (
        <View
          key={message.id}
          testID={`support-message-${message.author}`}
          className={
            message.author === 'customer'
              ? 'ms-12 gap-1 rounded-lg bg-primary-subtle p-4'
              : 'me-12 gap-1 rounded-lg border border-border bg-surface p-4'
          }
        >
          <Text className="font-body-medium text-body-sm text-foreground">
            {author(message.author)} · {format.dateTime(message.createdAt)}
          </Text>
          <Text className="font-body text-body text-foreground">
            {message.kind === 'handover' ? t('support.conversation.handover') : message.text}
          </Text>
          {message.author === 'assistant' && message.kind !== 'handover' ? (
            <Text className="font-body text-body-sm text-muted">
              {t('support.conversation.assistantNote')}
            </Text>
          ) : null}
        </View>
      ))}
      {conversation.status === 'resolved' ? (
        <Text className="font-body text-body-sm text-muted">
          {t('support.conversation.resolved')}
        </Text>
      ) : null}
      <MessageBox
        label={t('support.conversation.reply')}
        value={reply}
        onChange={setReply}
        testID="support-reply"
      />
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Button
        testID="support-send"
        loading={busy}
        disabled={reply.trim() === ''}
        onPress={() => void write('reply')}
      >
        {t('support.conversation.send')}
      </Button>
      {conversation.status === 'resolved' ? null : (
        <Button
          testID="support-resolve"
          variant="ghost"
          disabled={busy}
          onPress={() => void write('resolve')}
        >
          {t('support.conversation.resolve')}
        </Button>
      )}
    </ScrollView>
  );
}
