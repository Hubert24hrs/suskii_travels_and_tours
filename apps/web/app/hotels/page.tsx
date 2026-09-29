import type { Metadata } from 'next';

import { Hero } from '../../components/home/hero';
import { TopHotelDestinations } from '../../components/home/top-hotel-destinations';
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
  const { t, locale, currency } = await getI18n();
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
      <TopHotelDestinations destinations={list} />
    </>
  );
}
