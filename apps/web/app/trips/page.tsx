import { I18nProvider } from '@suskii/i18n/react';
import { TRIP_COMPONENTS } from '@suskii/shared';
import type { Metadata } from 'next';

import { Breadcrumbs } from '../../components/breadcrumbs';
import { Container } from '../../components/layout/container';
import { pickPlannerMessages } from '../../components/trips/pick-trip-messages';
import { TripPlanner } from '../../components/trips/trip-planner';
import { api } from '../../lib/api';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('trips.title'),
    description: t('trips.metaDescription'),
    path: '/trips',
  });
}

/**
 * The trip builder (ADR-099): a flight, a hotel, a rental car, an airport transfer and travel
 * insurance put together, or only the parts a traveller wants, and paid once. This page takes
 * the plan; each part is then chosen on its ordinary search.
 */
export default async function TripsPage() {
  const { t, locale, messages } = await getI18n();
  const cars = await api.carsFeatures();
  // Car rental can be switched off (ADR-049); the builder then offers the other parts.
  const components = TRIP_COMPONENTS.filter((part) => part !== 'car' || cars?.rentals === true);
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <Breadcrumbs items={[{ name: t('trips.title'), path: '/trips' }]} />
      <div className="flex max-w-dialog flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('trips.title')}</h1>
        <p className="font-body text-body text-foreground">{t('trips.intro')}</p>
      </div>
      <I18nProvider locale={locale} messages={pickPlannerMessages(messages)}>
        <TripPlanner apiBaseUrl={publicEnv.apiBaseUrl} locale={locale} components={components} />
      </I18nProvider>
    </Container>
  );
}
