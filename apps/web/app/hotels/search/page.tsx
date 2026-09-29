import type { Metadata } from 'next';

import { SearchEntry } from '../../../components/search-entry';
import { getI18n } from '../../../lib/i18n';
import { hotelInitial, type SearchParams } from '../../../lib/search-initial';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('pages.searchEntry.hotelsTitle'),
    description: t('pages.verticals.hotels.body'),
    path: '/hotels/search',
    noIndex: true,
  });
}

export default async function HotelSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { t } = await getI18n();
  const { state, valid } = await hotelInitial(await searchParams);
  return (
    <SearchEntry
      vertical="hotels"
      title={t('pages.searchEntry.hotelsTitle')}
      valid={valid}
      initial={{ hotels: state }}
    />
  );
}
