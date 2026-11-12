import { I18nProvider } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { NoAskSuskii } from '../../components/assistant/ask-suskii';
import { AssistantChat } from '../../components/assistant/assistant-chat';
import { AssistantHistory } from '../../components/assistant/assistant-history';
import { pickAssistantMessages } from '../../components/assistant/assistant-messages';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { Container } from '../../components/layout/container';
import { api } from '../../lib/api';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('assistant.title'),
    description: t('assistant.intro'),
    path: '/assistant',
    // A traveller's own conversation: never indexed.
    noIndex: true,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The assistant on a page of its own (ADR-101): the chat, and a signed-in traveller's earlier
 * conversations. Answers 404 while the assistant is switched off, paused or unreachable, so no
 * link leads to a chat that cannot answer.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const status = await api.agentStatus();
  if (!status?.available) notFound();
  const { t, locale, messages } = await getI18n();
  const asked = (await searchParams).conversation;
  const conversationId = typeof asked === 'string' && UUID.test(asked) ? asked : undefined;
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <NoAskSuskii />
      <Breadcrumbs items={[{ name: t('assistant.title'), path: '/assistant' }]} />
      <div className="flex max-w-dialog flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('assistant.title')}</h1>
        <p className="font-body text-body text-foreground">{t('assistant.intro')}</p>
      </div>
      <I18nProvider locale={locale} messages={pickAssistantMessages(messages)}>
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:items-start">
          <Card className="p-6">
            <AssistantChat
              // A different conversation is a different chat: no state carries over.
              key={conversationId ?? 'current'}
              locale={locale}
              turnstileSiteKey={publicEnv.turnstileSiteKey}
              conversationId={conversationId}
            />
          </Card>
          <AssistantHistory current={conversationId ?? null} />
        </div>
      </I18nProvider>
    </Container>
  );
}
