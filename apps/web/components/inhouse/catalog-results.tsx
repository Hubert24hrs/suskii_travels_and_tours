import { Button } from '@suskii/ui-web';
import type { ReactNode } from 'react';

import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { packageListQuery, tourListQuery, travellerSuffix } from '../../lib/inhouse-query';
import type { SearchParams } from '../../lib/search-initial';
import { AppLink } from '../app-link';
import { AvailabilityNotice } from '../availability-notice';
import { Container } from '../layout/container';

import { PackageCards, TourCards } from './product-cards';

function ResultsSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section aria-labelledby="catalog-results" className="pt-8 pb-12 md:pb-16">
      <Container className="flex flex-col gap-4">
        <h2 id="catalog-results" className="font-heading text-h3 font-bold text-heading">
          {heading}
        </h2>
        {children}
      </Container>
    </section>
  );
}

async function NoResults({ allHref, allLabel }: { allHref: string; allLabel: string }) {
  const { t } = await getI18n();
  return (
    <div
      role="status"
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6"
    >
      <p className="font-heading text-h4 font-bold text-heading">
        {t('inhouse.noResults.heading')}
      </p>
      <p className="font-body text-body text-foreground">{t('inhouse.noResults.body')}</p>
      <Button asChild variant="secondary">
        <AppLink href={allHref}>{allLabel}</AppLink>
      </Button>
    </div>
  );
}

/**
 * Packages for the search in the URL, or everything on sale when there is no (valid) search.
 * An empty catalog keeps the honest "being added" notice rather than an empty grid.
 */
export async function PackageResults({ query }: { query: SearchParams }) {
  const { t, currency } = await getI18n();
  const search = packageListQuery(query, currency);
  const data = await api.packages(search.api);
  const packages = data?.packages ?? [];
  if (!search.searched && packages.length === 0)
    return <AvailabilityNotice vertical="packages" hasSearch={false} />;
  return (
    <ResultsSection
      heading={
        search.searched
          ? t('inhouse.results.packages', { count: packages.length })
          : t('inhouse.featured')
      }
    >
      {packages.length > 0 ? (
        <PackageCards packages={packages} query={travellerSuffix(search.travellers)} />
      ) : (
        <NoResults allHref="/packages" allLabel={t('inhouse.noResults.packages')} />
      )}
    </ResultsSection>
  );
}

export async function TourResults({ query }: { query: SearchParams }) {
  const { t, currency } = await getI18n();
  const search = tourListQuery(query, currency);
  const data = await api.tours(search.api);
  const tours = data?.tours ?? [];
  if (!search.searched && tours.length === 0)
    return <AvailabilityNotice vertical="tours" hasSearch={false} />;
  return (
    <ResultsSection
      heading={
        search.searched
          ? t('inhouse.results.tours', { count: tours.length })
          : t('inhouse.featured')
      }
    >
      {tours.length > 0 ? (
        <TourCards tours={tours} query={travellerSuffix(search.travellers)} />
      ) : (
        <NoResults allHref="/tours" allLabel={t('inhouse.noResults.tours')} />
      )}
    </ResultsSection>
  );
}
