import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { pickCarsMessages } from '../../components/cars/cars-messages';
import { CarsHeader } from '../../components/cars/cars-header';
import { RideRequest } from '../../components/cars/ride-request';
import { Container } from '../../components/layout/container';
import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('cars.rides.title'),
    description: t('cars.rides.description'),
    path: '/rides',
  });
}

/** Rides (ADR-051): places, ride type and time, then the upfront fare at checkout. */
export default async function RidesPage() {
  const { t, locale, messages, currency } = await getI18n();
  const places = await api.ridePlaces();
  if (!places) notFound();
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <CarsHeader
        heading={t('cars.rides.heading')}
        body={t('cars.rides.body')}
        trail={[
          { name: t('cars.hub.title'), path: '/cars' },
          { name: t('cars.rides.title'), path: '/rides' },
        ]}
      />
      <I18nProvider locale={locale} messages={pickCarsMessages(messages)}>
        <RideRequest places={places.places} currency={currency} />
      </I18nProvider>
    </Container>
  );
}
