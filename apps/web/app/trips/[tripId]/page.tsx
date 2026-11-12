import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { NoAskSuskii } from '../../../components/assistant/ask-suskii';
import { Container } from '../../../components/layout/container';
import { PaymentPageGuard } from '../../../components/payments/payment-page-guard';
import { pickTripMessages } from '../../../components/trips/pick-trip-messages';
import { TripView } from '../../../components/trips/trip-view';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('trips.page.title'),
    description: t('trips.page.title'),
    path: '/trips',
    noIndex: true,
  });
}

/**
 * A traveller's combined trip (ADR-099): private, never indexed, and a page that starts a
 * payment, so only our own scripts run here (ADR-089).
 */
export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { locale, messages, currency } = await getI18n();
  const { tripId } = await params;
  return (
    <Container className="pt-8 pb-16">
      <PaymentPageGuard />
      <NoAskSuskii />
      <I18nProvider locale={locale} messages={pickTripMessages(messages)}>
        <TripView tripId={tripId} currency={currency} />
      </I18nProvider>
    </Container>
  );
}
