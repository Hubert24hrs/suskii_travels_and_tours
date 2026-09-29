import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppLink } from '../../../components/app-link';
import { Breadcrumbs } from '../../../components/breadcrumbs';
import { DealCards } from '../../../components/home/fresh-flight-offers';
import { Container } from '../../../components/layout/container';
import { EMPTY_FLIGHT_STATE } from '../../../components/search/form-state';
import { SearchPanel } from '../../../components/search/search-panel';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

interface Props {
  params: Promise<{ route: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t, currency } = await getI18n();
  const { route } = await params;
  const data = await api.dealRoute(route, currency);
  if (!data) return {};
  const names = { origin: data.origin.cityName, destination: data.destination.cityName };
  return pageMetadata({
    title: t('pages.route.title', names),
    description: t('pages.route.description', names),
    path: `/flights/${data.slug}`,
  });
}

/** Programmatic SEO page for a popular route, with the latest cached fare (ADR-011). */
export default async function RoutePage({ params }: Props) {
  const { t, currency } = await getI18n();
  const { route } = await params;
  const [data, destinations] = await Promise.all([
    api.dealRoute(route, currency),
    api.hotelDestinations(currency),
  ]);
  if (!data) notFound();
  const names = { origin: data.origin.cityName, destination: data.destination.cityName };
  const card = data.deal ? (await DealCards({ deals: [data.deal] }))[0]?.card : null;
  const place = (point: typeof data.origin) => ({
    code: point.code,
    name: point.cityName,
    city: point.cityName,
    countryCode: point.countryCode,
  });
  return (
    <>
      <Container className="flex flex-col gap-4 pt-6 pb-8">
        <Breadcrumbs
          items={[
            { name: t('verticals.flights'), path: '/flights' },
            { name: t('sections.deals.route', names), path: `/flights/${data.slug}` },
          ]}
        />
        <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
          {t('pages.route.heading', names)}
        </h1>
        <p className="max-w-dialog font-body text-body text-foreground">
          {t('pages.route.description', names)}
        </p>
      </Container>
      <section aria-labelledby="route-search">
        <Container>
          <h2 id="route-search" className="mb-4 font-heading text-h3 font-bold text-heading">
            {t('pages.route.searchCta')}
          </h2>
        </Container>
        <SearchPanel
          defaultTab="flights"
          overlap={false}
          destinations={destinations?.destinations ?? []}
          initial={{
            flights: {
              ...EMPTY_FLIGHT_STATE,
              origin: place(data.origin),
              destination: place(data.destination),
            },
          }}
        />
      </section>
      <Container className="mt-12 grid gap-8 lg:grid-cols-3">
        <section aria-labelledby="latest-fare" className="flex min-w-0 flex-col gap-4">
          <h2 id="latest-fare" className="font-heading text-h3 font-bold text-heading">
            {t('pages.route.latestFare')}
          </h2>
          {card ?? <p className="font-body text-body text-muted">{t('pages.route.noFare')}</p>}
        </section>
        {data.relatedRoutes.length > 0 ? (
          <section
            aria-labelledby="other-routes"
            className="flex min-w-0 flex-col gap-2 lg:col-span-2"
          >
            <h2 id="other-routes" className="font-heading text-h3 font-bold text-heading">
              {t('pages.route.otherRoutes', { origin: data.origin.cityName })}
            </h2>
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {data.relatedRoutes.map((related) => (
                <li key={related.slug}>
                  <AppLink
                    href={`/flights/${related.slug}`}
                    className="inline-flex min-h-12 items-center font-body text-body-sm text-foreground hover:text-primary hover:underline focus-visible:focus-ring"
                  >
                    {t('sections.popular.route', {
                      origin: related.origin.cityName,
                      destination: related.destination.cityName,
                    })}
                  </AppLink>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </Container>
    </>
  );
}
