import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { parseHotelSearchParams } from '@suskii/shared';
import { Badge, Button, Card, SegmentedControl } from '@suskii/ui-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

type Hotel = Schemas['HotelSummary'];
type Sort = 'recommended' | 'price' | 'rating' | 'stars';

class ExpiredError extends Error {}

function HotelCard({
  hotel,
  nights,
  onPress,
}: {
  hotel: Hotel;
  nights: number;
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
        <Text className="font-heading text-h4 text-heading">{hotel.name}</Text>
        <Text className="font-body text-body-sm text-foreground">
          {t('results.hotels.stars', { count: hotel.stars })}
          {hotel.area ? ` · ${hotel.area}` : ''}
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
  const { api, currency } = useApp();
  const { t } = useT();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('recommended');
  const [freeCancellation, setFreeCancellation] = useState(false);

  const request = useMemo(() => parseHotelSearchParams(params).form, [params]);

  const search = useQuery({
    queryKey: ['hotel-search', request, currency],
    enabled: request !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.POST('/v1/hotels/searches', {
        params: { query: { currency } },
        body: request ?? ({} as never),
      });
      if (!data) throw new Error('hotel search');
      return data;
    },
  });
  const searchId = search.data?.searchId;

  const hotels = useInfiniteQuery({
    queryKey: ['hotels', searchId, sort, freeCancellation, currency],
    enabled: Boolean(searchId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: Schemas['HotelSearchResult']) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const { data, response } = await api.GET('/v1/hotels/searches/{searchId}/hotels', {
        params: {
          path: { searchId: searchId ?? '' },
          query: {
            currency,
            sort,
            ...(freeCancellation ? { freeCancellation: 'true' as const } : {}),
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
            <Button variant="ghost" onPress={() => setFreeCancellation((value) => !value)}>
              {freeCancellation
                ? `${t('results.filters.freeCancellation')} ✓`
                : t('results.filters.freeCancellation')}
            </Button>
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
            onPress={() => router.push(`/hotels/${encodeURIComponent(item.id)}` as Href)}
          />
        )}
      />
    </View>
  );
}
