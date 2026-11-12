import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { pickCarsMessages } from '../../../components/cars/cars-messages';
import { LiveRide } from '../../../components/cars/live-ride';
import { Container } from '../../../components/layout/container';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('cars.rides.live.title'),
    description: t('cars.rides.live.title'),
    path: '/rides',
    noIndex: true,
  });
}

/** The rider's live ride. Private: the API answers 404 to anyone but the rider. */
export default async function LiveRidePage({ params }: { params: Promise<{ rideId: string }> }) {
  const { t, locale, messages } = await getI18n();
  const { rideId } = await params;
  return (
    <Container className="flex flex-col gap-6 pt-8 pb-16">
      <h1 className="font-heading text-h2 font-extrabold text-heading">
        {t('cars.rides.live.title')}
      </h1>
      <I18nProvider locale={locale} messages={pickCarsMessages(messages)}>
        <LiveRide rideId={rideId} />
      </I18nProvider>
    </Container>
  );
}
