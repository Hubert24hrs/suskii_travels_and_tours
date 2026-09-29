import type { Metadata } from 'next';

import { SearchEntry } from '../../../components/search-entry';
import { getI18n } from '../../../lib/i18n';
import { flightInitial, type SearchParams } from '../../../lib/search-initial';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('pages.searchEntry.flightsTitle'),
    description: t('pages.verticals.flights.body'),
    path: '/flights/search',
    noIndex: true,
  });
}

export default async function FlightSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { t } = await getI18n();
  const { state, valid } = await flightInitial(await searchParams);
  return (
    <SearchEntry
      vertical="flights"
      title={t('pages.searchEntry.flightsTitle')}
      valid={valid}
      initial={{ flights: state }}
    />
  );
}
