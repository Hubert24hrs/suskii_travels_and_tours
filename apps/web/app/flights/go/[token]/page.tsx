import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { Container } from '../../../../components/layout/container';
import { MetasearchLanding } from '../../../../components/metasearch/metasearch-landing';
import { pickMetasearchMessages } from '../../../../components/metasearch/metasearch-messages';
import { getI18n } from '../../../../lib/i18n';
import { pageMetadata } from '../../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('pages.metasearch.title'),
    description: t('pages.metasearch.checking'),
    path: '/flights',
    noIndex: true,
  });
}

/**
 * Arrivals from metasearch partners (ADR-081). Private: the sealed link carries the partner's
 * price, so the page is never indexed and robots.txt keeps crawlers out.
 */
export default async function MetasearchLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { t, locale, messages } = await getI18n();
  const { token } = await params;
  return (
    <Container className="flex flex-col gap-6 pt-8 pb-16">
      <h1 className="font-heading text-h2 font-extrabold text-heading">
        {t('pages.metasearch.title')}
      </h1>
      <I18nProvider locale={locale} messages={pickMetasearchMessages(messages)}>
        <MetasearchLanding token={decodeURIComponent(token)} />
      </I18nProvider>
    </Container>
  );
}
