import type { Vertical } from '@suskii/shared';
import { I18nProvider } from '@suskii/i18n/react';

import type { HotelDestination } from '../../lib/api';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';
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
  const { locale, currency, messages } = await getI18n();
  return (
    <Container className={overlap ? 'relative z-10 -mt-16' : undefined}>
      <I18nProvider locale={locale} messages={pickSearchMessages(messages)}>
        <SearchModule
          defaultTab={defaultTab}
          apiBaseUrl={publicEnv.apiBaseUrl}
          locale={locale}
          currency={currency}
          citySuggestions={destinations.map((destination) => ({
            id: destination.city.id,
            name: destination.city.name,
            countryName: destination.country.name,
          }))}
          initial={initial}
        />
      </I18nProvider>
    </Container>
  );
}
