import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { Breadcrumbs } from '../../components/breadcrumbs';
import { Container } from '../../components/layout/container';
import { PriceRequests } from '../../components/quotes/price-requests';
import { pickQuotesMessages } from '../../components/quotes/quotes-messages';
import { getI18n } from '../../lib/i18n';
import { getPreferences } from '../../lib/preferences';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('quotes.heading'),
    description: t('quotes.intro'),
    path: '/quotes',
    // A traveller's own requests: never indexed.
    noIndex: true,
  });
}

/**
 * Price requests (ADR-104): a signed-in traveller asks for a price to be confirmed and sees
 * where each request stands. A person verifies every price; nothing here books or pays.
 */
export default async function QuotesPage() {
  const { t, locale, messages } = await getI18n();
  const { currency } = await getPreferences();
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <Breadcrumbs items={[{ name: t('quotes.heading'), path: '/quotes' }]} />
      <div className="flex max-w-dialog flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('quotes.heading')}</h1>
        <p className="font-body text-body text-foreground">{t('quotes.intro')}</p>
      </div>
      <I18nProvider locale={locale} messages={pickQuotesMessages(messages)}>
        <PriceRequests currency={currency} />
      </I18nProvider>
    </Container>
  );
}
