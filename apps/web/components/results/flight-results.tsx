'use client';

import type { paths } from '@suskii/api-client/schema';
import { useFormatters } from '@suskii/i18n/react';
import type { CurrencyCode } from '@suskii/shared/lite';
import { Button } from '@suskii/ui-web';
import { SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { NativeSelect } from '../search/native-select';

import {
  EMPTY_FLIGHT_FILTERS,
  FlightFilters,
  WINDOWS,
  type FlightFilterState,
} from './flight-filters';
import { FlightOfferCard, type FlightOfferCardProps } from './flight-offer-card';
import { ResultsLoading, ResultsMessage } from './result-states';
import { useResultsT } from './results-messages';
import { WatchRoute } from './watch-route';
import { listParam, numberParam, useUrlParams } from './use-url-params';

const SORTS = ['best', 'cheapest', 'fastest', 'earliest'] as const;
type Sort = (typeof SORTS)[number];
type Result = Schemas['FlightSearchResult'];
type SearchRequest = Schemas['FlightSearchRequestInput'];
type ListQuery = NonNullable<
  paths['/v1/flights/searches/{searchId}/offers']['get']['parameters']['query']
>;

type Phase =
  | { kind: 'searching' }
  | { kind: 'ready'; result: Result }
  | { kind: 'error' }
  | { kind: 'expired' };

function filtersFromParams(params: URLSearchParams): FlightFilterState {
  return {
    stops: listParam(params, 'stops', ['0', '1', '2']),
    airlines: listParam(params, 'airlines').filter((code) => /^[A-Z0-9]{2}$/.test(code)),
    windows: listParam(params, 'windows', WINDOWS),
    maxPrice: numberParam(params, 'maxPrice'),
    maxDuration: numberParam(params, 'maxDuration'),
    refundable: params.get('refundable') === '1',
    checkedBag: params.get('bag') === '1',
  };
}

function filtersToParams(filters: FlightFilterState): Record<string, string | null> {
  return {
    stops: filters.stops.join(',') || null,
    airlines: filters.airlines.join(',') || null,
    windows: filters.windows.join(',') || null,
    maxPrice: filters.maxPrice === undefined ? null : String(filters.maxPrice),
    maxDuration: filters.maxDuration === undefined ? null : String(filters.maxDuration),
    refundable: filters.refundable ? '1' : null,
    bag: filters.checkedBag ? '1' : null,
  };
}

/** API query for a sort-and-filter key (see `filterKey`). */
function listQuery(filterKey: string, currency: CurrencyCode): ListQuery {
  const [sort, filters] = JSON.parse(filterKey) as [Sort, FlightFilterState];
  return {
    currency,
    sort,
    limit: 20,
    ...(filters.stops.length > 0 ? { stops: filters.stops.join(',') } : {}),
    ...(filters.airlines.length > 0 ? { airlines: filters.airlines.join(',') } : {}),
    ...(filters.windows.length > 0 ? { departureWindows: filters.windows.join(',') } : {}),
    ...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {}),
    ...(filters.maxDuration !== undefined ? { maxDurationMinutes: filters.maxDuration } : {}),
    ...(filters.refundable ? { refundable: 'true' as const } : {}),
    ...(filters.checkedBag ? { checkedBag: 'true' as const } : {}),
  };
}

/**
 * Live flight results for the search in the URL: searches every supplier through the API, then
 * pages, sorts and filters on the API (filters and sort stay in the URL). Selecting a fare
 * re-prices it and opens checkout; a price change is shown first.
 */
export function FlightResults({
  request,
  currency,
}: {
  request: SearchRequest;
  currency: CurrencyCode;
}) {
  const { t } = useResultsT();
  const format = useFormatters();
  const router = useRouter();
  const [params, updateParams] = useUrlParams();
  const sortParam = params.get('sort');
  const sort: Sort = SORTS.includes(sortParam as Sort) ? (sortParam as Sort) : 'best';
  const filters = filtersFromParams(params);
  const filterKey = JSON.stringify([sort, filters]);

  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState<{ key: string; searchId: string | null } | null>(null);
  const [listed, setListed] = useState<{ key: string; phase: Phase } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    offerId: string;
    value: FlightOfferCardProps['notice'];
    quoteId?: string;
  } | null>(null);
  const [selectError, setSelectError] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const travellers =
    request.passengers.adults + request.passengers.children + request.passengers.infants;

  // Fetched state is keyed by its inputs, so a new search or filter shows its own loading state
  // without resetting state inside effects.
  const searchKey = JSON.stringify([request, currency, attempt]);
  const searchId = search?.key === searchKey ? search.searchId : undefined;
  const listKey = JSON.stringify([searchId, filterKey, currency]);

  // 1. Search (again when the request changes or the traveller retries).
  useEffect(() => {
    let cancelled = false;
    const [body, searchCurrency] = JSON.parse(searchKey) as [SearchRequest, CurrencyCode];
    browserApi()
      .POST('/v1/flights/searches', { params: { query: { currency: searchCurrency } }, body })
      .then(({ data }) => {
        if (!cancelled) setSearch({ key: searchKey, searchId: data?.searchId ?? null });
      })
      .catch(() => {
        if (!cancelled) setSearch({ key: searchKey, searchId: null });
      });
    return () => {
      cancelled = true;
    };
  }, [searchKey]);

  // 2. The first page for the current sort and filters.
  useEffect(() => {
    const [id, filtersKey, listCurrency] = JSON.parse(listKey) as [
      string | null | undefined,
      string,
      CurrencyCode,
    ];
    if (!id) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/flights/searches/{searchId}/offers', {
        params: { path: { searchId: id }, query: listQuery(filtersKey, listCurrency) },
      })
      .then(({ data, response }) => {
        if (cancelled) return;
        setListed({
          key: listKey,
          phase: data
            ? { kind: 'ready', result: data }
            : { kind: response.status === 410 ? 'expired' : 'error' },
        });
      })
      .catch(() => {
        if (!cancelled) setListed({ key: listKey, phase: { kind: 'error' } });
      });
    return () => {
      cancelled = true;
    };
  }, [listKey]);

  const phase: Phase =
    searchId === null
      ? { kind: 'error' }
      : searchId === undefined || listed?.key !== listKey
        ? { kind: 'searching' }
        : listed.phase;

  const loadMore = async (result: Result) => {
    if (!result.nextCursor || !searchId) return;
    setLoadingMore(true);
    const { data, response } = await browserApi().GET('/v1/flights/searches/{searchId}/offers', {
      params: {
        path: { searchId },
        query: { ...listQuery(filterKey, currency), cursor: result.nextCursor },
      },
    });
    setLoadingMore(false);
    if (data)
      setListed({
        key: listKey,
        phase: { kind: 'ready', result: { ...data, offers: [...result.offers, ...data.offers] } },
      });
    else if (response.status === 410) setListed({ key: listKey, phase: { kind: 'expired' } });
  };

  const select = async (offer: Schemas['FlightOffer']) => {
    setSelecting(offer.id);
    setSelectError(false);
    setNotice(null);
    try {
      const { data, response } = await browserApi().POST('/v1/flights/offers/{offerId}/quote', {
        params: { path: { offerId: offer.id }, query: { currency } },
      });
      if (data?.priceChange) {
        setNotice({
          offerId: offer.id,
          quoteId: data.quoteId,
          value: {
            kind: 'priceChanged',
            previous: format.money(data.priceChange.previous),
            current: format.money(data.priceChange.current),
          },
        });
      } else if (data) {
        router.push(`/checkout/${data.quoteId}`);
        return;
      } else if (response.status === 410) {
        setNotice({ offerId: offer.id, value: { kind: 'gone' } });
      } else {
        setSelectError(true);
      }
    } catch {
      setSelectError(true);
    }
    setSelecting(null);
  };

  const changeFilters = (next: FlightFilterState) => updateParams(filtersToParams(next));

  if (phase.kind === 'searching') return <ResultsLoading label={t('results.flights.searching')} />;
  if (phase.kind === 'error')
    return (
      <ResultsMessage
        tone="alert"
        action={t('results.retry')}
        onAction={() => setAttempt((n) => n + 1)}
      >
        {t('results.error')}
      </ResultsMessage>
    );
  if (phase.kind === 'expired')
    return (
      <ResultsMessage action={t('results.searchAgain')} onAction={() => setAttempt((n) => n + 1)}>
        {t('results.expired')}
      </ResultsMessage>
    );

  const { result } = phase;
  const unfiltered = JSON.stringify(filters) === JSON.stringify(EMPTY_FLIGHT_FILTERS);
  if (result.total === 0 && unfiltered)
    return <ResultsMessage>{t('results.flights.none')}</ResultsMessage>;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-4 lg:items-start lg:gap-6">
      <aside aria-label={t('results.filters.title')} className="flex flex-col gap-4 lg:col-span-1">
        <Button
          variant="ghost"
          className="lg:hidden"
          aria-expanded={showFilters}
          aria-controls="flight-filters"
          onClick={() => setShowFilters((value) => !value)}
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          {showFilters ? t('results.filters.hide') : t('results.filters.show')}
        </Button>
        <div id="flight-filters" className={showFilters ? 'block' : 'hidden lg:block'}>
          <FlightFilters
            facets={result.facets}
            currency={result.currency}
            value={filters}
            onChange={changeFilters}
          />
        </div>
      </aside>
      <section aria-labelledby="flight-results-count" className="flex flex-col gap-4 lg:col-span-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h2
            id="flight-results-count"
            aria-live="polite"
            className="font-heading text-h3 font-bold text-heading"
          >
            {t('results.flights.count', { count: result.total })}
          </h2>
          <NativeSelect
            id="flight-sort"
            label={t('results.sort.label')}
            value={sort}
            onChange={(event) =>
              updateParams({ sort: event.target.value === 'best' ? null : event.target.value })
            }
            options={SORTS.map((value) => ({ value, label: t(`results.sort.${value}`) }))}
          />
        </div>
        <WatchRoute request={request} currency={currency} />
        {result.offers.some((offer) => offer.supplier === 'mock') ? (
          <p className="font-body text-body-sm text-foreground">{t('results.demoSupplier')}</p>
        ) : null}
        {result.status === 'partial' ? (
          <p className="font-body text-body-sm text-foreground">{t('results.partial')}</p>
        ) : null}
        {selectError ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {t('results.error')}
          </p>
        ) : null}
        <ol className="flex flex-col gap-4">
          {result.offers.map((offer) => (
            <li key={offer.id}>
              <FlightOfferCard
                offer={offer}
                travellers={travellers}
                selecting={selecting === offer.id}
                disabled={selecting !== null && selecting !== offer.id}
                notice={notice?.offerId === offer.id ? notice.value : null}
                onSelect={() => void select(offer)}
                onContinue={() => {
                  if (notice?.quoteId) router.push(`/checkout/${notice.quoteId}`);
                }}
              />
            </li>
          ))}
        </ol>
        {result.nextCursor ? (
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore(result)}>
            {t('results.flights.loadMore')}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
