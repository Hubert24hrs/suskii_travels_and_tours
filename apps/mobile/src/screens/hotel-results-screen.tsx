import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { parseHotelSearchParams } from '@suskii/shared';
import { Badge, Button, Card, SegmentedControl, Sheet } from '@suskii/ui-native';
import { FlashList } from '@shopify/flash-list';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { FilterChip } from '../components/results/filter-chip';
import { HotelPhoto } from '../components/results/hotel-photo';
import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

type Hotel = Schemas['HotelSummary'];
type Facets = Schemas['HotelFacets'];
type Board = Facets['boards'][number]['board'];
type Sort = 'recommended' | 'price' | 'rating' | 'stars';

/** What the filter sheet narrows the list by; the API applies all of it (ADR-096). */
interface Filters {
  stars: number[];
  types: string[];
  amenities: string[];
  areas: string[];
  board: Board | null;
  /** Whole stay, minor units of the display currency. */
  maxPrice: number | null;
}
const NO_FILTERS: Filters = {
  stars: [],
  types: [],
  amenities: [],
  areas: [],
  board: null,
  maxPrice: null,
};

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

/** Four price ceilings between the cheapest and the dearest hotel of the search. */
function priceSteps(range: Facets['price']): number[] {
  if (!range || range.max.amountMinor <= range.min.amountMinor) return [];
  const size = (range.max.amountMinor - range.min.amountMinor) / 4;
  return [1, 2, 3, 4].map((step) => Math.ceil(range.min.amountMinor + size * step));
}

class ExpiredError extends Error {}

function HotelCard({
  hotel,
  nights,
  photos,
  onPress,
}: {
  hotel: Hotel;
  nights: number;
  /** False under the data saver (ADR-075): cards stay text. */
  photos: boolean;
  onPress: () => void;
}) {
  const { t } = useT();
  const format = useFormatters();
  const rate = hotel.cheapestRate;
  return (
    <View testID="hotel-result" className="px-4 py-2">
      <Card
        onPress={onPress}
        accessibilityLabel={t('results.hotels.seeRoomsLabel', { hotel: hotel.name })}
        className="gap-2 p-4"
      >
        {photos && hotel.photo ? (
          <HotelPhoto photo={hotel.photo} label="" testID="hotel-photo" />
        ) : null}
        <Text className="font-heading text-h4 text-heading">{hotel.name}</Text>
        <Text className="font-body text-body-sm text-foreground">
          {[
            hotel.propertyType
              ? t('results.stayContent.stars', { count: hotel.stars })
              : t('results.hotels.stars', { count: hotel.stars }),
            hotel.propertyType ? t(`results.propertyTypes.${hotel.propertyType}`) : null,
            hotel.area,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text className="font-body text-body-sm text-muted">
          {hotel.reviewScore !== null
            ? t('results.hotels.review', { score: hotel.reviewScore, count: hotel.reviewCount })
            : t('results.hotels.noReviews')}
        </Text>
        {hotel.freeCancellationAvailable ? (
          <Badge variant="success">{t('results.hotels.freeCancellation')}</Badge>
        ) : null}
        <View className="flex-row items-end justify-between">
          <View>
            <Text className="font-heading text-h3 text-heading">
              {format.money(rate.price.total)}
            </Text>
            <Text className="font-body text-caption text-muted">
              {t('results.hotels.total', { count: nights })}
            </Text>
            {rate.payAtProperty ? (
              <Text testID="hotel-pay-at-property" className="font-body text-caption text-muted">
                {t('results.hotels.payAtProperty', { amount: format.money(rate.payAtProperty) })}
              </Text>
            ) : null}
          </View>
          <Text className="font-body-bold text-body-sm text-primary">
            {t('results.hotels.seeRooms')}
          </Text>
        </View>
      </Card>
    </View>
  );
}

export function HotelResultsScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const { api, currency, dataSaver } = useApp();
  // Data saver (ADR-075): half the results per page.
  const pageSize = dataSaver ? 10 : 20;
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('recommended');
  const [freeCancellation, setFreeCancellation] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sheet, setSheet] = useState(false);
  const plain = JSON.stringify(filters) === JSON.stringify(NO_FILTERS);

  const request = useMemo(() => parseHotelSearchParams(params).form, [params]);

  const search = useQuery({
    queryKey: ['hotel-search', request, currency, pageSize],
    enabled: request !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.POST('/v1/hotels/searches', {
        params: { query: { currency, limit: pageSize } },
        body: request ?? ({} as never),
      });
      if (!data) throw new Error('hotel search');
      return data;
    },
  });
  const searchId = search.data?.searchId;

  const hotels = useInfiniteQuery({
    queryKey: ['hotels', searchId, sort, freeCancellation, filters, currency, pageSize],
    enabled: Boolean(searchId),
    // A plain search already answered with its first page (ADR-075): show it instead of asking again.
    initialData: () =>
      sort === 'recommended' && !freeCancellation && plain && search.data
        ? { pages: [search.data], pageParams: [undefined] }
        : undefined,
    // The list (and the open filter sheet) stays while another filter loads.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: Schemas['HotelSearchResult']) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const { data, response } = await api.GET('/v1/hotels/searches/{searchId}/hotels', {
        params: {
          path: { searchId: searchId ?? '' },
          query: {
            currency,
            limit: pageSize,
            sort,
            ...(freeCancellation ? { freeCancellation: 'true' as const } : {}),
            ...(filters.stars.length ? { stars: filters.stars.join(',') } : {}),
            ...(filters.types.length ? { types: filters.types.join(',') } : {}),
            ...(filters.amenities.length ? { amenities: filters.amenities.join(',') } : {}),
            ...(filters.areas.length ? { areas: filters.areas.join(',') } : {}),
            ...(filters.board ? { board: filters.board } : {}),
            ...(filters.maxPrice !== null ? { maxPrice: filters.maxPrice } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      });
      if (response.status === 410) throw new ExpiredError();
      if (!data) throw new Error('hotels');
      return data;
    },
  });

  if (!request) {
    return (
      <Notice
        body={t('results.error')}
        action={t('results.searchAgain')}
        onAction={() => router.back()}
      />
    );
  }
  if (search.isPending || (searchId && hotels.isPending)) {
    return <Loading label={t('results.hotels.searching')} />;
  }
  if (hotels.error instanceof ExpiredError) {
    return (
      <Notice
        body={t('results.expired')}
        action={t('results.searchAgain')}
        onAction={() => void search.refetch()}
      />
    );
  }
  if (search.isError || hotels.isError || !hotels.data) {
    return (
      <Notice
        body={t('results.error')}
        action={t('results.retry')}
        onAction={() => void (search.isError ? search.refetch() : hotels.refetch())}
      />
    );
  }

  const first = hotels.data.pages[0];
  const list = hotels.data.pages.flatMap((page) => page.hotels);
  // Facets describe the whole search, so the sheet's choices do not shrink as filters are set.
  const facets = first?.facets;
  const prices = priceSteps(facets?.price ?? null);
  const amenityLabel = (code: string): string => {
    const key = `results.amenities.${code}`;
    const label = t(key as Parameters<typeof t>[0]);
    return label === key ? code.replaceAll('_', ' ') : label;
  };
  return (
    <View className="flex-1 bg-background">
      <FlashList
        data={list}
        keyExtractor={(hotel) => hotel.id}
        ListHeaderComponent={
          <View className="gap-3 px-4 pt-4 pb-2">
            <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
              {t('results.hotels.count', { count: first?.total ?? 0 })}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <SegmentedControl
                label={t('results.sort.label')}
                options={(['recommended', 'price', 'rating', 'stars'] as const).map((value) => ({
                  value,
                  label: t(`results.sort.${value}`),
                }))}
                value={sort}
                onValueChange={setSort}
              />
            </ScrollView>
            <View className="flex-row flex-wrap gap-2">
              <Button variant="ghost" onPress={() => setFreeCancellation((value) => !value)}>
                {freeCancellation
                  ? `${t('results.filters.freeCancellation')} ✓`
                  : t('results.filters.freeCancellation')}
              </Button>
              <Button testID="hotel-filters" variant="ghost" onPress={() => setSheet(true)}>
                {plain ? t('mobile.search.filters') : `${t('mobile.search.filters')} •`}
              </Button>
            </View>
          </View>
        }
        ListEmptyComponent={<Notice body={t('results.hotels.none')} />}
        ListFooterComponent={
          hotels.hasNextPage ? (
            <View className="p-4">
              <Button
                variant="ghost"
                loading={hotels.isFetchingNextPage}
                onPress={() => void hotels.fetchNextPage()}
              >
                {t('results.hotels.loadMore')}
              </Button>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <HotelCard
            hotel={item}
            nights={first?.nights ?? 1}
            photos={!dataSaver}
            onPress={() => router.push(`/hotels/${encodeURIComponent(item.id)}` as Href)}
          />
        )}
      />
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title={t('mobile.search.filters')}
        closeLabel={t('common.close')}
        snapPoints={['85%']}
        testID="hotel-filters-sheet"
        footer={
          <View className="gap-2">
            <Button testID="hotel-filters-apply" fullWidth onPress={() => setSheet(false)}>
              {t('mobile.search.showResults')}
            </Button>
            <Button
              testID="hotel-filters-clear"
              variant="ghost"
              onPress={() => setFilters(NO_FILTERS)}
            >
              {t('mobile.search.clearFilters')}
            </Button>
          </View>
        }
      >
        <View className="gap-4 pb-4">
          {prices.length > 0 ? (
            <View className="gap-2">
              <Text className="font-body-bold text-body text-heading">
                {t('results.filters.maxPrice')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {prices.map((minor, index) => (
                  <FilterChip
                    key={minor}
                    testID={`hotel-filter-price-${index}`}
                    label={t('results.filters.upToPrice', {
                      price: format.money({
                        amountMinor: minor,
                        currency: first?.currency ?? currency,
                      }),
                    })}
                    selected={filters.maxPrice === minor}
                    onPress={() =>
                      setFilters((current) => ({
                        ...current,
                        maxPrice: current.maxPrice === minor ? null : minor,
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
          {facets && facets.stars.length > 0 ? (
            <View className="gap-2">
              <Text className="font-body-bold text-body text-heading">
                {t('results.filters.stars')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {facets.stars.map((entry) => (
                  <FilterChip
                    key={entry.stars}
                    testID={`hotel-filter-stars-${entry.stars}`}
                    label={t('results.filters.starOption', { count: entry.stars })}
                    selected={filters.stars.includes(entry.stars)}
                    onPress={() =>
                      setFilters((current) => ({
                        ...current,
                        stars: toggle(current.stars, entry.stars),
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
          {facets && facets.propertyTypes.length > 1 ? (
            <View className="gap-2">
              <Text className="font-body-bold text-body text-heading">
                {t('results.filters.propertyType')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {facets.propertyTypes.map((entry) => (
                  <FilterChip
                    key={entry.type}
                    testID={`hotel-filter-type-${entry.type}`}
                    label={`${t(`results.propertyTypes.${entry.type}`)} (${entry.count})`}
                    selected={filters.types.includes(entry.type)}
                    onPress={() =>
                      setFilters((current) => ({
                        ...current,
                        types: toggle(current.types, entry.type),
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
          {facets && facets.boards.length > 1 ? (
            <View className="gap-2">
              <Text className="font-body-bold text-body text-heading">
                {t('results.filters.board')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {facets.boards.map((entry) => (
                  <FilterChip
                    key={entry.board}
                    testID={`hotel-filter-board-${entry.board}`}
                    label={t(`results.boards.${entry.board}`)}
                    selected={filters.board === entry.board}
                    onPress={() =>
                      setFilters((current) => ({
                        ...current,
                        board: current.board === entry.board ? null : entry.board,
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
          {facets && facets.amenities.length > 0 ? (
            <View className="gap-2">
              <Text className="font-body-bold text-body text-heading">
                {t('results.filters.amenities')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {facets.amenities.slice(0, 10).map((entry) => (
                  <FilterChip
                    key={entry.amenity}
                    testID={`hotel-filter-amenity-${entry.amenity}`}
                    label={amenityLabel(entry.amenity)}
                    selected={filters.amenities.includes(entry.amenity)}
                    onPress={() =>
                      setFilters((current) => ({
                        ...current,
                        amenities: toggle(current.amenities, entry.amenity),
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
          {facets && facets.areas.length > 1 ? (
            <View className="gap-2">
              <Text className="font-body-bold text-body text-heading">
                {t('results.filters.areas')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {facets.areas.map((entry) => (
                  <FilterChip
                    key={entry.area}
                    testID={`hotel-filter-area-${entry.area}`}
                    label={`${entry.area} (${entry.count})`}
                    selected={filters.areas.includes(entry.area)}
                    onPress={() =>
                      setFilters((current) => ({
                        ...current,
                        areas: toggle(current.areas, entry.area),
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}
