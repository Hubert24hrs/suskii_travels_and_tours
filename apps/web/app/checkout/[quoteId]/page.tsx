import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { Checkout } from '../../../components/checkout/checkout';
import { pickBookingMessages } from '../../../components/checkout/pick-booking-messages';
import { Container } from '../../../components/layout/container';
import { api } from '../../../lib/api';
import { publicEnv } from '../../../lib/env';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('checkout.title'),
    description: t('checkout.heading'),
    path: '/checkout',
    noIndex: true,
  });
}

/** Checkout for a quote. Private and never indexed; all traveller data stays client to API. */
export default async function CheckoutPage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { t, locale, messages } = await getI18n();
  const { quoteId } = await params;
  const countries = (await api.countries())?.items ?? [];
  const collator = new Intl.Collator(locale);
  return (
    <Container className="flex flex-col gap-6 pt-8 pb-16">
      <h1 className="font-heading text-h2 font-extrabold text-heading">{t('checkout.heading')}</h1>
      <I18nProvider locale={locale} messages={pickBookingMessages(messages)}>
        <Checkout
          quoteId={quoteId}
          countries={countries
            .map(({ code, name }) => ({ code, name }))
            .sort((a, b) => collator.compare(a.name, b.name))}
          turnstileSiteKey={publicEnv.turnstileSiteKey}
          locale={locale}
        />
      </I18nProvider>
    </Container>
  );
}
