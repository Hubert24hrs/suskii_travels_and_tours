import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { pickCarsMessages } from '../../../components/cars/cars-messages';
import { SharedTrip } from '../../../components/cars/shared-trip';
import { Container } from '../../../components/layout/container';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('cars.rides.shared.title'),
    description: t('cars.rides.shared.title'),
    path: '/trip',
    noIndex: true,
  });
}

/** A shared live trip: anyone with the 128-bit token, until 30 minutes after the trip. */
export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { t, locale, messages } = await getI18n();
  const { token } = await params;
  return (
    <Container className="flex flex-col gap-6 pt-8 pb-16">
      <h1 className="font-heading text-h2 font-extrabold text-heading">
        {t('cars.rides.shared.title')}
      </h1>
      <I18nProvider locale={locale} messages={pickCarsMessages(messages)}>
        <SharedTrip token={token} />
      </I18nProvider>
    </Container>
  );
}
