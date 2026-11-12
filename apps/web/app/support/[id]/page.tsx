import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { Container } from '../../../components/layout/container';
import { SupportConversation } from '../../../components/support/support-conversation';
import { pickSupportMessages } from '../../../components/support/support-messages';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('support.heading'),
    description: t('support.intro'),
    path: `/support/${(await params).id}`,
    noIndex: true,
  });
}

/**
 * One support conversation (ADR-083). Private: rendered in the browser with the traveller's
 * session or guest token, never indexed (robots.txt keeps crawlers off `/support/`).
 */
export default async function SupportConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { locale, messages } = await getI18n();
  return (
    <Container className="flex max-w-dialog flex-col gap-6 pt-8 pb-16">
      <I18nProvider locale={locale} messages={pickSupportMessages(messages)}>
        <SupportConversation conversationId={(await params).id} />
      </I18nProvider>
    </Container>
  );
}
