'use client';

import type { paths } from '@suskii/api-client/schema';
import type { CurrencyCode } from '@suskii/shared/lite';
import { Button } from '@suskii/ui-web';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { NativeSelect } from '../search/native-select';

import { HotelCard } from './hotel-card';
import {
  BOARDS,
  EMPTY_HOTEL_FILTERS,
  HotelFilters,
  type Board,
  type HotelFilterState,
} from './hotel-filters';
import { ResultsLoading, ResultsMessage } from './result-states';
import { useResultsT } from './results-messages';
import { listParam, numberParam, useUrlParams } from './use-url-params';

const SORTS = ['recommended', 'price', 'rating', 'stars'] as const;
type Sort = (typeof SORTS)[number];
type Result = Schemas['HotelSearchResult'];
type SearchRequest = Schemas['HotelSearchRequestInput'];
type ListQuery = NonNullable<
  paths['/v1/hotels/searches/{searchId}/hotels']['get']['parameters']['query']
>;

type Phase =
  | { kind: 'searching' }
  | { kind: 'ready'; result: Result }
  | { kind: 'error' }
  | { kind: 'expired' };

function filtersFromParams(params: URLSearchParams): HotelFilterState {
  const board = params.get('board');
  const rating = numberParam(params, 'rating');
  return {
    stars: listParam(params, 'stars', ['1', '2', '3', '4', '5']),
    minRating: rating !== undefined && rating <= 10 ? rating : undefined,
    freeCancellation: params.get('freeCancel') === '1',
    amenities: listParam(params, 'amenities').filter((code) => /^[a-z0-9_]+$/.test(code)),
    areas: listParam(params, 'areas').slice(0, 10),
    board: BOARDS.includes(board as Board) ? (board as Board) : undefined,
    maxPrice: numberParam(params, 'maxPrice'),
  };
}

function filtersToParams(filters: HotelFilterState): Record<string, string | null> {
  return {
    stars: filters.stars.join(',') || null,
    rating: filters.minRating === undefined ? null : String(filters.minRating),
    freeCancel: filters.freeCancellation ? '1' : null,
    amenities: filters.amenities.join(',') || null,
    areas: filters.areas.join(',') || null,
    board: filters.board ?? null,
    maxPrice: filters.maxPrice === undefined ? null : String(filters.maxPrice),
  };
}

/** API query for a sort-and-filter key (see `filterKey`). */
function listQuery(filterKey: string, currency: CurrencyCode): ListQuery {
  const [sort, filters] = JSON.parse(filterKey) as [Sort, HotelFilterState];
  return {
    currency,
    sort,
    limit: 20,
    ...(filters.stars.length > 0 ? { stars: filters.stars.join(',') } : {}),
    ...(filters.minRating !== undefined ? { minRating: filters.minRating } : {}),
    ...(filters.freeCancellation ? { freeCancellation: 'true' as const } : {}),
    ...(filters.amenities.length > 0 ? { amenities: filters.amenities.join(',') } : {}),
    ...(filters.areas.length > 0 ? { areas: filters.areas.join(',') } : {}),
    ...(filters.board ? { board: filters.board } : {}),
    ...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {}),
  };
}

/** Live hotel results for the search in the URL, mirroring flights (filters and sort in the URL). */
export function HotelResults({
  request,
  currency,
}: {
  request: SearchRequest;
  currency: CurrencyCode;
}) {
  const { t } = useResultsT();
  const [params, updateParams] = useUrlParams();
  const sortParam = params.get('sort');
  const sort: Sort = SORTS.includes(sortParam as Sort) ? (sortParam as Sort) : 'recommended';
  const filters = filtersFromParams(params);
  const filterKey = JSON.stringify([sort, filters]);

  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState<{ key: string; searchId: string | null } | null>(null);
  const [listed, setListed] = useState<{ key: string; phase: Phase } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Fetched state is keyed by its inputs (see FlightResults).
  const searchKey = JSON.stringify([request, currency, attempt]);
  const searchId = search?.key === searchKey ? search.searchId : undefined;
  const listKey = JSON.stringify([searchId, filterKey, currency]);

  useEffect(() => {
    let cancelled = false;
    const [body, searchCurrency] = JSON.parse(searchKey) as [SearchRequest, CurrencyCode];
    browserApi()
      .POST('/v1/hotels/searches', { params: { query: { currency: searchCurrency } }, body })
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

  useEffect(() => {
    const [id, filtersKey, listCurrency] = JSON.parse(listKey) as [
      string | null | undefined,
      string,
      CurrencyCode,
    ];
    if (!id) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/hotels/searches/{searchId}/hotels', {
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
    const { data, response } = await browserApi().GET('/v1/hotels/searches/{searchId}/hotels', {
      params: {
        path: { searchId },
        query: { ...listQuery(filterKey, currency), cursor: result.nextCursor },
      },
    });
    setLoadingMore(false);
    if (data)
      setListed({
        key: listKey,
        phase: { kind: 'ready', result: { ...data, hotels: [...result.hotels, ...data.hotels] } },
      });
    else if (response.status === 410) setListed({ key: listKey, phase: { kind: 'expired' } });
  };

  if (phase.kind === 'searching') return <ResultsLoading label={t('results.hotels.searching')} />;
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
  const unfiltered = JSON.stringify(filters) === JSON.stringify(EMPTY_HOTEL_FILTERS);
  if (result.total === 0 && unfiltered)
    return <ResultsMessage>{t('results.hotels.none')}</ResultsMessage>;
  // The hotel page keeps the search (and filters) so "back" and "search again" lose nothing.
  const query = params.toString();

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-4 lg:items-start lg:gap-6">
      <aside aria-label={t('results.filters.title')} className="flex flex-col gap-4 lg:col-span-1">
        <Button
          variant="ghost"
          className="lg:hidden"
          aria-expanded={showFilters}
          aria-controls="hotel-filters"
          onClick={() => setShowFilters((value) => !value)}
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          {showFilters ? t('results.filters.hide') : t('results.filters.show')}
        </Button>
        <div id="hotel-filters" className={showFilters ? 'block' : 'hidden lg:block'}>
          <HotelFilters
            facets={result.facets}
            currency={result.currency}
            value={filters}
            onChange={(next) => updateParams(filtersToParams(next))}
          />
        </div>
      </aside>
      <section aria-labelledby="hotel-results-count" className="flex flex-col gap-4 lg:col-span-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h2
            id="hotel-results-count"
            aria-live="polite"
            className="font-heading text-h3 font-bold text-heading"
          >
            {t('results.hotels.count', { count: result.total })}
          </h2>
          <NativeSelect
            id="hotel-sort"
            label={t('results.sort.label')}
            value={sort}
            onChange={(event) =>
              updateParams({
                sort: event.target.value === 'recommended' ? null : event.target.value,
              })
            }
            options={SORTS.map((value) => ({ value, label: t(`results.sort.${value}`) }))}
          />
        </div>
        {result.hotels.some((hotel) => hotel.supplier === 'mock') ? (
          <p className="font-body text-body-sm text-foreground">{t('results.demoSupplier')}</p>
        ) : null}
        {result.status === 'partial' ? (
          <p className="font-body text-body-sm text-foreground">{t('results.partial')}</p>
        ) : null}
        <ol className="flex flex-col gap-4">
          {result.hotels.map((hotel) => (
            <li key={hotel.id}>
              <HotelCard
                hotel={hotel}
                nights={result.nights}
                href={`/hotels/stay/${encodeURIComponent(hotel.id)}?${query}`}
              />
            </li>
          ))}
        </ol>
        {result.nextCursor ? (
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore(result)}>
            {t('results.hotels.loadMore')}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
