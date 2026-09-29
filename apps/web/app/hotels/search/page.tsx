import { I18nProvider } from '@suskii/i18n/react';
import { parseHotelSearchParams } from '@suskii/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { HotelResults } from '../../../components/results/hotel-results';
import { pickResultsMessages } from '../../../components/results/pick-results-messages';
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
  const { t, locale, currency, messages } = await getI18n();
  const query = await searchParams;
  const { state, valid } = await hotelInitial(query);
  const { form } = parseHotelSearchParams(query);
  return (
    <SearchEntry
      vertical="hotels"
      title={t('pages.searchEntry.hotelsTitle')}
      valid={valid}
      initial={{ hotels: state }}
    >
      {form ? (
        <I18nProvider locale={locale} messages={pickResultsMessages(messages)}>
          <Suspense>
            <HotelResults request={form} currency={currency} />
          </Suspense>
        </I18nProvider>
      ) : null}
    </SearchEntry>
  );
}
