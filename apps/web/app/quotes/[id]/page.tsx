import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '../../../components/breadcrumbs';
import { Container } from '../../../components/layout/container';
import { PriceRequest } from '../../../components/quotes/price-requests';
import { pickQuotesMessages } from '../../../components/quotes/quotes-messages';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { t } = await getI18n();
  const { id } = await params;
  return pageMetadata({
    title: t('quotes.heading'),
    description: t('quotes.intro'),
    path: `/quotes/${id}`,
    noIndex: true,
  });
}

/**
 * One price request (ADR-104), read in the browser with the traveller's session: the server
 * never sees whose it is, and anyone else is told it is not available.
 */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { t, locale, messages } = await getI18n();
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <Breadcrumbs
        items={[
          { name: t('quotes.heading'), path: '/quotes' },
          { name: t('quotes.offer.heading'), path: `/quotes/${id}` },
        ]}
      />
      <h1 className="font-heading text-h2 font-extrabold text-heading">{t('quotes.heading')}</h1>
      <I18nProvider locale={locale} messages={pickQuotesMessages(messages)}>
        <PriceRequest quoteId={id} />
      </I18nProvider>
    </Container>
  );
}
