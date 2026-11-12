'use client';

import { useEffect, useId, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { useResultsT } from './results-messages';

type Nearby = Schemas['NearbyAirports']['items'];

/**
 * Other airports near each end of a one-way or return search, as links to the same search from
 * or to that airport. Nothing renders when neither end has one.
 */
export default function NearbyAirports({
  origin,
  destination,
  params,
}: {
  origin: string;
  destination: string;
  /** The search in the URL; a link changes only one airport. */
  params: URLSearchParams;
}) {
  const { t } = useResultsT();
  const headingId = useId();
  const key = `${origin}-${destination}`;
  const [loaded, setLoaded] = useState<{ key: string; from: Nearby; to: Nearby } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const [from, to] = key.split('-') as [string, string];
    const near = (iataCode: string): Promise<Nearby> =>
      browserApi()
        .GET('/v1/catalog/airports/{iataCode}/nearby', {
          params: { path: { iataCode }, query: { limit: 3 } },
        })
        .then(({ data }) => data?.items ?? [])
        .catch(() => []);
    void Promise.all([near(from), near(to)]).then(([fromItems, toItems]) => {
      if (cancelled) return;
      setLoaded({
        key,
        // Never a search from an airport to itself.
        from: fromItems.filter((airport) => airport.code !== to),
        to: toItems.filter((airport) => airport.code !== from),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (loaded?.key !== key || (loaded.from.length === 0 && loaded.to.length === 0)) return null;

  const row = (label: string, param: 'from' | 'to', airports: Nearby) =>
    airports.length === 0 ? null : (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-body text-body-sm font-bold text-heading">{label}</span>
        {airports.map((airport) => {
          const next = new URLSearchParams(params);
          next.set(param, airport.code);
          return (
            <AppLink
              key={airport.code}
              href={`/flights/search?${next.toString()}`}
              data-testid={`nearby-${param}-${airport.code}`}
              className="inline-flex min-h-6 items-center font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring"
            >
              {t('results.nearby.airport', {
                name: airport.name,
                code: airport.code,
                distance: airport.distanceKm,
              })}
            </AppLink>
          );
        })}
      </li>
    );

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
      data-testid="nearby-airports"
    >
      <h3 id={headingId} className="font-heading text-h4 font-bold text-heading">
        {t('results.nearby.heading')}
      </h3>
      <ul className="flex flex-col gap-2">
        {row(t('results.nearby.from'), 'from', loaded.from)}
        {row(t('results.nearby.to'), 'to', loaded.to)}
      </ul>
    </section>
  );
}
