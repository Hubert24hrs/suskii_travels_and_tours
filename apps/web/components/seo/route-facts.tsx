import type { Schemas } from '@suskii/api-client';
import { Badge } from '@suskii/ui-web';

import { getI18n } from '../../lib/i18n';
import { AppLink } from '../app-link';

type RouteFacts = Schemas['RouteFacts'];

const LINK =
  'inline-flex min-h-12 items-center font-body text-body-sm text-primary hover:underline focus-visible:focus-ring';

/**
 * What the fare history says about a route (ADR-080). Every figure says what it is: one adult,
 * return, fares found recently, priced with today's rules.
 */
export async function RouteFactsSection({ facts }: { facts: RouteFacts }) {
  const { t, format } = await getI18n();
  const duration = (minutes: number) =>
    t('results.flights.duration', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  const items: { term: string; value: string; detail?: string; testId: string }[] = [
    { term: t('pages.route.typical'), value: format.moneyFrom(facts.typical), testId: 'typical' },
    {
      term: t('pages.route.cheapest'),
      testId: 'cheapest',
      value: format.moneyFrom(facts.cheapest.price),
      detail: t('pages.route.cheapestDetail', {
        date: format.date(facts.cheapest.departureDate),
        airline: facts.cheapest.carrier.name,
      }),
    },
    {
      term: t('pages.route.direct'),
      testId: 'direct',
      value: facts.direct ? t('pages.route.directYes') : t('pages.route.directNo'),
    },
    { term: t('pages.route.fastest'), value: duration(facts.fastestMinutes), testId: 'fastest' },
    ...(facts.cheapestMonth
      ? [
          {
            term: t('pages.route.cheapestMonth'),
            testId: 'month',
            // Any day of the month names it.
            value: format.date(
              `2000-${String(facts.cheapestMonth).padStart(2, '0')}-15`,
              'monthName',
            ),
          },
        ]
      : []),
  ];
  return (
    <section
      aria-labelledby="route-facts"
      className="flex flex-col gap-4"
      data-testid="route-facts"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="route-facts" className="font-heading text-h3 font-bold text-heading">
          {t('pages.route.factsHeading')}
        </h2>
        {facts.sample ? <Badge variant="warning">{t('pages.route.sampleFacts')}</Badge> : null}
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.testId}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
            data-testid={`fact-${item.testId}`}
          >
            <dt className="font-body text-body-sm text-muted">{item.term}</dt>
            <dd className="font-heading text-h4 font-bold text-heading">{item.value}</dd>
            {item.detail ? (
              <dd className="font-body text-caption text-muted">{item.detail}</dd>
            ) : null}
          </div>
        ))}
      </dl>
      {facts.airlines.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-heading text-body font-bold text-heading">
            {t('pages.route.airlines')}
          </h3>
          <ul className="flex flex-wrap gap-x-4">
            {facts.airlines.map((airline) => (
              <li key={airline.code}>
                <AppLink href={`/airlines/${airline.code.toLowerCase()}`} className={LINK}>
                  {t('pages.route.airlinePage', { airline: airline.name })}
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="font-body text-caption text-muted">{t('pages.route.factsNote')}</p>
    </section>
  );
}
