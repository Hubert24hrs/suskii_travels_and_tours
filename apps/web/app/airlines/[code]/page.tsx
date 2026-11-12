import { Badge } from '@suskii/ui-web';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AppLink } from '../../../components/app-link';
import { Breadcrumbs } from '../../../components/breadcrumbs';
import { Container } from '../../../components/layout/container';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

interface Props {
  params: Promise<{ code: string }>;
}

const AIRLINE_CODE = /^[a-z0-9]{2}$/;

/** The airline's data, or null for a malformed code or an airline we have not seen lately. */
async function load(code: string) {
  if (!AIRLINE_CODE.test(code)) return null;
  const { currency } = await getI18n();
  return api.dealAirline(code.toUpperCase(), currency);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t } = await getI18n();
  const { code } = await params;
  const data = await load(code);
  if (!data) return {};
  const airline = data.airline.name;
  return pageMetadata({
    title: t('pages.airline.title', { airline }),
    description: t('pages.airline.description', { airline }),
    path: `/airlines/${data.airline.code.toLowerCase()}`,
  });
}

/** Airline page (ADR-080): the popular routes we found the airline on, with its own lowest fares. */
export default async function AirlinePage({ params }: Props) {
  const { t, format } = await getI18n();
  const { code } = await params;
  const data = await load(code);
  if (!data) notFound();
  const airline = data.airline.name;
  const duration = (minutes: number) =>
    t('results.flights.duration', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  return (
    <Container className="flex flex-col gap-6 pt-6 pb-12">
      <Breadcrumbs
        items={[
          { name: t('verticals.flights'), path: '/flights' },
          {
            name: t('pages.airline.heading', { airline }),
            path: `/airlines/${data.airline.code.toLowerCase()}`,
          },
        ]}
      />
      <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
        {t('pages.airline.heading', { airline })}
      </h1>
      <p className="max-w-dialog font-body text-body text-foreground">
        {t('pages.airline.description', { airline })}
      </p>
      <section aria-labelledby="airline-routes" className="flex flex-col gap-4">
        <h2 id="airline-routes" className="font-heading text-h3 font-bold text-heading">
          {t('pages.airline.routes', { airline })}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="airline-routes">
          {data.routes.map((route) => (
            <li
              key={route.slug}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
            >
              <AppLink
                href={`/flights/${route.slug}`}
                className="font-heading text-body font-bold text-heading hover:text-primary hover:underline focus-visible:focus-ring"
              >
                {t('sections.popular.route', {
                  origin: route.origin.cityName,
                  destination: route.destination.cityName,
                })}
              </AppLink>
              <p className="font-body text-body-sm text-foreground">
                {t('pages.airline.from', { price: format.moneyFrom(route.cheapest.price) })}
              </p>
              <p className="font-body text-caption text-muted">
                {t('pages.airline.departing', { date: format.date(route.cheapest.departureDate) })}
                {' · '}
                {t('pages.airline.fastest', { duration: duration(route.fastestMinutes) })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant={route.direct ? 'info' : 'neutral'}>
                  {route.direct ? t('pages.airline.nonstop') : t('pages.airline.connecting')}
                </Badge>
                {route.sample ? <Badge variant="warning">{t('common.sampleFare')}</Badge> : null}
              </div>
            </li>
          ))}
        </ul>
        <p className="font-body text-caption text-muted">{t('pages.airline.note')}</p>
      </section>
    </Container>
  );
}
