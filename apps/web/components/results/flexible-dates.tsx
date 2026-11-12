'use client';

import { useFormatters } from '@suskii/i18n/react';
import type { CurrencyCode } from '@suskii/shared/lite';
import { Badge } from '@suskii/ui-web';
import { useEffect, useId, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { FlexibleDatesLoading } from './result-states';
import { useResultsT } from './results-messages';

type Prices = Schemas['FlightDatePrices'];
type Day = Prices['days'][number];

/**
 * "Flexible dates": the lowest total on each day around the search, each a link to that day's
 * search. A return trip keeps its length, so both dates move. Shown only when the traveller
 * asked for flexible dates: every day that is not cached is a supplier search (ADR-093).
 */
export default function FlexibleDates({
  request,
  currency,
  params,
}: {
  request: Schemas['FlightSearchRequestInput'];
  currency: CurrencyCode;
  /** The search in the URL; a day's link changes only its dates. */
  params: URLSearchParams;
}) {
  const { t } = useResultsT();
  const format = useFormatters();
  const headingId = useId();
  const key = JSON.stringify([request, currency]);
  const [loaded, setLoaded] = useState<{ key: string; prices: Prices | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const [body, priceCurrency] = JSON.parse(key) as [
      Schemas['FlightSearchRequestInput'],
      CurrencyCode,
    ];
    browserApi()
      .POST('/v1/flights/date-prices', { params: { query: { currency: priceCurrency } }, body })
      .then(({ data }) => {
        if (!cancelled) setLoaded({ key, prices: data ?? null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, prices: null });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (loaded?.key !== key)
    return (
      <FlexibleDatesLoading
        heading={t('results.flexible.heading')}
        label={t('results.flexible.loading')}
      />
    );
  const prices = loaded.prices;
  if (!prices)
    return (
      <p role="status" className="font-body text-body-sm text-foreground">
        {t('results.flexible.failed')}
      </p>
    );
  if (prices.days.length === 0) return null;

  const href = (day: Day): string => {
    const next = new URLSearchParams(params);
    next.set('depart', day.departureDate);
    if (day.returnDate) next.set('return', day.returnDate);
    next.set('flex', '1');
    return `/flights/search?${next.toString()}`;
  };
  const price = (day: Day): string =>
    day.total
      ? format.money(day.total)
      : t(day.status === 'none' ? 'results.flexible.none' : 'results.flexible.check');

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
      data-testid="flexible-dates"
    >
      <h3 id={headingId} className="font-heading text-h4 font-bold text-heading">
        {t('results.flexible.heading')}
      </h3>
      <ol className="flex gap-2 overflow-x-auto p-1">
        {prices.days.map((day) => {
          const date = format.date(day.departureDate, 'weekday');
          const current = day.offset === 0;
          return (
            <li key={day.offset} className="shrink-0">
              <AppLink
                href={href(day)}
                aria-current={current ? 'date' : undefined}
                aria-label={t('results.flexible.dayLabel', { date, price: price(day) })}
                data-testid={`flexible-day-${day.offset}`}
                className={`flex min-h-12 flex-col items-start gap-1 rounded-md border px-3 py-2 focus-visible:focus-ring ${
                  current ? 'border-primary bg-primary-subtle' : 'border-border-strong bg-surface'
                }`}
              >
                <span className="font-body text-body-sm font-bold text-foreground">{date}</span>
                <span className="font-body text-body-sm text-foreground">{price(day)}</span>
                {day.offset === prices.cheapestOffset ? (
                  <Badge variant="success">{t('results.flexible.lowest')}</Badge>
                ) : current ? (
                  <span className="font-body text-caption text-foreground">
                    {t('results.flexible.yourDate')}
                  </span>
                ) : null}
              </AppLink>
            </li>
          );
        })}
      </ol>
      <p className="font-body text-caption text-foreground">
        {t('results.flexible.note')}
        {request.slices.length > 1 ? ` ${t('results.flexible.returnNote')}` : ''}
      </p>
    </section>
  );
}
