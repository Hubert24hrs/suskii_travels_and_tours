import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { Breadcrumbs } from '../../../components/breadcrumbs';
import { Container } from '../../../components/layout/container';
import { GroupRequest } from '../../../components/support/group-request';
import { pickGroupRequestMessages } from '../../../components/support/group-request-messages';
import { publicEnv } from '../../../lib/env';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('groups.title'),
    description: t('groups.description'),
    path: '/flights/groups',
  });
}

/**
 * Flights for ten travellers or more (ADR-093): airlines price groups through their group desks,
 * so the page takes a request that the team answers in a support conversation.
 */
export default async function GroupFlightsPage() {
  const { t, locale, messages } = await getI18n();
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <Breadcrumbs
        items={[
          { name: t('verticals.flights'), path: '/flights' },
          { name: t('groups.title'), path: '/flights/groups' },
        ]}
      />
      <div className="flex max-w-dialog flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('groups.heading')}</h1>
        <p className="font-body text-body text-foreground">{t('groups.body')}</p>
      </div>
      <div className="max-w-dialog">
        <I18nProvider locale={locale} messages={pickGroupRequestMessages(messages)}>
          <GroupRequest
            apiBaseUrl={publicEnv.apiBaseUrl}
            locale={locale}
            turnstileSiteKey={publicEnv.turnstileSiteKey}
          />
        </I18nProvider>
      </div>
    </Container>
  );
}
