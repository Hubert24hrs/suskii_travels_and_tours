import type { Schemas } from '@suskii/api-client';
import { Badge } from '@suskii/ui-web';
import { notFound } from 'next/navigation';

import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';
import { Breadcrumbs } from '../breadcrumbs';
import { Container } from '../layout/container';

export type HubSide = 'from' | 'to';
type CityRoute = Schemas['DealCity']['departures'][number];

const LINK =
  'inline-flex min-h-12 items-center font-body text-body-sm text-primary hover:underline focus-visible:focus-ring';

/** One hub list: each route with its latest fare, typical fare and direct flights (ADR-080). */
async function RouteList({ routes }: { routes: CityRoute[] }) {
  const { t, format } = await getI18n();
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="hub-routes">
      {routes.map((route) => (
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
          {route.deal ? (
            <p className="font-body text-body-sm text-foreground">
              {t('pages.hub.latest', { price: format.moneyFrom(route.deal.price) })}
            </p>
          ) : (
            <p className="font-body text-body-sm text-muted">{t('pages.hub.checking')}</p>
          )}
          {route.typical ? (
            <p className="font-body text-body-sm text-muted">
              {t('pages.hub.typical', { price: format.moneyFrom(route.typical) })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {route.direct ? <Badge variant="info">{t('pages.hub.direct')}</Badge> : null}
            {route.deal?.sample ? <Badge variant="warning">{t('common.sampleFare')}</Badge> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Data for a hub page, or a 404 when the city has no route on this side. */
export async function loadHub(slug: string, side: HubSide) {
  const { currency } = await getI18n();
  const data = await api.dealCity(slug, currency);
  const routes = data ? (side === 'from' ? data.departures : data.arrivals) : [];
  return data && routes.length > 0 ? { data, routes } : null;
}

/** "Flights from {city}" or "Flights to {city}": popular routes with fares, both directions linked. */
export async function CityHub({ slug, side }: { slug: string; side: HubSide }) {
  const { t } = await getI18n();
  const hub = await loadHub(slug, side);
  if (!hub) notFound();
  const { data, routes } = hub;
  const city = data.city.name;
  const other = side === 'from' ? data.arrivals : data.departures;
  return (
    <Container className="flex flex-col gap-6 pt-6 pb-12">
      <Breadcrumbs
        items={[
          { name: t('verticals.flights'), path: '/flights' },
          {
            name: t(side === 'from' ? 'pages.hub.fromHeading' : 'pages.hub.toHeading', { city }),
            path: `/flights/${side}/${slug}`,
          },
        ]}
      />
      <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
        {t(side === 'from' ? 'pages.hub.fromTitle' : 'pages.hub.toTitle', { city })}
      </h1>
      <p className="max-w-dialog font-body text-body text-foreground">
        {t(side === 'from' ? 'pages.hub.fromDescription' : 'pages.hub.toDescription', { city })}
      </p>
      <section aria-labelledby="hub-routes" className="flex flex-col gap-4">
        <h2 id="hub-routes" className="font-heading text-h3 font-bold text-heading">
          {t(side === 'from' ? 'pages.hub.routesFrom' : 'pages.hub.routesTo', { city })}
        </h2>
        <RouteList routes={routes} />
        <p className="font-body text-caption text-muted">{t('pages.hub.note')}</p>
      </section>
      {other.length > 0 ? (
        <AppLink href={`/flights/${side === 'from' ? 'to' : 'from'}/${slug}`} className={LINK}>
          {t(side === 'from' ? 'pages.route.toCity' : 'pages.route.fromCity', { city })}
        </AppLink>
      ) : null}
    </Container>
  );
}
