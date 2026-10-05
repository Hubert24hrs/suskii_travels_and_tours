import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { parseFlightSearchParams, toFlightSearchRequest } from '@suskii/shared';
import { Badge, Button, SegmentedControl, Sheet } from '@suskii/ui-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { FlightOfferCard } from '../components/results/flight-offer-card';
import { WatchRoute } from '../components/results/watch-route';
import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

type Offer = Schemas['FlightOffer'];
type Sort = 'best' | 'cheapest' | 'fastest' | 'earliest';

interface Filters {
  sort: Sort;
  stops: number[];
  airlines: string[];
  refundable: boolean;
  checkedBag: boolean;
}

const NO_FILTERS: Filters = {
  sort: 'best',
  stops: [],
  airlines: [],
  refundable: false,
  checkedBag: false,
};

class ExpiredError extends Error {}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      className={
        selected
          ? 'min-h-12 justify-center rounded-pill bg-primary px-4'
          : 'min-h-12 justify-center rounded-pill border border-border-strong px-4'
      }
    >
      <Text
        className={
          selected
            ? 'font-body-bold text-body-sm text-on-primary'
            : 'font-body text-body-sm text-foreground'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

/**
 * Flight results (ADR-020): the search runs on the API, then pages of offers load with the
 * chosen sort and filters. Selecting a fare re-prices it (quote) before checkout.
 */
export function FlightResultsScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const { api, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sheet, setSheet] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ offerId: string; text: string; quoteId?: string } | null>(
    null,
  );

  const request = useMemo(() => {
    const { form } = parseFlightSearchParams(params);
    return form ? toFlightSearchRequest(form) : null;
  }, [params]);
  const travellers = request
    ? request.passengers.adults + request.passengers.children + request.passengers.infants
    : 1;

  const search = useQuery({
    queryKey: ['flight-search', request, currency],
    enabled: request !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await api.POST('/v1/flights/searches', {
        params: { query: { currency } },
        body: request ?? ({} as never),
      });
      if (!data) throw new Error(JSON.stringify(error));
      return data;
    },
  });
  const searchId = search.data?.searchId;

  const offers = useInfiniteQuery({
    queryKey: ['flight-offers', searchId, filters, currency],
    enabled: Boolean(searchId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: Schemas['FlightSearchResult']) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const { data, response } = await api.GET('/v1/flights/searches/{searchId}/offers', {
        params: {
          path: { searchId: searchId ?? '' },
          query: {
            currency,
            sort: filters.sort,
            ...(filters.stops.length ? { stops: filters.stops.join(',') } : {}),
            ...(filters.airlines.length ? { airlines: filters.airlines.join(',') } : {}),
            ...(filters.refundable ? { refundable: 'true' as const } : {}),
            ...(filters.checkedBag ? { checkedBag: 'true' as const } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      });
      if (response.status === 410) throw new ExpiredError();
      if (!data) throw new Error('offers');
      return data;
    },
  });

  const select = async (offer: Offer, confirmedQuote?: string) => {
    if (confirmedQuote) {
      router.push(`/checkout/${confirmedQuote}` as Href);
      return;
    }
    setSelecting(offer.id);
    setNotice(null);
    try {
      const { data, response } = await api.POST('/v1/flights/offers/{offerId}/quote', {
        params: { path: { offerId: offer.id }, query: { currency } },
      });
      if (data?.priceChange) {
        setNotice({
          offerId: offer.id,
          quoteId: data.quoteId,
          text: t('results.priceChanged', {
            previous: format.money(data.priceChange.previous),
            current: format.money(data.priceChange.current),
          }),
        });
      } else if (data) {
        router.push(`/checkout/${data.quoteId}` as Href);
      } else {
        setNotice({
          offerId: offer.id,
          text: response.status === 410 ? t('results.offerGone') : t('results.error'),
        });
      }
    } catch {
      setNotice({ offerId: offer.id, text: t('mobile.networkError') });
    } finally {
      setSelecting(null);
    }
  };

  if (!request) {
    return (
      <Notice
        body={t('results.error')}
        action={t('results.searchAgain')}
        onAction={() => router.back()}
      />
    );
  }
  if (search.isPending || (searchId && offers.isPending)) {
    return <Loading label={t('results.flights.searching')} />;
  }
  if (offers.error instanceof ExpiredError) {
    return (
      <Notice
        body={t('results.expired')}
        action={t('results.searchAgain')}
        onAction={() => void search.refetch()}
      />
    );
  }
  if (search.isError || offers.isError || !offers.data) {
    return (
      <Notice
        body={t('results.error')}
        action={t('results.retry')}
        onAction={() => void (search.isError ? search.refetch() : offers.refetch())}
      />
    );
  }

  const pages = offers.data.pages;
  const first = pages[0];
  const list = pages.flatMap((page) => page.offers);
  const facets = first?.facets;
  const filtered =
    filters.stops.length + filters.airlines.length > 0 || filters.refundable || filters.checkedBag;

  return (
    <View className="flex-1 bg-background">
      <FlashList
        data={list}
        keyExtractor={(offer) => offer.id}
        ListHeaderComponent={
          <View className="gap-3 px-4 pt-4 pb-2">
            <View className="flex-row items-center justify-between">
              <Text
                testID="results-count"
                accessibilityRole="header"
                className="font-heading text-h4 text-heading"
              >
                {t('results.flights.count', { count: first?.total ?? 0 })}
              </Text>
              <Button variant="ghost" onPress={() => setSheet(true)}>
                {filtered ? `${t('mobile.search.filters')} •` : t('mobile.search.filters')}
              </Button>
            </View>
            {first?.suppliers.some((supplier) => supplier.supplier === 'mock') ? (
              <Badge variant="neutral">{t('results.demoSupplier')}</Badge>
            ) : null}
            {first?.status === 'partial' ? (
              <Text className="font-body text-body-sm text-foreground">{t('results.partial')}</Text>
            ) : null}
            <WatchRoute request={request} currency={currency} />
          </View>
        }
        ListEmptyComponent={
          <Notice body={filtered ? t('mobile.search.noResults') : t('results.flights.none')} />
        }
        ListFooterComponent={
          offers.hasNextPage ? (
            <View className="p-4">
              <Button
                variant="ghost"
                loading={offers.isFetchingNextPage}
                onPress={() => void offers.fetchNextPage()}
              >
                {t('results.flights.loadMore')}
              </Button>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <FlightOfferCard
            offer={item}
            travellers={travellers}
            busy={selecting === item.id}
            notice={notice?.offerId === item.id ? notice.text : undefined}
            noticeAction={
              notice?.offerId === item.id && notice.quoteId
                ? {
                    label: t('results.continueAtPrice', { price: format.money(item.price.total) }),
                    onPress: () => void select(item, notice.quoteId),
                  }
                : undefined
            }
            onSelect={() => void select(item)}
          />
        )}
      />
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title={t('mobile.search.filters')}
        closeLabel={t('common.close')}
        snapPoints={['85%']}
        footer={
          <View className="gap-2">
            <Button fullWidth onPress={() => setSheet(false)}>
              {t('mobile.search.showResults')}
            </Button>
            <Button variant="ghost" onPress={() => setFilters(NO_FILTERS)}>
              {t('mobile.search.clearFilters')}
            </Button>
          </View>
        }
      >
        <View className="gap-4 pb-4">
          <Text className="font-body-bold text-body text-heading">{t('results.sort.label')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <SegmentedControl
              label={t('results.sort.label')}
              options={(['best', 'cheapest', 'fastest', 'earliest'] as const).map((value) => ({
                value,
                label: t(`results.sort.${value}`),
              }))}
              value={filters.sort}
              onValueChange={(sort) => setFilters((current) => ({ ...current, sort }))}
            />
          </ScrollView>
          {facets && facets.stops.length > 0 ? (
            <View className="gap-2">
              <Text className="font-body-bold text-body text-heading">
                {t('results.filters.stops')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {facets.stops.map((facet) => (
                  <Chip
                    key={facet.stops}
                    label={
                      facet.stops === 0
                        ? t('results.filters.stopOptions.direct')
                        : facet.stops === 1
                          ? t('results.filters.stopOptions.one')
                          : t('results.filters.stopOptions.twoPlus')
                    }
                    selected={filters.stops.includes(facet.stops)}
                    onPress={() =>
                      setFilters((current) => ({
                        ...current,
                        stops: toggle(current.stops, facet.stops),
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
          {facets && facets.airlines.length > 0 ? (
            <View className="gap-2">
              <Text className="font-body-bold text-body text-heading">
                {t('results.filters.airlines')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {facets.airlines.map((airline) => (
                  <Chip
                    key={airline.code}
                    label={airline.name}
                    selected={filters.airlines.includes(airline.code)}
                    onPress={() =>
                      setFilters((current) => ({
                        ...current,
                        airlines: toggle(current.airlines, airline.code),
                      }))
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {facets && facets.refundable > 0 ? (
              <Chip
                label={t('results.filters.refundable')}
                selected={filters.refundable}
                onPress={() =>
                  setFilters((current) => ({ ...current, refundable: !current.refundable }))
                }
              />
            ) : null}
            {facets && facets.withCheckedBag > 0 ? (
              <Chip
                label={t('results.filters.checkedBag')}
                selected={filters.checkedBag}
                onPress={() =>
                  setFilters((current) => ({ ...current, checkedBag: !current.checkedBag }))
                }
              />
            ) : null}
          </View>
        </View>
      </Sheet>
    </View>
  );
}
