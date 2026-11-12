import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { NoAskSuskii } from '../../../components/assistant/ask-suskii';
import { AssistantMemory } from '../../../components/assistant/assistant-memory';
import { pickAssistantMessages } from '../../../components/assistant/assistant-messages';
import { Breadcrumbs } from '../../../components/breadcrumbs';
import { Container } from '../../../components/layout/container';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('assistant.memory.heading'),
    description: t('assistant.memory.intro'),
    path: '/assistant/preferences',
    // A traveller's own settings: never indexed.
    noIndex: true,
  });
}

/**
 * What the assistant remembers about a traveller (ADR-105): theirs to switch on, read, change
 * and erase. It answers 404 while the assistant is switched off; a pause does not close it,
 * because erasing what is remembered must always be possible.
 */
export default async function AssistantPreferencesPage() {
  const status = await api.agentStatus();
  if (!status?.enabled) notFound();
  const { t, locale, messages } = await getI18n();
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <NoAskSuskii />
      <Breadcrumbs
        items={[
          { name: t('assistant.title'), path: '/assistant' },
          { name: t('assistant.memory.heading'), path: '/assistant/preferences' },
        ]}
      />
      <div className="flex max-w-dialog flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {t('assistant.memory.heading')}
        </h1>
        <p className="font-body text-body text-foreground">{t('assistant.memory.intro')}</p>
      </div>
      <I18nProvider locale={locale} messages={pickAssistantMessages(messages)}>
        <AssistantMemory />
      </I18nProvider>
    </Container>
  );
}
