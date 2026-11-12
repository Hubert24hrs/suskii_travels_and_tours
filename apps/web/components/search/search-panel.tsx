import type { Vertical } from '@suskii/shared';
import { I18nProvider } from '@suskii/i18n/react';

import type { HotelDestination } from '../../lib/api';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';
import { getDataSaver } from '../../lib/preferences';
import { AppLink } from '../app-link';
import { Container } from '../layout/container';

import { SearchModule, type SearchInitialState } from './search-module';
import { pickSearchMessages } from './search-messages';

/**
 * Server wrapper for the search card: hands the client module only the catalog namespaces it
 * needs and overlaps it with the hero above.
 */
export async function SearchPanel({
  defaultTab = 'flights',
  destinations = [],
  initial,
  overlap = true,
}: {
  defaultTab?: Vertical;
  destinations?: HotelDestination[];
  initial?: SearchInitialState;
  overlap?: boolean;
}) {
  const [{ t, locale, currency, messages }, dataSaver] = await Promise.all([
    getI18n(),
    getDataSaver(),
  ]);
  return (
    <Container className={overlap ? 'relative z-10 -mt-16' : undefined}>
      <I18nProvider locale={locale} messages={pickSearchMessages(messages)}>
        <SearchModule
          defaultTab={defaultTab}
          apiBaseUrl={publicEnv.apiBaseUrl}
          locale={locale}
          currency={currency}
          pageSize={dataSaver ? 10 : 20}
          citySuggestions={destinations.map((destination) => ({
            id: destination.city.id,
            name: destination.city.name,
            countryName: destination.country.name,
          }))}
          initial={initial}
          // A booking takes up to nine travellers; larger groups are a request (ADR-093). The
          // link is rendered here, on the server, so the homepage's JavaScript does not grow.
          flightsFooter={
            <AppLink
              href="/flights/groups"
              className="inline-flex min-h-6 items-center self-start font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring"
              data-testid="group-request-link"
            >
              {t('search.flights.groupLink')}
            </AppLink>
          }
        />
      </I18nProvider>
    </Container>
  );
}
