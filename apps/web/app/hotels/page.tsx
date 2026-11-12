import { I18nProvider } from '@suskii/i18n/react';
import type { Metadata } from 'next';

import { Hero } from '../../components/home/hero';
import { TopHotelDestinations } from '../../components/home/top-hotel-destinations';
import {
  LastMinuteDeals,
  RecentHotelSearches,
} from '../../components/search/recent-hotel-searches';
import { SearchPanel } from '../../components/search/search-panel';
import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('pages.verticals.hotels.title'),
    description: t('pages.verticals.hotels.body'),
    path: '/hotels',
  });
}

export default async function HotelsPage() {
  const { t, locale, currency, messages } = await getI18n();
  const [site, destinations] = await Promise.all([
    api.site(locale),
    api.hotelDestinations(currency),
  ]);
  const list = destinations?.destinations ?? [];
  return (
    <>
      <Hero
        title={t('pages.verticals.hotels.heading')}
        subtitle={t('pages.verticals.hotels.body')}
        trustSignals={site?.trustSignals ?? []}
      />
      <SearchPanel defaultTab="hotels" destinations={list} />
      <I18nProvider locale={locale} messages={{ discover: messages.results.discover }}>
        <RecentHotelSearches />
      </I18nProvider>
      <TopHotelDestinations destinations={list} />
      <I18nProvider locale={locale} messages={{ discover: messages.results.discover }}>
        <LastMinuteDeals cities={list.slice(0, 6).map((destination) => destination.city)} />
      </I18nProvider>
    </>
  );
}
