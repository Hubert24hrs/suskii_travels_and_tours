import { I18nProvider } from '@suskii/i18n/react';
import { parseFlightSearchParams, toFlightSearchRequest } from '@suskii/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FlightResults } from '../../../components/results/flight-results';
import { pickResultsMessages } from '../../../components/results/pick-results-messages';
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
  const { t, locale, currency, messages } = await getI18n();
  const query = await searchParams;
  const { state, valid } = await flightInitial(query);
  const { form } = parseFlightSearchParams(query);
  return (
    <SearchEntry
      vertical="flights"
      title={t('pages.searchEntry.flightsTitle')}
      valid={valid}
      initial={{ flights: state }}
    >
      {form ? (
        <I18nProvider locale={locale} messages={pickResultsMessages(messages)}>
          <Suspense>
            <FlightResults request={toFlightSearchRequest(form)} currency={currency} />
          </Suspense>
        </I18nProvider>
      ) : null}
    </SearchEntry>
  );
}
