'use client';

import type { paths } from '@suskii/api-client/schema';
import {
  HOTEL_COLLECTIONS,
  PROPERTY_TYPES,
  type CurrencyCode,
  type HotelCollection,
} from '@suskii/shared/lite';
import { Button } from '@suskii/ui-web';
import { SlidersHorizontal } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';

import { trackAd } from '../../lib/ad-events';
import { browserApi, type Schemas } from '../../lib/browser-api';
import { localToday, rememberHotelSearch } from '../../lib/recent-hotel-searches';
import { handedHotelSearch, searchKey as handoffKey } from '../../lib/search-handoff';
import { NativeSelect } from '../search/native-select';

import { HotelCard } from './hotel-card';
import {
  BOARDS,
  EMPTY_HOTEL_FILTERS,
  HotelFilters,
  type Board,
  type HotelFilterState,
} from './hotel-filters';
import { AfterPaint } from './after-paint';
import { ResultsLoading, ResultsMessage } from './result-states';
import { useResultsT } from './results-messages';
import { listParam, numberParam, useUrlParams } from './use-url-params';

// The pin map loads when the traveller asks for the map view (ADR-097).
const HotelMap = lazy(() => import('./hotel-map'));
/** OpenStreetMap's page for a place: kept here so the map's code stays in its lazy chunk. */
const mapsUrl = (latitude: number, longitude: number): string =>
  `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;

const COLLECTION_CHIP =
  'flex min-h-12 cursor-pointer items-center gap-2 rounded-pill border border-border-strong px-4 font-body text-body-sm text-foreground has-checked:border-primary has-checked:bg-primary-subtle has-focus-visible:focus-ring';

const SORTS = ['recommended', 'price', 'rating', 'stars'] as const;
/** Cards in the first paint; the rest follow right after it (ADR-075). */
const FIRST_CARDS = 4;
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
    types: listParam(params, 'types', PROPERTY_TYPES),
    collection: HOTEL_COLLECTIONS.find((collection) => collection === params.get('collection')),
  };
}

/** Sort and filters of a plain search: the search itself answers with this first page. */
const DEFAULT_FILTER_KEY = JSON.stringify([
  'recommended',
  filtersFromParams(new URLSearchParams()),
]);

function filtersToParams(filters: HotelFilterState): Record<string, string | null> {
  return {
    stars: filters.stars.join(',') || null,
    rating: filters.minRating === undefined ? null : String(filters.minRating),
    freeCancel: filters.freeCancellation ? '1' : null,
    amenities: filters.amenities.join(',') || null,
    areas: filters.areas.join(',') || null,
    board: filters.board ?? null,
    maxPrice: filters.maxPrice === undefined ? null : String(filters.maxPrice),
    types: filters.types.join(',') || null,
    collection: filters.collection ?? null,
  };
}

/** API query for a sort-and-filter key (see `filterKey`). */
function listQuery(filterKey: string, currency: CurrencyCode, pageSize: number): ListQuery {
  const [sort, filters] = JSON.parse(filterKey) as [Sort, HotelFilterState];
  return {
    currency,
    sort,
    limit: pageSize,
    ...(filters.stars.length > 0 ? { stars: filters.stars.join(',') } : {}),
    ...(filters.minRating !== undefined ? { minRating: filters.minRating } : {}),
    ...(filters.freeCancellation ? { freeCancellation: 'true' as const } : {}),
    ...(filters.amenities.length > 0 ? { amenities: filters.amenities.join(',') } : {}),
    ...(filters.areas.length > 0 ? { areas: filters.areas.join(',') } : {}),
    ...(filters.board ? { board: filters.board } : {}),
    ...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {}),
    ...(filters.types.length > 0 ? { types: filters.types.join(',') } : {}),
    ...(filters.collection ? { collection: filters.collection } : {}),
  };
}

/**
 * Live hotel results for the search in the URL, mirroring flights (filters and sort in the URL,
 * and the search's own first page for a plain search, ADR-075).
 */
export function HotelResults({
  request,
  currency,
  pageSize = 20,
  photoHosts = [],
  photos = true,
}: {
  request: SearchRequest;
  currency: CurrencyCode;
  /** Hotels per page: fewer in data-saver mode (ADR-075). */
  pageSize?: number;
  /** Hosts a supplier's photographs may come from (`IMAGE_REMOTE_HOSTS`). */
  photoHosts?: readonly string[];
  /** False under the data saver: cards stay text. */
  photos?: boolean;
}) {
  const { t } = useResultsT();
  const [params, updateParams] = useUrlParams();
  const sortParam = params.get('sort');
  const sort: Sort = SORTS.includes(sortParam as Sort) ? (sortParam as Sort) : 'recommended';
  const filters = filtersFromParams(params);
  const filterKey = JSON.stringify([sort, filters]);
  const searched = JSON.stringify(request);
  const mapView = params.get('view') === 'map';
  const [onMap, setOnMap] = useState<string | null>(null);

  // The vertical only: a city id or dates say nothing a network needs (ADR-079).
  useEffect(() => {
    trackAd('Search', { contentIds: ['hotels'] });
  }, [searched]);

  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState<{
    key: string;
    searchId: string | null;
    first: Result | null;
  } | null>(null);
  const [listed, setListed] = useState<{ key: string; phase: Phase } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Fetched state is keyed by its inputs (see FlightResults).
  const searchKey = JSON.stringify([request, currency, pageSize, attempt]);
  const searchId = search?.key === searchKey ? search.searchId : undefined;
  const firstPage =
    search?.key === searchKey && filterKey === DEFAULT_FILTER_KEY ? search.first : null;
  const listKey = JSON.stringify([searchId, filterKey, currency, pageSize, firstPage !== null]);

  useEffect(() => {
    let cancelled = false;
    const [body, searchCurrency, limit, tries] = JSON.parse(searchKey) as [
      SearchRequest,
      CurrencyCode,
      number,
      number,
    ];
    // The form may already have started this search while the page loaded (ADR-075).
    const handed = tries === 0 ? handedHotelSearch(handoffKey(body, searchCurrency, limit)) : null;
    (
      handed ??
      browserApi()
        .POST('/v1/hotels/searches', {
          params: { query: { currency: searchCurrency, limit } },
          body,
        })
        .then(({ data }) => data ?? null)
    )
      .then((data) => {
        if (cancelled) return;
        setSearch({ key: searchKey, searchId: data?.searchId ?? null, first: data ?? null });
        // Offered again on the hotels page, from this browser only (ADR-097).
        const city = data?.hotels[0]?.cityName;
        if (city && body.destination.type === 'city') {
          rememberHotelSearch(
            {
              cityId: body.destination.cityId,
              cityName: city,
              checkIn: body.checkIn,
              checkOut: body.checkOut,
              rooms: body.rooms.map((room) => ({
                adults: room.adults,
                childAges: [...(room.childAges ?? [])],
              })),
            },
            localToday(),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setSearch({ key: searchKey, searchId: null, first: null });
      });
    return () => {
      cancelled = true;
    };
  }, [searchKey]);

  useEffect(() => {
    const [id, filtersKey, listCurrency, limit, answered] = JSON.parse(listKey) as [
      string | null | undefined,
      string,
      CurrencyCode,
      number,
      boolean,
    ];
    if (!id || answered) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/hotels/searches/{searchId}/hotels', {
        params: { path: { searchId: id }, query: listQuery(filtersKey, listCurrency, limit) },
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
      : searchId === undefined
        ? { kind: 'searching' }
        : listed?.key === listKey
          ? listed.phase
          : firstPage
            ? { kind: 'ready', result: firstPage }
            : { kind: 'searching' };

  const loadMore = async (result: Result) => {
    if (!result.nextCursor || !searchId) return;
    setLoadingMore(true);
    const { data, response } = await browserApi().GET('/v1/hotels/searches/{searchId}/hotels', {
      params: {
        path: { searchId },
        query: { ...listQuery(filterKey, currency, pageSize), cursor: result.nextCursor },
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
  const chosen = result.hotels.find((hotel) => hotel.id === onMap) ?? null;
  const setCollection = (collection: HotelCollection | undefined): void =>
    updateParams(filtersToParams({ ...filters, collection }));
  // A link can arrive with a collection this search has no hotel for ("Deals tonight"): it
  // stays listed, so the visitor sees what is chosen and can leave it.
  const found = result.facets.collections.map((entry) => entry.collection);
  const collections =
    filters.collection && !found.includes(filters.collection)
      ? [...found, filters.collection]
      : found;
  if (result.total === 0 && unfiltered)
    return <ResultsMessage>{t('results.hotels.none')}</ResultsMessage>;
  // The hotel page keeps the search (and filters) so "back" and "search again" lose nothing.
  const query = params.toString();
  const renderCard = (hotel: Result['hotels'][number]) => (
    <HotelCard
      hotel={hotel}
      nights={result.nights}
      href={`/hotels/stay/${encodeURIComponent(hotel.id)}?${query}`}
      photoHosts={photoHosts}
      photos={photos}
    />
  );
  const renderHotel = (hotel: Result['hotels'][number]) => (
    <li key={hotel.id}>{renderCard(hotel)}</li>
  );

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
          <AfterPaint>
            <HotelFilters
              facets={result.facets}
              currency={result.currency}
              value={filters}
              onChange={(next) => updateParams(filtersToParams(next))}
            />
          </AfterPaint>
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
        {collections.length > 0 ? (
          <fieldset className="flex flex-col gap-2" data-testid="hotel-collections">
            <legend className="sr-only">{t('results.collections.label')}</legend>
            <div className="flex flex-wrap gap-2">
              {[undefined, ...collections].map((collection) => (
                <label key={collection ?? 'all'} className={COLLECTION_CHIP}>
                  <input
                    type="radio"
                    name="hotel-collection"
                    checked={filters.collection === collection}
                    onChange={() => setCollection(collection)}
                    data-testid={`hotel-collection-${collection ?? 'all'}`}
                  />
                  {collection
                    ? t(`results.collections.${collection}`)
                    : t('results.collections.all')}
                </label>
              ))}
            </div>
            {filters.collection ? (
              <p className="font-body text-body-sm text-foreground" data-testid="collection-help">
                {t(`results.collections.help.${filters.collection}`)}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <div
          role="group"
          aria-label={t('results.map.view')}
          className="flex gap-2"
          data-testid="hotel-view"
        >
          {(['list', 'map'] as const).map((view) => (
            <Button
              key={view}
              variant={(view === 'map') === mapView ? 'primary' : 'secondary'}
              aria-pressed={(view === 'map') === mapView}
              onClick={() => updateParams({ view: view === 'map' ? 'map' : null })}
              data-testid={`hotel-view-${view}`}
            >
              {view === 'map' ? t('results.map.show') : t('results.map.list')}
            </Button>
          ))}
        </div>
        {mapView ? (
          <div className="flex flex-col gap-4">
            <Suspense fallback={<ResultsLoading label={t('results.map.heading')} />}>
              <HotelMap hotels={result.hotels} selected={chosen?.id ?? null} onSelect={setOnMap} />
            </Suspense>
            {chosen ? (
              <div className="flex flex-col gap-2" aria-live="polite" data-testid="map-selection">
                {renderCard(chosen)}
                <a
                  href={mapsUrl(chosen.latitude, chosen.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('results.map.openLabel', { hotel: chosen.name })}
                  className="inline-flex min-h-12 items-center self-start font-body text-body font-bold text-primary underline focus-visible:focus-ring"
                >
                  {t('results.map.open')}
                </a>
              </div>
            ) : (
              <p className="font-body text-body-sm text-foreground" aria-live="polite">
                {t('results.map.choose')}
              </p>
            )}
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {result.hotels.slice(0, FIRST_CARDS).map(renderHotel)}
            <AfterPaint>{result.hotels.slice(FIRST_CARDS).map(renderHotel)}</AfterPaint>
          </ol>
        )}
        {result.nextCursor ? (
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore(result)}>
            {t('results.hotels.loadMore')}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
