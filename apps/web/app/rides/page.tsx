import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { pickCarsMessages } from '../../components/cars/cars-messages';
import { CarsHeader } from '../../components/cars/cars-header';
import { RideRequest, type RidePrefill } from '../../components/cars/ride-request';
import { Container } from '../../components/layout/container';
import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import type { SearchParams } from '../../lib/search-initial';
import { pageMetadata } from '../../lib/seo';

interface Props {
  searchParams: Promise<SearchParams>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('cars.rides.title'),
    description: t('cars.rides.description'),
    path: '/rides',
    // A prefilled form (from a trip suggestion) is not a page of its own.
    noIndex: Object.keys(await searchParams).length > 0,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** A prefill from a trip suggestion: a known place id and an instant, anything else ignored. */
function ridePrefill(params: SearchParams): RidePrefill {
  const pickup = one(params.pickup);
  const at = one(params.at);
  return {
    pickup: pickup && UUID.test(pickup) ? pickup : undefined,
    at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : undefined,
  };
}

/** Rides (ADR-051): places, ride type and time, then the upfront fare at checkout. */
export default async function RidesPage({ searchParams }: Props) {
  const { t, locale, messages, currency } = await getI18n();
  const prefill = ridePrefill(await searchParams);
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
        <RideRequest places={places.places} currency={currency} prefill={prefill} />
      </I18nProvider>
    </Container>
  );
}
