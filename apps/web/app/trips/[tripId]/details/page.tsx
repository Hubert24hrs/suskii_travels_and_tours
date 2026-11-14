import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { NoAskSuskii } from '../../../../components/assistant/ask-suskii';
import { Container } from '../../../../components/layout/container';
import { PaymentPageGuard } from '../../../../components/payments/payment-page-guard';
import { pickTripMessages } from '../../../../components/trips/pick-trip-messages';
import { TripDetails } from '../../../../components/trips/trip-details';
import { api } from '../../../../lib/api';
import { getI18n } from '../../../../lib/i18n';
import { pageMetadata } from '../../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('trips.details.title'),
    description: t('trips.details.heading'),
    path: '/trips',
    noIndex: true,
  });
}

/**
 * One details form for a whole trip (ADR-118): every traveller once, for each part Ask Suskii
 * prepared. Private, never indexed, and part of the trip's way to its payment, so only our own
 * scripts run here (ADR-089).
 */
export default async function TripDetailsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { locale, messages } = await getI18n();
  const { tripId } = await params;
  const countries = (await api.countries())?.items ?? [];
  const collator = new Intl.Collator(locale);
  return (
    <Container className="pt-8 pb-16">
      <PaymentPageGuard />
      <NoAskSuskii />
      <I18nProvider locale={locale} messages={pickTripMessages(messages)}>
        <TripDetails
          tripId={tripId}
          locale={locale}
          countries={countries
            .map(({ code, name }) => ({ code, name }))
            .sort((a, b) => collator.compare(a.name, b.name))}
        />
      </I18nProvider>
    </Container>
  );
}
