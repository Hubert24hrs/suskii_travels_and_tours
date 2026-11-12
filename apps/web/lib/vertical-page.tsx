import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AvailabilityNotice } from '../components/availability-notice';
import { FlexiblePayment } from '../components/home/flexible-payment';
import { Hero } from '../components/home/hero';
import { SearchPanel } from '../components/search/search-panel';

import { api } from './api';
import { getI18n } from './i18n';
import { verticalInitial, type SearchParams } from './search-initial';
import { pageMetadata } from './seo';

type ComingVertical = 'packages' | 'tours' | 'visa' | 'travel_addons';

const PATHS: Record<ComingVertical, string> = {
  packages: '/packages',
  tours: '/tours',
  visa: '/visa',
  travel_addons: '/travel-add-ons',
};

export async function verticalMetadata(
  vertical: ComingVertical,
  searchParams: Promise<SearchParams>,
): Promise<Metadata> {
  const { t } = await getI18n();
  const hasQuery = Object.keys(await searchParams).length > 0;
  return pageMetadata({
    title: t(`pages.verticals.${vertical}.title`),
    description: t(`pages.verticals.${vertical}.body`),
    path: PATHS[vertical],
    // A filled-in search is a personal, parameter-driven view: keep it out of the index.
    noIndex: hasQuery,
  });
}

/**
 * Landing page for an in-house vertical (ADR-025): the pre-filled search form, then the results
 * or content passed as children (the "being added" notice when there are none).
 */
export async function VerticalPage({
  vertical,
  searchParams,
  children,
}: {
  vertical: ComingVertical;
  searchParams: Promise<SearchParams>;
  children?: ReactNode;
}) {
  const { t, locale, currency } = await getI18n();
  const query = await searchParams;
  const [site, destinations, { initial, hasQuery }] = await Promise.all([
    api.site(locale),
    api.hotelDestinations(currency),
    verticalInitial(vertical, query),
  ]);
  return (
    <>
      <Hero
        title={t(`pages.verticals.${vertical}.heading`)}
        subtitle={t(`pages.verticals.${vertical}.body`)}
        trustSignals={site?.trustSignals ?? []}
      />
      <SearchPanel
        defaultTab={vertical}
        destinations={destinations?.destinations ?? []}
        initial={initial}
      />
      {children ?? <AvailabilityNotice vertical={vertical} hasSearch={hasQuery} />}
      {vertical === 'packages' || vertical === 'tours' ? <FlexiblePayment /> : null}
    </>
  );
}
