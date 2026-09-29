import type { Metadata } from 'next';

import { FreshFlightOffers } from '../../components/home/fresh-flight-offers';
import { Hero } from '../../components/home/hero';
import { SeoContent } from '../../components/home/seo-content';
import { SearchPanel } from '../../components/search/search-panel';
import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('pages.verticals.flights.title'),
    description: t('pages.verticals.flights.body'),
    path: '/flights',
  });
}

export default async function FlightsPage() {
  const { t, locale, currency } = await getI18n();
  const [site, deals, destinations, routes] = await Promise.all([
    api.site(locale),
    api.deals(currency),
    api.hotelDestinations(currency),
    api.dealRoutes(),
  ]);
  return (
    <>
      <Hero
        title={t('pages.verticals.flights.heading')}
        subtitle={t('pages.verticals.flights.body')}
        trustSignals={site?.trustSignals ?? []}
      />
      <SearchPanel defaultTab="flights" destinations={destinations?.destinations ?? []} />
      <FreshFlightOffers deals={deals?.deals ?? []} origins={deals?.origins ?? []} />
      <SeoContent faqs={[]} routes={routes?.routes ?? []} destinations={[]} />
    </>
  );
}
