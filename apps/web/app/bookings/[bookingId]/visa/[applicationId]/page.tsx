import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { VisaApplicationView } from '../../../../../components/checkout/visa-application';
import { pickVisaApplicationMessages } from '../../../../../components/checkout/visa-application-messages';
import { Container } from '../../../../../components/layout/container';
import { getI18n } from '../../../../../lib/i18n';
import { pageMetadata } from '../../../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('visa.application.title'),
    description: t('visa.application.title'),
    path: '/bookings',
    noIndex: true,
  });
}

/** A visa application's documents and status. Private: data stays between the browser and API. */
export default async function VisaApplicationPage({
  params,
}: {
  params: Promise<{ bookingId: string; applicationId: string }>;
}) {
  const { locale, messages } = await getI18n();
  const { bookingId, applicationId } = await params;
  return (
    <Container className="flex flex-col gap-6 pt-8 pb-16">
      <I18nProvider locale={locale} messages={pickVisaApplicationMessages(messages)}>
        <VisaApplicationView bookingId={bookingId} applicationId={applicationId} />
      </I18nProvider>
    </Container>
  );
}
